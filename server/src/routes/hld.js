import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const buildingParam = z.object({ buildingId: hex })
const idParam = z.object({ id: hex })

const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/hld (brief v2.3 §5.3, §6.8; M4a). Any
// project member reads within their membership scope; the Architect edits
// and submits; a PM or Reviewer (never the submitter) decides. Every design
// write carries the revision it was based on and is refused when stale.
export function hldRoutes({ config, hld }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const edit = requireAction(ACTIONS.EDIT_SUBMIT_HLD_LLD)
  const decide = requireAction(ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)

  r.get('/library', ...base, async (req, res) => {
    res.json(await hld.library(req))
  })
  r.get('/buildings/:buildingId', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await hld.view(req, req.input.params.buildingId))
  })
  r.get('/buildings/:buildingId/validation', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await hld.validate(req, req.input.params.buildingId))
  })

  r.post('/generate', ...base, edit, validate({ body: C.hldGenerateBody }), async (req, res) => {
    res.status(201).json(await hld.generate(req, req.input.body, actorOf(req)))
  })

  r.post('/devices', ...base, edit, validate({ body: C.hldDeviceCreateBody }), async (req, res) => {
    res.status(201).json(await hld.addDevice(req, req.input.body, actorOf(req)))
  })
  r.patch('/devices/:id', ...base, edit, validate({ params: idParam, body: C.hldDeviceUpdateBody }), async (req, res) => {
    res.json(await hld.updateDevice(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/devices/:id', ...base, edit, validate({ params: idParam, query: C.hldRevisionQuery }), async (req, res) => {
    res.json(await hld.deleteDevice(req, req.input.params.id, req.input.query, actorOf(req)))
  })
  r.put('/devices/:id/position', ...base, edit, validate({ params: idParam, body: C.hldPositionBody }), async (req, res) => {
    res.json(await hld.moveDevice(req, req.input.params.id, req.input.body, actorOf(req)))
  })

  r.post('/uplinks/check', ...base, validate({ body: C.hldUplinkCheckBody }), async (req, res) => {
    res.json(await hld.checkUplinkDraft(req, req.input.body))
  })
  r.post('/uplinks', ...base, edit, validate({ body: C.hldUplinkCreateBody }), async (req, res) => {
    res.status(201).json(await hld.createUplink(req, req.input.body, actorOf(req)))
  })
  r.patch('/uplinks/:id', ...base, edit, validate({ params: idParam, body: C.hldUplinkUpdateBody }), async (req, res) => {
    res.json(await hld.updateUplink(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/uplinks/:id', ...base, edit, validate({ params: idParam, query: C.hldRevisionQuery }), async (req, res) => {
    res.json(await hld.deleteUplink(req, req.input.params.id, req.input.query, actorOf(req)))
  })

  r.post('/submit', ...base, edit, validate({ body: C.hldSubmitBody }), async (req, res) => {
    res.status(201).json(await hld.submit(req, req.input.body, actorOf(req)))
  })
  r.post('/decision', ...base, decide, validate({ body: C.hldDecisionBody }), async (req, res) => {
    res.json(await hld.decide(req, req.input.body, actorOf(req)))
  })

  return r
}
