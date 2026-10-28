import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import { SCHEDULE_COLUMN_KEYS, scheduleHeadings } from '@rackium/shared/documents/assemble.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'
import { Organisation } from '../models/organisation.js'
import { ProjectSettings } from '../models/projectSettings.js'
import { projectSettings } from '../delivery/common.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { badRequest, notFound } from '../http/errors.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}
const safeName = (name) => String(name ?? 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 140) || 'document'
function sendFile(res, { file, stream }, { inline = false } = {}) {
  res.setHeader('Content-Type', file.mimeType)
  res.setHeader('Content-Length', file.sizeBytes)
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName(file.fileName)}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  stream.pipe(res)
}
function sendLogo(res, bytes, mimeType) {
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(bytes)
}

// /orgs/:orgId/projects/:projectId/documents (brief v2.2 §10; M6b). Every
// project member in scope may generate and download the building's
// documents; price-bearing exports and the audit log follow their own rules
// (checked in the service); a PM shares documents by link.
export function documentRoutes({ config, documents }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]

  r.get('/', ...base, validate({ query: C.documentListQuery }), async (req, res) => {
    res.json(await documents.list(req, req.input.query))
  })
  r.post('/', ...base, validate({ body: C.documentRequestBody }), async (req, res) => {
    const out = await documents.request(req, req.input.body, actorOf(req))
    res.status(out.existing ? 200 : 202).json(out)
  })
  r.get('/share-links', ...base, validate({ query: z.object({ buildingId: hex }) }), async (req, res) => {
    res.json(await documents.downloadLinks(req, req.input.query.buildingId))
  })
  r.post('/share-links', ...base, validate({ body: C.documentShareLinkBody }), async (req, res) => {
    res.status(201).json(await documents.createDownloadLink(req, req.input.body, actorOf(req)))
  })
  r.get('/:id', ...base, validate({ params: z.object({ id: hex }) }), async (req, res) => {
    res.json(await documents.get(req, req.input.params.id))
  })
  r.get('/:id/download', ...base, validate({ params: z.object({ id: hex }) }), async (req, res) => {
    sendFile(res, await documents.open(req, req.input.params.id, actorOf(req)))
  })
  return r
}

// /orgs/:orgId/projects/:projectId — the client logo, cable schedule
// headings and the QR target of a cable label.
export function projectBrandingRoutes({ config, documents }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const pm = requireAction(ACTIONS.SET_COMMERCIAL_STANDARDS)

  r.get('/settings/client-logo', ...base, async (req, res) => {
    const { clientLogo } = await projectSettings()
    if (!clientLogo) throw notFound('No client logo')
    sendLogo(res, await documents.readLogo(clientLogo), clientLogo.mimeType)
  })
  r.put('/settings/client-logo', ...base, pm, validate({ body: C.logoBody }), async (req, res) => {
    const logo = await documents.setLogo({ dataUrl: req.input.body.dataUrl, key: `${req.org.id}/${req.project.id}`, kind: 'client-logo' })
    await ProjectSettings.updateOne({}, { $set: { clientLogo: logo, updatedBy: req.user._id, updatedAt: new Date() } }, { upsert: true })
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(req.user._id, req.roles?.[0]), action: 'settings.client_logo.updated', objectType: 'Project', objectId: String(req.project.id), changeType: 'design_intent', source: 'ui' })
    res.json({ clientLogo: true })
  })
  r.delete('/settings/client-logo', ...base, pm, async (req, res) => {
    await ProjectSettings.updateOne({}, { $set: { clientLogo: null } }, { upsert: true })
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(req.user._id, req.roles?.[0]), action: 'settings.client_logo.removed', objectType: 'Project', objectId: String(req.project.id), changeType: 'design_intent', source: 'ui' })
    res.json({ clientLogo: false })
  })
  r.get('/settings/cable-headings', ...base, async (req, res) => {
    const { cableScheduleHeadings, clientLogo } = await projectSettings()
    res.json({ headings: scheduleHeadings(cableScheduleHeadings), custom: cableScheduleHeadings, keys: SCHEDULE_COLUMN_KEYS, hasClientLogo: Boolean(clientLogo) })
  })
  r.put('/settings/cable-headings', ...base, pm, validate({ body: C.scheduleHeadingsBody }), async (req, res) => {
    const unknown = Object.keys(req.input.body.headings).filter((k) => !SCHEDULE_COLUMN_KEYS.includes(k))
    if (unknown.length) throw badRequest(`Unknown column(s): ${unknown.join(', ')}`)
    const before = (await projectSettings()).cableScheduleHeadings
    const clean = Object.fromEntries(Object.entries(req.input.body.headings).filter(([, v]) => v))
    await ProjectSettings.updateOne({}, { $set: { cableScheduleHeadings: clean, updatedBy: req.user._id, updatedAt: new Date() } }, { upsert: true })
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, actor: userActor(req.user._id, req.roles?.[0]), action: 'settings.cable_headings.updated', objectType: 'Project', objectId: String(req.project.id), changeType: 'design_intent', source: 'ui', changes: SCHEDULE_COLUMN_KEYS.filter((k) => (before[k] ?? null) !== (clean[k] ?? null)).map((k) => ({ objectType: 'Project', objectId: String(req.project.id), field: `cableScheduleHeadings.${k}`, before: before[k] ?? null, after: clean[k] ?? null })) })
    res.json({ headings: scheduleHeadings(clean), custom: clean, keys: SCHEDULE_COLUMN_KEYS })
  })
  // A cable label's QR code: the connection, for a member in scope.
  r.get('/connections/:connectionId/locate', ...base, validate({ params: z.object({ connectionId: hex }) }), async (req, res) => {
    res.json(await documents.locateConnection(req, req.input.params.connectionId))
  })
  return r
}

// /orgs/:orgId/settings/logo — the organisation's logo (Org Admin).
export function orgBrandingRoutes({ config, documents }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]
  r.get('/settings/logo', ...base, async (req, res) => {
    const org = await Organisation.findById(req.org.id, { 'settings.logo': 1 }).lean()
    if (!org?.settings?.logo?.storageKey) throw notFound('No organisation logo')
    sendLogo(res, await documents.readLogo(org.settings.logo), org.settings.logo.mimeType)
  })
  r.put('/settings/logo', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), validate({ body: C.logoBody }), async (req, res) => {
    const logo = await documents.setLogo({ dataUrl: req.input.body.dataUrl, key: String(req.org.id), kind: 'logo' })
    await Organisation.updateOne({ _id: req.org.id }, { $set: { 'settings.logo': logo } })
    await recordAudit({ organisationId: req.org.id, actor: userActor(req.user._id, 'org_admin'), action: 'organisation.logo.updated', objectType: 'Organisation', objectId: String(req.org.id), changeType: 'design_intent', source: 'ui' })
    res.json({ logo: true })
  })
  r.delete('/settings/logo', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), async (req, res) => {
    await Organisation.updateOne({ _id: req.org.id }, { $set: { 'settings.logo': null } })
    await recordAudit({ organisationId: req.org.id, actor: userActor(req.user._id, 'org_admin'), action: 'organisation.logo.removed', objectType: 'Organisation', objectId: String(req.org.id), changeType: 'design_intent', source: 'ui' })
    res.json({ logo: false })
  })
  return r
}

// /orgs/:orgId/projects/:projectId/handover (brief v2.3 §5.9; M6b).
export function handoverRoutes({ config, handover }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const b = z.object({ buildingId: hex })
  r.get('/buildings/:buildingId', ...base, validate({ params: b }), async (req, res) => {
    res.json(await handover.view(req, req.input.params.buildingId))
  })
  r.post('/buildings/:buildingId/compile', ...base, validate({ params: b }), async (req, res) => {
    res.status(202).json(await handover.compile(req, req.input.params.buildingId, actorOf(req)))
  })
  r.post('/buildings/:buildingId/retry', ...base, validate({ params: b }), async (req, res) => {
    res.status(202).json(await handover.retryFailed(req, req.input.params.buildingId, actorOf(req)))
  })
  r.post('/buildings/:buildingId/review', ...base, validate({ params: b }), async (req, res) => {
    res.json(await handover.review(req, req.input.params.buildingId, actorOf(req)))
  })
  // CMO gear kept on site with a reason (M7b-4b, DATA-MODEL §5.22).
  r.put('/buildings/:buildingId/old-gear', ...base, validate({ params: b, body: C.oldGearOverrideBody }), async (req, res) => {
    res.json(await handover.keepOldGear(req, req.input.params.buildingId, req.input.body, actorOf(req)))
  })
  r.post('/buildings/:buildingId/deliver', ...base, validate({ params: b, body: C.handoverDeliverBody }), async (req, res) => {
    res.status(201).json(await handover.deliver(req, req.input.params.buildingId, req.input.body, actorOf(req)))
  })
  return r
}
