import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { ShareLink } from '../models/shareLink.js'
import { Approval } from '../models/approval.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { DesignVersion } from '../models/designVersion.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { Project } from '../models/project.js'
import { File } from '../models/file.js'
import { GeneratedDocument } from '../models/generatedDocument.js'
import { typeOf } from '@rackium/shared/documents/types.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { recordAudit } from '../audit/audit.js'
import { AppError } from '../http/errors.js'
import { buildingWithScopeIds } from '../access/scope.js'
import { readSnapshot } from './common.js'
import { withLink, assertUsable, checkPassword } from './shareLinks.js'
import { impactWithoutCost } from './changeRequests.js'
import { createReprintTask, notifyReprintTask } from '../deployment/reprint.js'

const KIND_LABEL = { solution_package: 'Solution Package', change_request: 'Change request', handover: 'Handover package', document_download: 'Documents' }

// The public approval page (brief v2.3 §5.5; M5a): no login and no app shell.
// Every call presents the link's token and password; the package is read-only.
// `getHandover`: the handover service (M6b), created after this one.
export function createPublicApprovalService({ storage, lld, getHandover = () => null }) {
  async function subject(link) {
    const building = await buildingWithScopeIds(link.buildingId)
    // Project is organisation-scoped: name the link's own project.
    const project = await Project.findById(currentScope().projectId, { name: 1, code: 1, clientName: 1 }).lean()
    const base = { kind: link.kind, kindLabel: KIND_LABEL[link.kind], expiresAt: link.expiresAt, building: { code: building.code, name: building.name }, project: { name: project?.name ?? null, code: project?.code ?? null, clientName: project?.clientName ?? null } }
    if (link.kind === 'solution_package') {
      const approval = await Approval.findById(link.approvalId).lean()
      const version = await DesignVersion.findById(approval.designVersionId).lean()
      const snap = await readSnapshot(storage, version.snapshotFileId)
      return { ...base, versionNumber: version.number, package: { sections: snap.sections.map((s) => ({ n: s.n, name: s.name, completeness: s.completeness })), packageCompleteness: snap.packageCompleteness, checksPassed: snap.checksPassed, checksTotal: snap.checksTotal, groups: snap.groups, acceptedWarnings: snap.acceptedWarnings, bom: snap.bom } }
    }
    if (link.kind === 'handover') return { ...base, ...(await getHandover().publicSubject(link)) }
    if (link.kind === 'document_download') {
      const docs = await GeneratedDocument.find({ _id: { $in: link.documentIds }, status: 'ready', 'options.prices': { $ne: 'cost' } }).lean()
      return { ...base, label: link.label ?? null, documents: docs.map((d) => ({ id: String(d._id), name: typeOf(d.typeKey)?.name ?? d.typeKey, format: d.format, version: d.version, fileName: d.fileName, sizeBytes: d.sizeBytes })) }
    }
    const cr = await ChangeRequest.findById(link.changeRequestId).lean()
    return { ...base, changeRequest: { number: cr.number, title: cr.title, description: cr.description, reason: cr.reason, affectedItems: cr.affectedItems, impact: impactWithoutCost(cr.impact) } }
  }

  async function storeSignature(link, scope, dataUrl) {
    if (!dataUrl) return null
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
    if (bytes.length > 300 * 1024) throw new AppError(400, 'bad_request', 'The signature is too large')
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AppError(400, 'bad_request', 'The signature must be a PNG image')
    const fileId = new mongoose.Types.ObjectId()
    const storageKey = `files/${scope.projectId}/${fileId}`
    await storage.put(storageKey, bytes)
    return { fileId, storageKey, bytes }
  }

  return {
    // Only whether the link can be used — nothing about the package.
    async status(token) {
      return withLink(token, async (link) => {
        const now = new Date()
        const status = link.revokedAt ? 'revoked' : link.decidedAt ? 'decided' : link.expiresAt <= now ? 'expired' : 'active'
        return { status, kind: link.kind, kindLabel: KIND_LABEL[link.kind], passwordRequired: Boolean(link.passwordHash) }
      })
    },

    async view(token, { password }) {
      return withLink(token, async (link) => {
        // A decided handover link keeps showing (and serving) its package until it expires.
        const keepsServing = link.kind === 'handover' && link.decidedAt && !link.revokedAt && link.expiresAt > new Date()
        if (!keepsServing) assertUsable(link)
        await checkPassword(link, password)
        return subject(link)
      })
    },

    // The client's decision: recorded on the approval with name, role,
    // comments, acceptance and the optional signature, and in the audit
    // (with the share link id). Expiry is checked again here.
    // A file behind a handover or download link (M6b): the link must still be
    // usable (a decided handover link keeps serving its package), the password
    // right, and the document one the link names. Every download is audited.
    async download(token, documentId, { password }) {
      return withLink(token, async (link, scope) => {
        if (!['handover', 'document_download'].includes(link.kind)) throw new AppError(404, 'not_found', 'Nothing to download through this link')
        if (link.revokedAt || link.expiresAt <= new Date()) assertUsable(link)
        await checkPassword(link, password)
        const allowed = link.kind === 'handover' ? await getHandover().publicDocumentIds(link) : link.documentIds.map(String)
        if (!mongoose.isValidObjectId(documentId) || !allowed.includes(String(documentId))) throw new AppError(404, 'not_found', 'Document not found')
        // Cost-price (internal) documents never leave through a link, whatever the link lists.
        const doc = await GeneratedDocument.findOne({ _id: documentId, status: 'ready', 'options.prices': { $ne: 'cost' } }).lean()
        const file = doc ? await File.findById(doc.fileId).lean() : null
        if (!file) throw new AppError(404, 'not_found', 'Document not found')
        await ShareLink.updateOne({ _id: link._id }, { $inc: { downloads: 1 } })
        await recordAudit({ organisationId: scope.organisationId, projectId: scope.projectId, buildingId: link.buildingId, actor: { type: 'client_link', clientName: null, clientRole: null, shareLinkId: link._id }, action: 'document.downloaded', objectType: 'GeneratedDocument', objectId: String(doc._id), changeType: 'system', source: 'client_link', comment: `${doc.fileName} via share link` })
        return { file, stream: storage.stream(file.storageKey) }
      })
    },

    async decide(token, body) {
      return withLink(token, async (link, scope) => {
        if (link.kind === 'document_download') throw new AppError(404, 'not_found', 'This link has nothing to decide')
        assertUsable(link, { forDecision: true })
        await checkPassword(link, body.password)
        const signature = await storeSignature(link, scope, body.signature)
        const req = { org: { id: scope.organisationId }, project: { id: scope.projectId } }
        // Created with an approved change request that renamed installed devices (M7b-2).
        let reprintTask = null
        try {
          const result = await withTransaction(async (session) => {
            const now = new Date()
            // Expiry and single use, inside the transaction: the link is claimed for this decision.
            const claimed = await ShareLink.findOneAndUpdate({ _id: link._id, decidedAt: null, revokedAt: null, expiresAt: { $gt: now } }, { $set: { decidedAt: now } }, { session, returnDocument: 'after' })
            if (!claimed) {
              const fresh = await ShareLink.findById(link._id).session(session).lean()
              assertUsable(fresh, { forDecision: true })
              throw new AppError(409, 'already_decided', 'A decision was already recorded through this link.')
            }
            const client = { name: body.name, role: body.role || null, shareLinkId: link._id }
            const decision = { value: body.decision, decidedAt: now, decidedBy: null, decidedByRole: 'client', comments: body.comments || null, termsAccepted: true, signatureFileId: signature?.fileId ?? null }
            const approval = await Approval.findOneAndUpdate({ _id: link.approvalId, status: 'pending' }, { $set: { status: body.decision, client, decision } }, { session, returnDocument: 'after' }).lean()
            if (!approval) throw new AppError(409, 'already_decided', 'This approval is no longer pending.')
            if (signature) {
              await File.create([{ _id: signature.fileId, buildingId: link.buildingId, attachedTo: { type: 'approval', id: approval._id }, category: 'signature', fileName: `signature-${approval._id}.png`, storageKey: signature.storageKey, mimeType: 'image/png', sizeBytes: signature.bytes.length, sha256: crypto.createHash('sha256').update(signature.bytes).digest('hex'), uploadedBy: approval.submittedBy }], { session })
            }
            const building = await buildingWithScopeIds(link.buildingId, session)
            const actor = { userId: approval.submittedBy, role: null, client }
            const outcome =
              link.kind === 'handover'
                ? await getHandover().decide({ approval, decision: body.decision, comments: body.comments, client, building, scope, session })
                : link.kind === 'solution_package'
                  ? await decideSolutionPackage({ approval, decision: body.decision, building, session })
                  : await decideChangeRequest({ req, link, decision: body.decision, building, actor, session, onReprint: (task) => (reprintTask = task) })
            await recordAudit({
              organisationId: scope.organisationId,
              projectId: scope.projectId,
              buildingId: link.buildingId,
              phaseKey: link.kind === 'handover' ? 'handover' : 'solution-package',
              actor: { type: 'client_link', clientName: body.name, clientRole: body.role || null, shareLinkId: link._id },
              action: `${link.kind}.client_${body.decision}`,
              objectType: 'Approval',
              objectId: String(approval._id),
              changeType: 'client_decision',
              source: 'client_link',
              comment: [body.comments, body.signature ? 'signed' : null, 'terms accepted'].filter(Boolean).join(' · '),
              changes: [{ objectType: 'Approval', objectId: String(approval._id), field: 'status', before: 'pending', after: body.decision }],
              session,
            })
            return { decision: body.decision, ...outcome, crId: link.changeRequestId ? String(link.changeRequestId) : null }
          })
          // PMs and Architects of the building hear the client's decision.
          if (link.kind === 'handover') {
            const building = await buildingWithScopeIds(link.buildingId)
            await getHandover().notifyDecision({ scope, building, decision: body.decision, clientName: body.name })
            const { crId: _ignored, ...outHandover } = result
            return outHandover
          }
          await notifyReprintTask({ organisationId: scope.organisationId, projectId: scope.projectId, task: reprintTask })
          const kind = link.kind === 'solution_package' ? 'sp' : 'cr'
          const cr = kind === 'cr' ? await ChangeRequest.findById(link.changeRequestId, { number: 1, title: 1 }).lean() : null
          const what = kind === 'sp' ? 'the Solution Package' : `CR-${cr?.number} ${cr?.title ?? ''}`.trim()
          const verb = { approved: 'approved', changes_requested: 'requested changes to', rejected: 'rejected' }[body.decision]
          await notifyQuietly({ type: `${kind}_${body.decision}`, buildingId: String(link.buildingId), title: `${body.name} (client) ${verb} ${what}`, body: body.comments || null, relatedObjectType: kind === 'sp' ? 'solution_package' : 'change_request', relatedObjectId: kind === 'sp' ? link._id : link.changeRequestId, link: paths.building(scope.organisationId, scope.projectId, String(link.buildingId), 'solution-package'), to: { roles: ['pm', 'architect'] } })
          const { crId: _crId, ...out } = result
          return out
        } catch (err) {
          if (signature) await storage.remove(signature.storageKey).catch(() => {})
          throw err
        }
      })
    },
  }

  // Approve: the package version freezes, HLD and LLD freeze, procurement
  // unlocks. Request changes / reject: the LLD returns to In progress.
  async function decideSolutionPackage({ approval, decision, building, session }) {
    const now = new Date()
    if (decision === 'approved') {
      await DesignVersion.updateOne({ _id: approval.designVersionId }, { $set: { frozen: true, frozenAt: now } }, { session })
      await SolutionPackage.updateOne({ buildingId: building.id }, { $set: { state: 'approved', pendingApprovalId: null, latestApprovedVersionId: approval.designVersionId, approvedAt: now }, $inc: { revision: 1 } }, { session })
      const freeze = { $set: { frozen: true, frozenAt: now, frozenByApprovalId: approval._id }, $inc: { revision: 1 } }
      await HldDesign.updateOne({ buildingId: building.id }, freeze, { session })
      await LldDesign.updateOne({ buildingId: building.id }, freeze, { session })
      return { frozen: true }
    }
    await SolutionPackage.updateOne({ buildingId: building.id }, { $set: { state: decision, pendingApprovalId: null }, $inc: { revision: 1 } }, { session })
    await LldDesign.updateOne({ buildingId: building.id }, { $set: { state: 'draft' }, $inc: { revision: 1 } }, { session })
    return { frozen: false }
  }

  // Approve: the branch replaces the frozen HLD and LLD (new approved, frozen
  // versions of both). Request changes: back to the Architect. Reject: the
  // branch (HLD and LLD) goes.
  async function decideChangeRequest({ req, link, decision, building, actor, session, onReprint }) {
    const cr = await ChangeRequest.findById(link.changeRequestId).session(session).lean()
    if (decision === 'approved') {
      const { versionId, number, hldVersionId, hldNumber, renamed } = await lld.applyChangeRequest(req, { building, branchId: cr.branchId, label: `CR-${cr.number} ${cr.title}`.slice(0, 80) }, actor, session)
      // Renamed devices already installed: the labels on site are reprinted (DATA-MODEL §5.19).
      onReprint(await createReprintTask({ organisationId: req.org.id, projectId: req.project.id, building, changeRequest: cr, renamed, sentBy: actor.userId, session }))
      await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'approved', decidedAt: new Date(), resultingVersionId: versionId, resultingHldVersionId: hldVersionId } }, { session })
      return { lldVersionNumber: number, hldVersionNumber: hldNumber }
    }
    if (decision === 'rejected') await lld.discardChangeRequestBranch(req, { building, branchId: cr.branchId }, actor, session)
    await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: decision, approvalId: null, ...(decision === 'rejected' ? { decidedAt: new Date() } : {}) } }, { session })
    return {}
  }
}
