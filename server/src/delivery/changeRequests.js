import mongoose from 'mongoose'
import { bomImpact } from '@rackium/shared/bomCalc.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { LldDesign } from '../models/lldDesign.js'
import { Approval } from '../models/approval.js'
import { withTransaction } from '../db/transaction.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { AppError, conflict, notFound } from '../http/errors.js'
import { requireBuilding } from '../access/scope.js'
import { computeBom, namesOf, id } from './common.js'
import { createLink, linksOf, prepareSecrets } from './shareLinks.js'

const EDITABLE = ['draft', 'changes_requested']

// Change requests (brief v2.3 §5.5; DATA-MODEL §5.9; M5a). Once the LLD has an
// approved version (and after the Solution Package approval freezes the
// design) a change is drafted on its own branch — which carries the HLD and
// the LLD together (M5a review) — submitted by the Architect with its design
// diff and BOM impact, and decided by the client through the same share-link
// flow. Approval applies both as new frozen versions. History stays against
// the package.
export function createChangeRequestService({ lld }) {
  const audit = (req, building, actor, action, extra) =>
    recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'solution-package', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })

  async function load(req, crId) {
    const cr = mongoose.isValidObjectId(crId) ? await ChangeRequest.findById(crId).lean() : null
    if (!cr) throw notFound('Change request not found')
    const building = await requireBuilding(req, cr.buildingId)
    return { cr, building }
  }

  // What the change does: the design diff (main → branch, HLD and LLD) and the BOM impact.
  async function impactOf(req, building, cr) {
    const [design, before, after] = await Promise.all([lld.diffBranch(req, building.id, String(cr.branchId)), computeBom(lld, req, building), computeBom(lld, req, building, { branchId: String(cr.branchId) })])
    const bom = bomImpact(before.bom, after.bom)
    return { design, bom: { ...bom, currency: before.bom.currency } }
  }

  function view(cr, names, extra = {}) {
    return {
      id: String(cr._id),
      number: cr.number,
      title: cr.title,
      description: cr.description,
      reason: cr.reason,
      affectedItems: cr.affectedItems,
      status: cr.status,
      branchId: String(cr.branchId),
      createdBy: names.get(String(cr.createdBy)) ?? null,
      createdAt: cr.createdAt,
      submittedBy: names.get(String(cr.submittedBy)) ?? null,
      submittedAt: cr.submittedAt,
      decidedAt: cr.decidedAt,
      resultingVersionId: id(cr.resultingVersionId),
      resultingHldVersionId: id(cr.resultingHldVersionId),
      ...extra,
    }
  }

  return {
    async list(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const crs = await ChangeRequest.find({ buildingId: building.id }).sort({ number: -1 }).lean()
      const names = await namesOf(crs.flatMap((c) => [c.createdBy, c.submittedBy]))
      return { changeRequests: crs.map((c) => view(c, names)) }
    },

    async get(req, crId) {
      const { cr, building } = await load(req, crId)
      const names = await namesOf([cr.createdBy, cr.submittedBy])
      // Live while it is being drafted; what was submitted afterwards.
      const drafting = EDITABLE.includes(cr.status)
      const impact = drafting ? await impactOf(req, building, cr) : cr.impact
      const consistency = drafting ? await lld.consistency(req, building.id, String(cr.branchId)) : null
      const approvals = await Approval.find({ changeRequestId: cr._id }).sort({ submittedAt: -1 }).lean()
      const links = (await linksOf(building.id, { changeRequestId: cr._id })) ?? []
      return {
        changeRequest: view(cr, names, {
          impact,
          consistency,
          shareLinks: links,
          approvals: approvals.map((a) => ({ id: String(a._id), status: a.status, submittedAt: a.submittedAt, client: a.client ? { name: a.client.name, role: a.client.role } : null, decision: a.decision ? { value: a.decision.value, decidedAt: a.decision.decidedAt, comments: a.decision.comments } : null })),
        }),
      }
    },

    async create(req, body, actor) {
      const building = await requireBuilding(req, body.buildingId)
      const lldDoc = await LldDesign.findOne({ buildingId: building.id }).lean()
      if (!lldDoc?.latestApprovedVersionId) throw conflict('no_approved_design', 'A change request changes an approved LLD — approve the LLD first')
      const last = await ChangeRequest.findOne({ buildingId: building.id }).sort({ number: -1 }).lean()
      const number = (last?.number ?? 0) + 1
      return withTransaction(async (session) => {
        const crId = new mongoose.Types.ObjectId()
        const { branch } = await lld.createChangeRequestBranch(req, { building, name: `CR-${number} ${body.title}`.slice(0, 80), changeRequestId: crId }, actor, session)
        await ChangeRequest.create([{ _id: crId, buildingId: building.id, number, title: body.title, description: body.description, reason: body.reason, branchId: branch.id, baseLldVersionId: lldDoc.latestApprovedVersionId, createdBy: actor.userId }], { session })
        await audit(req, building, actor, 'change_request.created', { objectType: 'ChangeRequest', objectId: crId, comment: `CR-${number}: ${body.title}`, session })
        return { changeRequest: { id: String(crId), number, branchId: branch.id, status: 'draft' } }
      })
    },

    async update(req, crId, body, actor) {
      const { cr, building } = await load(req, crId)
      if (!EDITABLE.includes(cr.status)) throw conflict('change_request_locked', `CR-${cr.number} is ${cr.status.replace('_', ' ')} — it can be edited again if changes are requested`)
      const updated = await ChangeRequest.findOneAndUpdate({ _id: cr._id, status: { $in: EDITABLE } }, { $set: body }, { returnDocument: 'after' }).lean()
      if (!updated) throw conflict('change_request_locked', 'The change request was submitted meanwhile — reload')
      await audit(req, building, actor, 'change_request.updated', { objectType: 'ChangeRequest', objectId: cr._id, changes: Object.keys(body).map((f) => ({ objectType: 'ChangeRequest', objectId: String(cr._id), field: f, before: cr[f] ?? null, after: body[f] })) })
      return { changeRequest: { id: String(cr._id), status: updated.status } }
    },

    // Architect submits: the design diff and BOM impact are captured; the
    // affected items default to what the diff names.
    async submit(req, crId, actor) {
      const { cr, building } = await load(req, crId)
      if (!EDITABLE.includes(cr.status)) throw conflict('change_request_locked', `CR-${cr.number} is already ${cr.status.replace('_', ' ')}`)
      const impact = await impactOf(req, building, cr)
      if (impact.design.total === 0) throw conflict('no_change', 'The change request does not change the design yet — edit its branch first')
      // The HLD and LLD must agree (the LLD reconciliation, on the branch).
      const { consistent, problems } = await lld.consistency(req, building.id, String(cr.branchId))
      if (!consistent) {
        const text = problems.slice(0, 5).map((x) => `${x.label} (${x.state === 'inHldOnly' ? 'in the HLD, not mapped in the LLD' : x.state === 'inLldOnly' ? 'in the LLD, no longer in the HLD' : 'differs between HLD and LLD'})`)
        throw new AppError(409, 'hld_lld_inconsistent', `The change leaves the HLD and LLD out of step: ${text.join('; ')}${problems.length > 5 ? ` and ${problems.length - 5} more` : ''} — reconcile the LLD on the branch first`, { problems })
      }
      const parts = [impact.design, impact.design.hld].filter(Boolean)
      const named = parts.flatMap((d) => [...d.devices.added, ...d.devices.removed, ...d.devices.changed, ...d.connections.added, ...d.connections.removed, ...d.connections.changed]).map((x) => x.label).filter(Boolean)
      const affectedItems = cr.affectedItems.length ? cr.affectedItems : [...new Set(named)].slice(0, 200)
      const updated = await ChangeRequest.findOneAndUpdate({ _id: cr._id, status: { $in: EDITABLE } }, { $set: { status: 'submitted', impact, affectedItems, submittedBy: actor.userId, submittedAt: new Date() } }, { returnDocument: 'after' }).lean()
      if (!updated) throw conflict('change_request_locked', 'The change request was submitted meanwhile — reload')
      await audit(req, building, actor, 'change_request.submitted', { objectType: 'ChangeRequest', objectId: cr._id, comment: `CR-${cr.number}: ${impact.design.total} design change(s), ${impact.bom.total} BOM line change(s)` })
      // The PMs send it to the client.
      await notifyQuietly({ type: 'cr_submitted', buildingId: building.id, title: `CR-${cr.number} ${cr.title} submitted (${building.code})`, body: `${impact.design.total} design change(s), ${impact.bom.total} BOM line change(s)`, relatedObjectType: 'change_request', relatedObjectId: cr._id, link: paths.building(req.org.id, req.project.id, building.id, 'solution-package'), actorId: actor.userId, to: { roles: ['pm'] } })
      return { changeRequest: { id: String(cr._id), status: 'submitted', impact } }
    },

    // PM sends it to the client: a pending change-request approval and a
    // share link (token and password shown once).
    async send(req, crId, body, actor) {
      const { cr, building } = await load(req, crId)
      if (cr.status !== 'submitted') throw conflict('change_request_not_submitted', cr.status === 'awaiting_client' ? `CR-${cr.number} is already with the client` : `CR-${cr.number} must be submitted by the Architect first`)
      const pending = await Approval.exists({ buildingId: building.id, gate: 'change_request', status: 'pending' })
      if (pending) throw conflict('change_request_pending', 'Another change request of this building is with the client — one at a time')
      const secrets = await prepareSecrets(body.password)
      const sent = await withTransaction(async (session) => {
        const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'solution-package', gate: 'change_request', designVersionId: null, changeRequestId: cr._id, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
        const link = await createLink({ building, kind: 'change_request', approvalId: approval._id, changeRequestId: cr._id, secrets, expiryDays: body.expiryDays, actor, session })
        const updated = await ChangeRequest.findOneAndUpdate({ _id: cr._id, status: 'submitted' }, { $set: { status: 'awaiting_client', approvalId: approval._id } }, { session, returnDocument: 'after' })
        if (!updated) throw new AppError(409, 'change_request_not_submitted', 'The change request changed meanwhile — reload')
        await audit(req, building, actor, 'change_request.sent', { objectType: 'ChangeRequest', objectId: cr._id, comment: `CR-${cr.number} sent for client approval (link ${link._id})`, session })
        return { shareLink: { id: String(link._id), expiresAt: link.expiresAt, token: secrets.token, password: secrets.password, generatedPassword: secrets.generatedPassword, path: `/approve/${secrets.token}` } }
      })
      // The Architects (who drafted it) hear it is with the client.
      await notifyQuietly({ type: 'cr_sent', buildingId: building.id, title: `CR-${cr.number} ${cr.title} sent to the client (${building.code})`, relatedObjectType: 'change_request', relatedObjectId: cr._id, link: paths.building(req.org.id, req.project.id, building.id, 'solution-package'), actorId: actor.userId, to: { roles: ['architect'] } })
      return sent
    },

    async withdraw(req, crId, actor) {
      const { cr, building } = await load(req, crId)
      if (!['draft', 'changes_requested', 'submitted'].includes(cr.status)) throw conflict('change_request_locked', `CR-${cr.number} is ${cr.status.replace('_', ' ')} and cannot be withdrawn`)
      return withTransaction(async (session) => {
        await lld.discardChangeRequestBranch(req, { building, branchId: cr.branchId }, actor, session)
        await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'withdrawn', decidedAt: new Date() } }, { session })
        await audit(req, building, actor, 'change_request.withdrawn', { objectType: 'ChangeRequest', objectId: cr._id, comment: `CR-${cr.number}`, session })
        return { changeRequest: { id: String(cr._id), status: 'withdrawn' } }
      })
    },
  }
}
