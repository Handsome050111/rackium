import { evaluatePackage, GROUP_KEYS, REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'
import { ACTIONS, can, ROLE_LABELS } from '@rackium/shared/policy.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { Approval } from '../models/approval.js'
import { DesignVersion } from '../models/designVersion.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { Membership } from '../models/membership.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { withTransaction } from '../db/transaction.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { computeBom, resourceEstimateOf, writeSnapshotVersion, namesOf, id } from './common.js'
import { createLink, linksOf, prepareSecrets } from './shareLinks.js'

const LOCKED = { awaiting_client: 'The Solution Package is with the client for approval — revoke the link to edit it again', approved: 'The Solution Package is approved — changes go through a change request' }

// Everything the package is evaluated from (shared/solutionPackage.js).
async function packageFacts(lld, req, building, sp) {
  const { bom, design, settings } = await computeBom(lld, req, building)
  const [surveyStatus, hld, lldDoc] = await Promise.all([surveyStatusByBuilding(), HldDesign.findOne({ buildingId: building.id }).lean(), LldDesign.findOne({ buildingId: building.id }).lean()])
  const estimate = resourceEstimateOf(design, settings.resourceMinutes)
  const facts = {
    surveyApproved: surveyStatus.get(building.id) === 'approved',
    hldApproved: Boolean(hld?.latestApprovedVersionId) && hld.state === 'approved',
    lldApproved: Boolean(lldDoc?.latestApprovedVersionId) && lldDoc.state === 'approved',
    hldDeviceCount: design.devices.length,
    rackCount: design.racks.length,
    portScheduleCount: design.devices.filter((d) => d.ports?.length && !d.isPanel && d.role !== 'ap').length,
    connectionCount: design.connections.length,
    cableIdCount: design.connections.filter((c) => c.cableId).length,
    findings: { critical: design.findings.critical, warning: design.findings.warning },
    bom: { reconciled: bom.reconciliation.reconciled, unpricedCount: bom.unpricedCount },
    resourceMinutes: estimate.totalMinutes,
    groups: sp?.groups ?? [],
    acceptedWarnings: sp?.acceptedWarnings ?? [],
  }
  return { facts, evaluation: evaluatePackage(facts), bom, design, estimate, settings, hld, lld: lldDoc }
}

// Solution Package (brief v2.3 §5.5; M5a): Required Inputs, validation and
// approval readiness, and submission to the client by share link.
export function createSolutionPackageService({ storage, lld }) {
  const audit = (req, building, actor, action, extra) =>
    recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'solution-package', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })

  // Claims the package's next revision (creating it on first write), or refuses.
  async function claim(building, baseRevision, actor, session) {
    const existing = await SolutionPackage.findOne({ buildingId: building.id }).session(session).lean()
    if (!existing) {
      if (baseRevision !== 0) throw new AppError(409, 'stale_revision', 'The Solution Package changed since you loaded it — reload')
      const [created] = await SolutionPackage.create([{ buildingId: building.id, revision: 1, lastEditedAt: new Date(), lastEditedBy: actor.userId }], { session })
      return created.toObject()
    }
    if (LOCKED[existing.state]) throw conflict('solution_package_locked', LOCKED[existing.state])
    const updated = await SolutionPackage.findOneAndUpdate({ _id: existing._id, revision: baseRevision, state: { $nin: Object.keys(LOCKED) } }, { $inc: { revision: 1 }, $set: { lastEditedAt: new Date(), lastEditedBy: actor.userId } }, { session, returnDocument: 'after' }).lean()
    if (updated) return updated
    const who = (await namesOf([existing.lastEditedBy])).get(String(existing.lastEditedBy)) ?? 'someone'
    throw new AppError(409, 'stale_revision', `The Solution Package was changed by ${who} since you loaded it (revision ${existing.revision}, yours ${baseRevision}). Reload, then make your change again.`, { revision: existing.revision })
  }

  return {
    async view(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const sp = await SolutionPackage.findOne({ buildingId: building.id }).lean()
      const { evaluation, bom, estimate, settings, facts } = await packageFacts(lld, req, building, sp)
      const [members, approvals, crs, versions, links] = await Promise.all([
        Membership.find({ projectId: req.project.id, level: 'project', active: true }, { userId: 1, role: 1 }).lean(),
        Approval.find({ buildingId: building.id, gate: 'sp_client' }).sort({ submittedAt: -1 }).lean(),
        ChangeRequest.find({ buildingId: building.id }).sort({ number: -1 }).lean(),
        DesignVersion.find({ buildingId: building.id, designType: 'solution_package' }).sort({ number: -1 }).lean(),
        linksOf(building.id),
      ])
      const names = await namesOf([...members.map((m) => m.userId), ...approvals.map((a) => a.submittedBy), ...(sp?.groups ?? []).map((g) => g.ownerId)])
      const { roles } = await callerAccess(req)
      const memberList = [...new Map(members.map((m) => [String(m.userId), { id: String(m.userId), name: names.get(String(m.userId)) ?? 'member', role: m.role }])).values()]
      return {
        building: { id: building.id, code: building.code, name: building.name },
        state: sp?.state ?? 'draft',
        revision: sp?.revision ?? 0,
        status: spStatusOf(sp),
        ...evaluation,
        groups: evaluation.groups.map((g) => ({ ...g, ownerId: id(g.ownerId), ownerName: g.ownerId ? names.get(String(g.ownerId)) ?? null : null, dueDate: g.dueDate ? new Date(g.dueDate).toISOString().slice(0, 10) : null })),
        acceptedWarnings: (sp?.acceptedWarnings ?? []).map((w) => ({ areaKey: w.areaKey, text: w.text, acceptedBy: `${w.acceptedByName} (${ROLE_LABELS[w.acceptedByRole] ?? w.acceptedByRole})`, acceptedAt: w.acceptedAt })),
        resourceEstimate: estimate,
        resourceMinutes: settings.resourceMinutes,
        inputsRequired: evaluation.totalCount - evaluation.completeCount,
        criticalConflicts: facts.findings.critical,
        bomSummary: { lines: bom.lines.length, reconciled: bom.reconciliation.reconciled, unpricedCount: bom.unpricedCount },
        members: memberList,
        shareLinks: links.filter((l) => l.kind === 'solution_package'),
        approvals: approvals.map((a) => ({ id: String(a._id), status: a.status, submittedBy: names.get(String(a.submittedBy)) ?? null, submittedAt: a.submittedAt, versionNumber: versions.find((v) => String(v._id) === String(a.designVersionId))?.number ?? null, client: a.client ? { name: a.client.name, role: a.client.role } : null, decision: a.decision ? { value: a.decision.value, decidedAt: a.decision.decidedAt, comments: a.decision.comments, termsAccepted: a.decision.termsAccepted, signed: Boolean(a.decision.signatureFileId) } : null })),
        versions: versions.map((v) => ({ id: String(v._id), number: v.number, label: v.label, frozen: v.frozen, createdAt: v.createdAt })),
        changeRequests: crs.map((c) => ({ id: String(c._id), number: c.number, title: c.title, status: c.status, createdAt: c.createdAt, decidedAt: c.decidedAt })),
        permissions: { edit: can(roles, ACTIONS.EDIT_SOLUTION_PACKAGE), share: can(roles, ACTIONS.GENERATE_CLIENT_SHARE_LINK), standards: can(roles, ACTIONS.SET_COMMERCIAL_STANDARDS) },
      }
    },

    async updateGroup(req, groupKey, body, actor) {
      if (!GROUP_KEYS.includes(groupKey)) throw badRequest(`Unknown input group ${groupKey}`)
      if (groupKey === 'addressing' && body.kvPairs !== undefined) throw badRequest('Group 1 takes addressing entries, not key/value pairs')
      if (groupKey !== 'addressing' && body.addressingEntries !== undefined) throw badRequest('Only group 1 takes addressing entries')
      const building = await requireBuilding(req, body.buildingId)
      if (body.ownerId) {
        const member = await Membership.exists({ projectId: req.project.id, userId: body.ownerId, level: 'project', active: true })
        if (!member) throw badRequest('The owner must be a member of this project')
      }
      return withTransaction(async (session) => {
        const sp = await claim(building, body.baseRevision, actor, session)
        const groups = REQUIRED_INPUT_GROUPS.map((def) => sp.groups?.find((g) => g.key === def.key) ?? { key: def.key, ownerId: null, dueDate: null, addressingEntries: [], kvPairs: [] })
        const group = groups.find((g) => g.key === groupKey)
        if (body.ownerId !== undefined) group.ownerId = body.ownerId
        if (body.dueDate !== undefined) group.dueDate = body.dueDate ? new Date(`${body.dueDate}T00:00:00.000Z`) : null
        if (body.addressingEntries !== undefined) group.addressingEntries = body.addressingEntries
        if (body.kvPairs !== undefined) group.kvPairs = body.kvPairs
        const updated = await SolutionPackage.findOneAndUpdate({ _id: sp._id }, { $set: { groups } }, { session, returnDocument: 'after' }).lean()
        const def = REQUIRED_INPUT_GROUPS.find((g) => g.key === groupKey)
        await audit(req, building, actor, 'solution_package.inputs.updated', { objectType: 'SolutionPackage', objectId: sp._id, comment: `${def.n}. ${def.name}: ${Object.keys(body).filter((k) => !['buildingId', 'baseRevision'].includes(k)).join(', ')}`, session })
        return { revision: updated.revision }
      })
    },

    // A warning area accepted (page 3), with who accepted it and when.
    async acceptWarning(req, body, actor) {
      const building = await requireBuilding(req, body.buildingId)
      const sp = await SolutionPackage.findOne({ buildingId: building.id }).lean()
      const { evaluation } = await packageFacts(lld, req, building, sp)
      const area = evaluation.validationAreas.find((a) => a.key === body.areaKey)
      if (!area) throw badRequest(`Unknown validation area ${body.areaKey}`)
      if (area.result !== 'warning') throw conflict('not_acceptable', area.result === 'critical' ? `${area.name}: a Critical finding cannot be accepted — fix it` : `${area.name} has nothing to accept`)
      const { roles } = await callerAccess(req)
      const role = ['pm', 'architect'].find((r) => roles.includes(r)) ?? actor.role
      const name = (await namesOf([actor.userId])).get(String(actor.userId)) ?? 'user'
      return withTransaction(async (session) => {
        const claimed = await claim(building, body.baseRevision, actor, session)
        const updated = await SolutionPackage.findOneAndUpdate({ _id: claimed._id }, { $push: { acceptedWarnings: { areaKey: area.key, text: `${area.name}: ${area.description}`, acceptedBy: actor.userId, acceptedByName: name, acceptedByRole: role, acceptedAt: new Date() } } }, { session, returnDocument: 'after' }).lean()
        await audit(req, building, actor, 'solution_package.warning.accepted', { objectType: 'SolutionPackage', objectId: claimed._id, comment: `${area.name} (${area.passed}/${area.total})`, session })
        return { revision: updated.revision }
      })
    },

    // Submit to the client (PM): a frozen-on-approval package version, a
    // pending client approval and the share link (token and password shown once).
    async submitToClient(req, body, actor) {
      const building = await requireBuilding(req, body.buildingId)
      const sp = await SolutionPackage.findOne({ buildingId: building.id }).lean()
      if (sp && LOCKED[sp.state]) throw conflict('solution_package_locked', LOCKED[sp.state])
      const { evaluation, bom, hld, lld: lldDoc } = await packageFacts(lld, req, building, sp)
      if (!evaluation.readyForSubmission) throw new AppError(409, 'not_ready', `Not ready for client approval: ${evaluation.blockers.join('; ')}`, { blockers: evaluation.blockers })
      const secrets = await prepareSecrets(body.password)
      const sent = await withTransaction(async (session) => {
        let doc = sp
        if (!doc) [doc] = await SolutionPackage.create([{ buildingId: building.id }], { session })
        const payload = {
          project: { name: req.project.name ?? null, code: req.project.code ?? null },
          building: { id: building.id, code: building.code, name: building.name },
          basedOn: { hldVersionId: id(hld?.latestApprovedVersionId), lldVersionId: id(lldDoc?.latestApprovedVersionId) },
          sections: evaluation.sections,
          packageCompleteness: evaluation.packageCompleteness,
          checksPassed: evaluation.checksPassed,
          checksTotal: evaluation.checksTotal,
          groups: evaluation.groups.map((g) => ({ n: g.n, name: g.name, status: g.status })),
          acceptedWarnings: (sp?.acceptedWarnings ?? []).map((w) => ({ text: w.text, acceptedByName: w.acceptedByName, acceptedByRole: w.acceptedByRole, acceptedAt: w.acceptedAt })),
          bom: bom.lines.map((l) => ({ category: l.category, item: l.item, spec: l.spec, qty: l.qty, unit: l.unit })),
        }
        const { versionId, number } = await writeSnapshotVersion({ storage, building, designType: 'solution_package', label: `Solution Package v${(await DesignVersion.countDocuments({ buildingId: building.id, designType: 'solution_package' }).session(session)) + 1}`, payload, actor, basedOnVersionId: lldDoc?.latestApprovedVersionId ?? null, counts: { devices: bom.reconciliation.realCount, connections: 0 }, session })
        const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'solution-package', gate: 'sp_client', designVersionId: versionId, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
        const link = await createLink({ building, kind: 'solution_package', approvalId: approval._id, secrets, expiryDays: body.expiryDays, actor, session })
        await SolutionPackage.updateOne({ _id: doc._id }, { $set: { state: 'awaiting_client', pendingApprovalId: approval._id }, $inc: { revision: 1 } }, { session })
        await audit(req, building, actor, 'solution_package.submitted', { objectType: 'DesignVersion', objectId: versionId, comment: `Solution Package v${number} sent for client approval (link ${link._id}, expires ${link.expiresAt.toISOString().slice(0, 10)})`, session })
        return { versionNumber: number, shareLink: { id: String(link._id), expiresAt: link.expiresAt, token: secrets.token, password: secrets.password, generatedPassword: secrets.generatedPassword, path: `/approve/${secrets.token}` } }
      })
      await notifyQuietly({ type: 'sp_sent', buildingId: building.id, title: `Solution Package v${sent.versionNumber} of ${building.code} sent to the client`, body: `The link expires on ${new Date(sent.shareLink.expiresAt).toISOString().slice(0, 10)}.`, relatedObjectType: 'solution_package', relatedObjectId: sent.shareLink.id, link: paths.building(req.org.id, req.project.id, building.id, 'solution-package'), actorId: actor.userId, to: { roles: ['pm', 'architect'] } })
      return sent
    },
  }
}

export function spStatusOf(sp) {
  if (!sp) return 'not_started'
  if (sp.state === 'approved') return 'approved'
  if (sp.state === 'awaiting_client') return 'awaiting_approval'
  if (sp.state === 'changes_requested' || sp.state === 'rejected') return 'changes_requested'
  return 'in_progress'
}

export async function spStatusByBuilding() {
  const docs = await SolutionPackage.find({}, { buildingId: 1, state: 1 }).lean()
  return new Map(docs.map((d) => [String(d.buildingId), spStatusOf(d)]))
}
