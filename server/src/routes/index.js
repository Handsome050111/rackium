import { healthResponse } from '@rackium/shared/contracts.js'
import { databaseIsUp } from '../db/connect.js'
import { recordingRouter, joinRoutePath } from '../http/routeRecorder.js'
import { authRoutes } from './auth.js'
import { organisationRoutes } from './organisations.js'
import { hierarchyRoutes } from './hierarchy.js'
import { blockersRoutes } from './blockers.js'
import { dashboardRoutes } from './dashboard.js'
import { viewAsRoutes } from './viewAs.js'
import { catalogueRoutes } from './catalogue.js'
import { cmoRoutes } from './cmo.js'
import { surveyRoutes } from './survey.js'
import { fileRoutes } from './files.js'

export const API_VERSION = '1'

export function apiRouter({ config, auth, org, hierarchy, blockers, viewAs, dashboard, catalogue, cmo, survey, files, rateLimits, openapiDocument, version }) {
  const r = recordingRouter()

  r.get('/health', (req, res) => {
    const database = databaseIsUp() ? 'up' : 'down'
    const body = healthResponse.parse({ status: database === 'up' ? 'ok' : 'degraded', database, version })
    res.status(database === 'up' ? 200 : 503).json(body)
  })

  r.get('/openapi.json', (req, res) => {
    res.json(openapiDocument())
  })

  // Each mount below is paired with its own prefix here, so r.__routes (read
  // by app.js into app.__apiRoutes for the OpenAPI drift check) always
  // reflects exactly what app.use() wires up — nothing is duplicated by hand.
  const mounts = [
    ['/auth', authRoutes({ config, auth, rateLimits })],
    ['/orgs/:orgId', organisationRoutes({ config, org, rateLimits })],
    ['/orgs/:orgId/projects/:projectId/hierarchy', hierarchyRoutes({ config, hierarchy })],
    ['/orgs/:orgId/projects/:projectId/blockers', blockersRoutes({ config, blockers })],
    ['/orgs/:orgId/projects/:projectId/dashboard', dashboardRoutes({ config, dashboard })],
    ['/orgs/:orgId/projects/:projectId/view-as', viewAsRoutes({ config, viewAs })],
    ['/orgs/:orgId/catalogue', catalogueRoutes({ config, catalogue })],
    ['/orgs/:orgId/projects/:projectId/cmo', cmoRoutes({ config, cmo })],
    ['/orgs/:orgId/projects/:projectId/survey', surveyRoutes({ config, survey })],
    ['/orgs/:orgId/projects/:projectId/files', fileRoutes({ config, files })],
  ]
  for (const [prefix, subRouter] of mounts) {
    r.use(prefix, subRouter)
    for (const { method, path } of subRouter.__routes) {
      r.__routes.push({ method, path: joinRoutePath(prefix, path) })
    }
  }

  return r
}
