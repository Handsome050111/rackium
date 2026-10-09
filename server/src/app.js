import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import pinoHttp from 'pino-http'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthService } from './auth/service.js'
import { createOrganisationService } from './organisations/service.js'
import { createHierarchyService } from './hierarchy/service.js'
import { createBlockersService } from './blockers/service.js'
import { createViewAsService } from './viewAs/service.js'
import { createDashboardService } from './dashboard/service.js'
import { createCatalogueService } from './catalogue/service.js'
import { createCmoService } from './cmo/service.js'
import { createStructureService } from './survey/structureService.js'
import { createRackService } from './survey/rackService.js'
import { createSurveyFormService } from './survey/formService.js'
import { createFileService } from './files/service.js'
import { createDiskStorage } from './files/storage.js'
import { createHldService } from './hld/service.js'
import { apiRouter, API_VERSION } from './routes/index.js'
import { requireUser } from './http/middleware.js'
import { membershipSummary, userSummary } from './routes/summaries.js'
import { membershipsForUser } from './auth/service.js'
import { notFoundHandler, errorHandler } from './http/errorHandler.js'
import { buildOpenApiDocument } from './openapi/document.js'

export const VERSION = '0.1.0'

const IMPORT_ROUTE = /^\/api\/v1\/orgs\/[^/]+\/(catalogue\/import|projects\/[^/]+\/(cmo\/(preview|import)|survey\/sync))\/?$/
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Per-route limits. Enabled in production and development; tests may disable
// them, and the auth service never checks them itself.
export const DEFAULT_RATE_LIMITS = {
  enabled: true,
  login: { windowMs: 15 * 60 * 1000, limit: 10, message: 'Too many sign-in attempts. Try again in 15 minutes.' },
  signup: { windowMs: 60 * 60 * 1000, limit: 5, message: 'Too many sign-up attempts. Try again later.' },
  verify: { windowMs: 15 * 60 * 1000, limit: 20, message: 'Too many attempts. Try again later.' },
  resend: { windowMs: 60 * 60 * 1000, limit: 5, message: 'Too many resend requests. Try again later.' },
  resendInvite: { windowMs: 60 * 60 * 1000, limit: 20, message: 'Too many resend requests. Try again later.' },
  refresh: { windowMs: 15 * 60 * 1000, limit: 60, message: 'Too many requests. Try again later.' },
  reset: { windowMs: 60 * 60 * 1000, limit: 5, message: 'Too many reset requests. Try again later.' },
  invite: { windowMs: 15 * 60 * 1000, limit: 10, message: 'Too many attempts. Try again later.' },
}

export function createApp({ config, logger, mailer, rateLimits = DEFAULT_RATE_LIMITS }) {
  const app = express()
  app.set('trust proxy', config.TRUST_PROXY)

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.get('x-request-id') ?? crypto.randomUUID()
        res.setHeader('X-Request-Id', id)
        return id
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
    })
  )

  // The API returns JSON only, so the strictest CSP is correct.
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }))
  app.use(
    cors({
      origin: config.CLIENT_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-View-As-Session'],
    })
  )
  // Imports post their parsed rows as JSON (the file is read in the browser),
  // so only those routes get a larger body limit; everything else stays small.
  const smallJson = express.json({ limit: '100kb' })
  const importJson = express.json({ limit: '6mb' })
  app.use((req, res, next) => (IMPORT_ROUTE.test(req.path) ? importJson : smallJson)(req, res, next))
  app.use(cookieParser())

  const auth = createAuthService({ config, mailer, logger })
  const org = createOrganisationService({ mailer, auth })
  const hierarchy = createHierarchyService()
  const blockers = createBlockersService()
  const viewAs = createViewAsService()
  const dashboard = createDashboardService()
  const catalogue = createCatalogueService()
  const cmo = createCmoService()
  // A relative FILE_STORAGE_DIR is relative to the server package, not the cwd.
  const storage = createDiskStorage(path.resolve(SERVER_ROOT, config.FILE_STORAGE_DIR ?? 'var/files'))
  const survey = { structure: createStructureService({ hierarchy }), racks: createRackService(), forms: createSurveyFormService() }
  const files = createFileService({ storage })
  const hld = createHldService({ storage })
  const openapiDocument = () => buildOpenApiDocument({ version: VERSION })

  const api = apiRouter({ config, auth, org, hierarchy, blockers, viewAs, dashboard, catalogue, cmo, survey, files, hld, rateLimits, openapiDocument, version: VERSION })
  api.get('/me', requireUser(config), async (req, res) => {
    const memberships = await membershipsForUser(req.user._id)
    res.json({ user: userSummary(req.user), memberships: memberships.map(membershipSummary) })
  })
  app.use(`/api/v${API_VERSION}`, api)

  // Every route actually registered, full path, OpenAPI {param} form — read
  // by test/api.openapi-coverage.test.js so the drift check is built from
  // the exact same registrations the app serves, not a hand-kept list.
  app.__apiRoutes = api.__routes.map(({ method, path }) => ({ method, path: `/api/v${API_VERSION}${path === '/' ? '' : path}` }))

  app.use(notFoundHandler)
  app.use(errorHandler(logger))
  return app
}
