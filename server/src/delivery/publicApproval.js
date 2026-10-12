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
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit } from '../audit/audit.js'
import { AppError } from '../http/errors.js'
import { buildingWithScopeIds } from '../access/scope.js'
import { readSnapshot } from './common.js'
import { withLink, assertUsable, checkPassword } from './shareLinks.js'

const KIND_LABEL = { solution_package: 'Solution Package', change_request: 'Change request' }

// The public approval page (brief v2.3 §5.5; M5a): no login and no app shell.
// Every call presents the link's token and password; the package is read-only.
export function createPublicApprovalService({ storage, lld }) {
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
    const cr = await ChangeRequest.findById(link.changeRequestId).lean()
    return { ...base, changeRequest: { number: cr.number, title: cr.title, description: cr.description, reason: cr.reason, affectedItems: cr.affectedItems, impact: cr.impact } }
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
        return { status, kind: link.kind, kindLabel: KIND_LABEL[link.kind] }
      })
    },

    async view(token, { password }) {
      return withLink(token, async (link) => {
        assertUsable(link)
        await checkPassword(link, password)
        return subject(link)
      })
    },

    // The client's decision: recorded on the approval with name, role,
    // comments, acceptance and the optional signature, and in the audit
    // (with the share link id). Expiry is checked again here.
    async decide(token, body) {
      return withLink(token, async (link, scope) => {
        assertUsable(link, { forDecision: true })
        await checkPassword(link, body.password)
        const signature = await storeSignature(link, scope, body.signature)
        const req = { org: { id: scope.organisationId }, project: { id: scope.projectId } }
        try {
          return await withTransaction(async (session) => {
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
            const outcome = link.kind === 'solution_package' ? await decideSolutionPackage({ approval, decision: body.decision, building, session }) : await decideChangeRequest({ req, link, decision: body.decision, building, actor, session })
            await recordAudit({
              organisationId: scope.organisationId,
              projectId: scope.projectId,
              buildingId: link.buildingId,
              phaseKey: 'solution-package',
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
            return { decision: body.decision, ...outcome }
          })
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

  // Approve: the branch replaces the frozen LLD (a new approved, frozen LLD
  // version). Request changes: back to the Architect. Reject: the branch goes.
  async function decideChangeRequest({ req, link, decision, building, actor, session }) {
    const cr = await ChangeRequest.findById(link.changeRequestId).session(session).lean()
    if (decision === 'approved') {
      const { versionId, number } = await lld.applyChangeRequest(req, { building, branchId: cr.branchId, label: `CR-${cr.number} ${cr.title}`.slice(0, 80) }, actor, session)
      await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: 'approved', decidedAt: new Date(), resultingVersionId: versionId } }, { session })
      return { lldVersionNumber: number }
    }
    if (decision === 'rejected') await lld.discardChangeRequestBranch(req, { building, branchId: cr.branchId }, actor, session)
    await ChangeRequest.updateOne({ _id: cr._id }, { $set: { status: decision, approvalId: null, ...(decision === 'rejected' ? { decidedAt: new Date() } : {}) } }, { session })
    return {}
  }
}
