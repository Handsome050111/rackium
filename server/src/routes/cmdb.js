import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/cmdb (brief v2.3 §5.8; M6a). Every
// project member in scope reads the as-built record; an Architect or PM
// makes operational edits and imports lifecycle dates (checked in the service).
export function cmdbRoutes({ config, cmdb }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]

  r.get('/buildings/:buildingId', ...base, validate({ params: z.object({ buildingId: hex }) }), async (req, res) => {
    res.json(await cmdb.view(req, req.input.params.buildingId))
  })
  r.patch('/records/:deviceId', ...base, validate({ params: z.object({ deviceId: hex }), body: C.cmdbOperationalBody }), async (req, res) => {
    res.json(await cmdb.operationalEdit(req, req.input.params.deviceId, req.input.body, actorOf(req)))
  })
  r.post('/lifecycle-import', ...base, validate({ body: C.lifecycleImportBody }), async (req, res) => {
    res.json(await cmdb.importLifecycle(req, req.input.body, actorOf(req)))
  })
  return r
}
