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

// /orgs/:orgId/projects/:projectId/deployment (brief v2.3 §5.7; M6a). Every
// project member in scope reads; the service decides who records what: the
// Field Engineer installs, patches, tests and logs exceptions; a PM or
// Reviewer reviews exceptions and accepts.
export function deploymentRoutes({ config, deployment }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]

  r.get('/buildings/:buildingId', ...base, validate({ params: z.object({ buildingId: hex }) }), async (req, res) => {
    res.json(await deployment.view(req, req.input.params.buildingId))
  })
  r.get('/devices/:deviceId', ...base, validate({ params: z.object({ deviceId: hex }) }), async (req, res) => {
    res.json({ device: await deployment.deviceDetail(req, req.input.params.deviceId) })
  })
  r.put('/devices/:deviceId/installation', ...base, validate({ params: z.object({ deviceId: hex }), body: C.installationBody }), async (req, res) => {
    res.json(await deployment.saveInstallation(req, req.input.params.deviceId, req.input.body, actorOf(req)))
  })
  r.put('/devices/:deviceId/dguv', ...base, validate({ params: z.object({ deviceId: hex }), body: C.dguvInspectionBody }), async (req, res) => {
    res.json(await deployment.recordDguv(req, req.input.params.deviceId, req.input.body, actorOf(req)))
  })
  r.post('/devices/:deviceId/status', ...base, validate({ params: z.object({ deviceId: hex }), body: C.deviceStepBody }), async (req, res) => {
    res.json(await deployment.setDeviceStatus(req, req.input.params.deviceId, req.input.body, actorOf(req)))
  })
  r.put('/connections/:connectionId/installation', ...base, validate({ params: z.object({ connectionId: hex }), body: C.connectionInstallBody }), async (req, res) => {
    res.json(await deployment.saveConnection(req, req.input.params.connectionId, req.input.body, actorOf(req)))
  })
  r.post('/connections/:connectionId/test', ...base, validate({ params: z.object({ connectionId: hex }), body: C.connectionTestBody }), async (req, res) => {
    res.json(await deployment.testConnection(req, req.input.params.connectionId, req.input.body, actorOf(req)))
  })
  r.post('/connections/:connectionId/accept', ...base, validate({ params: z.object({ connectionId: hex }) }), async (req, res) => {
    res.json(await deployment.acceptConnection(req, req.input.params.connectionId, actorOf(req)))
  })
  r.post('/exceptions', ...base, validate({ body: C.exceptionCreateBody }), async (req, res) => {
    res.status(201).json(await deployment.logException(req, req.input.body, actorOf(req)))
  })
  r.post('/exceptions/:exceptionId/review', ...base, validate({ params: z.object({ exceptionId: hex }), body: C.exceptionReviewBody }), async (req, res) => {
    res.json(await deployment.reviewException(req, req.input.params.exceptionId, req.input.body, actorOf(req)))
  })
  return r
}
