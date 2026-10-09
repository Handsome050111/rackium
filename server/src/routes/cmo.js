import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import { cmoImportBody, cmoAssignBody } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { projectScope } from '../access/scope.js'

const deviceParam = z.object({ deviceId: z.string().regex(/^[a-f0-9]{24}$/) })

// /orgs/:orgId/projects/:projectId/cmo (brief v2.3 §5.1). Any project member
// or Org Admin reads; Org Admin and PM import; the PM assigns — each within
// the caller's membership scope (access/scope.js).
export function cmoRoutes({ config, cmo }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]

  r.get('/', ...base, async (req, res) => {
    res.json(await cmo.context({ scope: await projectScope(req) }))
  })

  // Validation only — nothing is written. The client shows this as the
  // preview; commit re-runs exactly the same checks.
  r.post('/preview', ...base, requireAction(ACTIONS.IMPORT_CMO), validate({ body: cmoImportBody }), async (req, res) => {
    res.json(await cmo.preview({ rows: req.input.body.rows, salId: req.input.body.salId, scope: await projectScope(req) }))
  })

  r.post('/import', ...base, requireAction(ACTIONS.IMPORT_CMO), validate({ body: cmoImportBody }), async (req, res) => {
    const { rows, salId, fileName } = req.input.body
    res.status(201).json(await cmo.commit({ rows, salId, fileName, actor: actorOf(req), scope: await projectScope(req) }))
  })

  r.patch('/devices/:deviceId/assignment', ...base, requireAction(ACTIONS.ASSIGN_CMO_DEVICE), validate({ params: deviceParam, body: cmoAssignBody }), async (req, res) => {
    res.json({ device: await cmo.assign({ deviceId: req.input.params.deviceId, buildingId: req.input.body.buildingId, actor: actorOf(req), scope: await projectScope(req) }) })
  })

  return r
}
