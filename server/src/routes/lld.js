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

// /orgs/:orgId/projects/:projectId/lld (brief v2.3 §5.4, §6.1–6.4, §6.10;
// M4b). Any project member reads within their membership scope; the
// Architect edits, versions and submits; a PM or Reviewer (never the
// submitter) decides; the Architect or PM renames hostnames. Every design
// write carries the revision it was based on and is refused when stale.
export function lldRoutes({ config, lld }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const edit = requireAction(ACTIONS.EDIT_SUBMIT_HLD_LLD)
  const decide = requireAction(ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)
  const rename = requireAction(ACTIONS.RENAME_HOSTNAMES)

  r.get('/buildings/:buildingId', ...base, validate({ params: buildingParam, query: C.lldViewQuery }), async (req, res) => {
    res.json(await lld.view(req, req.input.params.buildingId, req.input.query.branchId))
  })
  r.get('/buildings/:buildingId/validation', ...base, validate({ params: buildingParam, query: C.lldViewQuery }), async (req, res) => {
    res.json(await lld.validate(req, req.input.params.buildingId, req.input.query.branchId))
  })
  r.get('/buildings/:buildingId/reconciliation', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await lld.reconciliation(req, req.input.params.buildingId))
  })

  r.post('/start', ...base, edit, validate({ body: C.lldStartBody }), async (req, res) => {
    res.status(201).json(await lld.start(req, req.input.body, actorOf(req)))
  })
  r.post('/rebase', ...base, edit, validate({ body: C.lldRebaseBody }), async (req, res) => {
    res.json(await lld.rebase(req, req.input.body, actorOf(req)))
  })
  r.post('/copy-from-hld', ...base, edit, validate({ body: C.lldCopyBody }), async (req, res) => {
    res.json(await lld.copyFromHld(req, req.input.body, actorOf(req)))
  })

  r.post('/devices', ...base, edit, validate({ body: C.lldDeviceCreateBody }), async (req, res) => {
    res.status(201).json(await lld.addDevice(req, req.input.body, actorOf(req)))
  })
  r.put('/devices/:id/placement', ...base, edit, validate({ params: idParam, body: C.lldPlacementBody }), async (req, res) => {
    res.json(await lld.place(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/devices/:id', ...base, edit, validate({ params: idParam, query: C.hldRevisionQuery }), async (req, res) => {
    res.json(await lld.deleteDevice(req, req.input.params.id, req.input.query, actorOf(req)))
  })

  r.post('/connections', ...base, edit, validate({ body: C.lldConnectionCreateBody }), async (req, res) => {
    res.status(201).json(await lld.createConnection(req, req.input.body, actorOf(req)))
  })
  r.patch('/connections/:id', ...base, edit, validate({ params: idParam, body: C.lldConnectionUpdateBody }), async (req, res) => {
    res.json(await lld.updateConnection(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/connections/:id', ...base, edit, validate({ params: idParam, query: C.hldRevisionQuery }), async (req, res) => {
    res.json(await lld.deleteConnection(req, req.input.params.id, req.input.query, actorOf(req)))
  })

  r.post('/rename/preview', ...base, rename, validate({ body: C.lldRenamePreviewBody }), async (req, res) => {
    res.json(await lld.renamePreview(req, req.input.body))
  })
  r.post('/rename', ...base, rename, validate({ body: C.lldRenameBody }), async (req, res) => {
    res.json(await lld.rename(req, req.input.body, actorOf(req)))
  })

  r.post('/versions', ...base, edit, validate({ body: C.lldVersionBody }), async (req, res) => {
    res.status(201).json(await lld.saveVersion(req, req.input.body, actorOf(req)))
  })
  r.get('/versions/diff', ...base, validate({ query: C.lldDiffQuery }), async (req, res) => {
    res.json(await lld.diff(req, req.input.query))
  })
  r.post('/versions/:id/restore', ...base, edit, validate({ params: idParam, body: C.lldRestoreBody }), async (req, res) => {
    res.json(await lld.restore(req, req.input.params.id, req.input.body, actorOf(req)))
  })

  r.post('/branches', ...base, edit, validate({ body: C.lldBranchBody }), async (req, res) => {
    res.status(201).json(await lld.createBranch(req, req.input.body, actorOf(req)))
  })
  r.post('/branches/:id/promote', ...base, edit, validate({ params: idParam, body: C.lldBranchPromoteBody }), async (req, res) => {
    res.json(await lld.promoteBranch(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.post('/branches/:id/discard', ...base, edit, validate({ params: idParam }), async (req, res) => {
    res.json(await lld.discardBranch(req, req.input.params.id, actorOf(req)))
  })

  r.post('/submit', ...base, edit, validate({ body: C.lldSubmitBody }), async (req, res) => {
    res.status(201).json(await lld.submit(req, req.input.body, actorOf(req)))
  })
  r.post('/decision', ...base, decide, validate({ body: C.lldDecisionBody }), async (req, res) => {
    res.json(await lld.decide(req, req.input.body, actorOf(req)))
  })

  return r
}
