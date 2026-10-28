import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { authLimiter } from '../http/rateLimits.js'
import { rolesIn } from '../organisations/service.js'
import { projectModeLabels, updateProjectModeLabels } from '../hld/cmoDecisions.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const buildingParam = z.object({ buildingId: hex })
const idParam = z.object({ id: hex })
const groupParam = z.object({ groupKey: z.string().regex(/^[a-z-]{2,40}$/) })
const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) })

const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/… (brief v2.3 §5.5–§5.6; M5a): commercial
// standards, the BOM and procurement, the Solution Package and its client
// share links, and change requests. Every member reads within scope; the
// PM approves the BOM, updates procurement, sets margin and standards and
// sends packages to the client; the Architect (or PM) fills the Required
// Inputs; the Architect drafts and submits change requests.
export function deliveryRoutes({ config, bom, solutionPackage, changeRequests, commercial, shareLinkAdmin }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const pm = (action) => requireAction(action)

  r.get('/commercial-settings', ...base, async (req, res) => {
    res.json(await commercial.get(req))
  })
  r.patch('/commercial-settings', ...base, pm(ACTIONS.SET_COMMERCIAL_STANDARDS), validate({ body: C.commercialSettingsBody }), async (req, res) => {
    res.json(await commercial.update(req, req.input.body, actorOf(req)))
  })

  // The state labels (M7b-4a, DATA-MODEL §5.21): every member reads them; Project settings sets them.
  r.get('/mode-labels', ...base, async (req, res) => {
    res.json(await projectModeLabels())
  })
  r.patch('/mode-labels', ...base, pm(ACTIONS.MANAGE_PROJECT_SETTINGS), validate({ body: C.projectModeLabelsBody }), async (req, res) => {
    res.json(await updateProjectModeLabels(req, req.input.body, actorOf(req)))
  })

  r.get('/bom/buildings/:buildingId', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await bom.view(req, req.input.params.buildingId))
  })
  r.post('/bom/approve', ...base, pm(ACTIONS.APPROVE_BOM_UPDATE_PROCUREMENT), validate({ body: C.bomApproveBody }), async (req, res) => {
    res.status(201).json(await bom.approve(req, req.input.body, actorOf(req)))
  })
  r.patch('/bom/lines', ...base, pm(ACTIONS.APPROVE_BOM_UPDATE_PROCUREMENT), validate({ body: C.procurementLineBody }), async (req, res) => {
    res.json(await bom.updateLine(req, req.input.body, actorOf(req)))
  })

  r.get('/solution-package/buildings/:buildingId', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await solutionPackage.view(req, req.input.params.buildingId))
  })
  r.put('/solution-package/groups/:groupKey', ...base, pm(ACTIONS.EDIT_SOLUTION_PACKAGE), validate({ params: groupParam, body: C.requiredInputGroupBody }), async (req, res) => {
    res.json(await solutionPackage.updateGroup(req, req.input.params.groupKey, req.input.body, actorOf(req)))
  })
  r.post('/solution-package/accept-warning', ...base, pm(ACTIONS.EDIT_SOLUTION_PACKAGE), validate({ body: C.acceptWarningBody }), async (req, res) => {
    res.json(await solutionPackage.acceptWarning(req, req.input.body, actorOf(req)))
  })
  r.post('/solution-package/submit', ...base, pm(ACTIONS.GENERATE_CLIENT_SHARE_LINK), validate({ body: C.shareLinkCreateBody }), async (req, res) => {
    res.status(201).json(await solutionPackage.submitToClient(req, req.input.body, actorOf(req)))
  })
  r.post('/share-links/:id/extend', ...base, pm(ACTIONS.GENERATE_CLIENT_SHARE_LINK), validate({ params: idParam, body: C.shareLinkExtendBody }), async (req, res) => {
    res.json(await shareLinkAdmin.extend(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.post('/share-links/:id/revoke', ...base, pm(ACTIONS.GENERATE_CLIENT_SHARE_LINK), validate({ params: idParam }), async (req, res) => {
    res.json(await shareLinkAdmin.revoke(req, req.input.params.id, actorOf(req)))
  })

  r.get('/change-requests/buildings/:buildingId', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await changeRequests.list(req, req.input.params.buildingId))
  })
  r.get('/change-requests/:id', ...base, validate({ params: idParam }), async (req, res) => {
    res.json(await changeRequests.get(req, req.input.params.id))
  })
  r.post('/change-requests', ...base, pm(ACTIONS.MANAGE_CHANGE_REQUESTS), validate({ body: C.changeRequestCreateBody }), async (req, res) => {
    res.status(201).json(await changeRequests.create(req, req.input.body, actorOf(req)))
  })
  r.patch('/change-requests/:id', ...base, pm(ACTIONS.MANAGE_CHANGE_REQUESTS), validate({ params: idParam, body: C.changeRequestUpdateBody }), async (req, res) => {
    res.json(await changeRequests.update(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.post('/change-requests/:id/submit', ...base, pm(ACTIONS.MANAGE_CHANGE_REQUESTS), validate({ params: idParam }), async (req, res) => {
    res.json(await changeRequests.submit(req, req.input.params.id, actorOf(req)))
  })
  r.post('/change-requests/:id/send', ...base, pm(ACTIONS.GENERATE_CLIENT_SHARE_LINK), validate({ params: idParam, body: C.changeRequestSendBody }), async (req, res) => {
    res.status(201).json(await changeRequests.send(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.post('/change-requests/:id/withdraw', ...base, pm(ACTIONS.MANAGE_CHANGE_REQUESTS), validate({ params: idParam }), async (req, res) => {
    res.json(await changeRequests.withdraw(req, req.input.params.id, actorOf(req)))
  })

  return r
}

// /public/share-links/:token (M5a): the client approval page's API. No
// login; the token (in the path) and the password (in every body) are the
// credentials. Rate-limited per IP, and per link by the password lock.
export function publicRoutes({ publicApproval, rateLimits }) {
  const r = recordingRouter()
  const limit = authLimiter({ enabled: rateLimits.enabled, ...(rateLimits.shareLink ?? { windowMs: 15 * 60 * 1000, limit: 60, message: 'Too many requests. Try again later.' }) })
  r.get('/share-links/:token', limit, validate({ params: tokenParam }), async (req, res) => {
    res.json(await publicApproval.status(req.input.params.token))
  })
  r.post('/share-links/:token/view', limit, validate({ params: tokenParam, body: C.publicViewBody }), async (req, res) => {
    res.json(await publicApproval.view(req.input.params.token, req.input.body))
  })
  r.post('/share-links/:token/decision', limit, validate({ params: tokenParam, body: C.publicDecisionBody }), async (req, res) => {
    res.json(await publicApproval.decide(req.input.params.token, req.input.body))
  })
  // A document behind a handover or download link (M6b); POST so the password stays out of URLs.
  r.post('/share-links/:token/documents/:documentId', limit, validate({ params: tokenParam.extend({ documentId: z.string().regex(/^[a-f0-9]{24}$/) }), body: C.publicDownloadBody }), async (req, res) => {
    const { file, stream } = await publicApproval.download(req.input.params.token, req.input.params.documentId, req.input.body)
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Length', file.sizeBytes)
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/[^\w.\- ]+/g, '_')}"`)
    res.setHeader('Cache-Control', 'no-store')
    stream.pipe(res)
  })
  return r
}
