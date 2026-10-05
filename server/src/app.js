import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import pinoHttp from 'pino-http'
import crypto from 'node:crypto'
import { createAuthService } from './auth/service.js'
import { createOrganisationService } from './organisations/service.js'
import { apiRouter, API_VERSION } from './routes/index.js'
import { requireUser } from './http/middleware.js'
import { membershipSummary, userSummary } from './routes/summaries.js'
import { membershipsForUser } from './auth/service.js'
import { notFoundHandler, errorHandler } from './http/errorHandler.js'
import { buildOpenApiDocument } from './openapi/document.js'

export const VERSION = '0.1.0'

// Per-route limits. Enabled in production and development; tests may disable
// them, and the auth service never checks them itself.
export const DEFAULT_RATE_LIMITS = {
  enabled: true,
  login: { windowMs: 15 * 60 * 1000, limit: 10, message: 'Too many sign-in attempts. Try again in 15 minutes.' },
  signup: { windowMs: 60 * 60 * 1000, limit: 5, message: 'Too many sign-up attempts. Try again later.' },
  verify: { windowMs: 15 * 60 * 1000, limit: 20, message: 'Too many attempts. Try again later.' },
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
      allowedHeaders: ['Content-Type', 'X-Request-Id'],
    })
  )
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())

  const auth = createAuthService({ config, mailer, logger })
  const org = createOrganisationService({ mailer, auth })
  const openapiDocument = () => buildOpenApiDocument({ version: VERSION })

  const api = apiRouter({ config, auth, org, rateLimits, openapiDocument, version: VERSION })
  api.get('/me', requireUser(config), async (req, res) => {
    const memberships = await membershipsForUser(req.user._id)
    res.json({ user: userSummary(req.user), memberships: memberships.map(membershipSummary) })
  })
  app.use(`/api/v${API_VERSION}`, api)

  app.use(notFoundHandler)
  app.use(errorHandler(logger))
  return app
}
