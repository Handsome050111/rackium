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
import { hldRoutes } from './hld.js'
import { taskRoutes, meRoutes } from './tasks.js'
import { scheduleRoutes } from './schedule.js'
import { lldRoutes } from './lld.js'
import { deliveryRoutes, publicRoutes } from './delivery.js'
import { fileRoutes } from './files.js'
import { deploymentRoutes } from './deployment.js'
import { cmdbRoutes } from './cmdb.js'
import { documentRoutes, projectBrandingRoutes, orgBrandingRoutes, handoverRoutes } from './documents.js'

export const API_VERSION = '1'

export function apiRouter({ config, auth, org, auditLog, hierarchy, blockers, viewAs, dashboard, catalogue, cmo, survey, files, hld, lld, delivery, tasks, notifications, deployment, cmdb, documents, handover, schedule, rateLimits, openapiDocument, version }) {
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
    ['/orgs/:orgId', organisationRoutes({ config, org, auditLog, rateLimits })],
    ['/orgs/:orgId', meRoutes({ config, tasks, notifications })],
    ['/orgs/:orgId/projects/:projectId/tasks', taskRoutes({ config, tasks })],
    ['/orgs/:orgId/projects/:projectId/schedule', scheduleRoutes({ config, schedule })],
    ['/orgs/:orgId/projects/:projectId/hierarchy', hierarchyRoutes({ config, hierarchy })],
    ['/orgs/:orgId/projects/:projectId/blockers', blockersRoutes({ config, blockers })],
    ['/orgs/:orgId/projects/:projectId/dashboard', dashboardRoutes({ config, dashboard })],
    ['/orgs/:orgId/projects/:projectId/view-as', viewAsRoutes({ config, viewAs })],
    ['/orgs/:orgId/catalogue', catalogueRoutes({ config, catalogue })],
    ['/orgs/:orgId/projects/:projectId/cmo', cmoRoutes({ config, cmo })],
    ['/orgs/:orgId/projects/:projectId/survey', surveyRoutes({ config, survey })],
    ['/orgs/:orgId/projects/:projectId/hld', hldRoutes({ config, hld })],
    ['/orgs/:orgId/projects/:projectId/lld', lldRoutes({ config, lld })],
    ['/orgs/:orgId/projects/:projectId', deliveryRoutes({ config, ...delivery })],
    ['/public', publicRoutes({ publicApproval: delivery.publicApproval, rateLimits })],
    ['/orgs/:orgId/projects/:projectId/files', fileRoutes({ config, files })],
    ['/orgs/:orgId/projects/:projectId/deployment', deploymentRoutes({ config, deployment })],
    ['/orgs/:orgId/projects/:projectId/cmdb', cmdbRoutes({ config, cmdb })],
    ['/orgs/:orgId/projects/:projectId/documents', documentRoutes({ config, documents })],
    ['/orgs/:orgId/projects/:projectId', projectBrandingRoutes({ config, documents })],
    ['/orgs/:orgId', orgBrandingRoutes({ config, documents })],
    ['/orgs/:orgId/projects/:projectId/handover', handoverRoutes({ config, handover })],
  ]
  for (const [prefix, subRouter] of mounts) {
    r.use(prefix, subRouter)
    for (const { method, path } of subRouter.__routes) {
      r.__routes.push({ method, path: joinRoutePath(prefix, path) })
    }
  }

  return r
}
