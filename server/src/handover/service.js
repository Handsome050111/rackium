import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { handoverChecklist, checklistReady, shownState, handoverActionProblem, HANDOVER_STATE_LABELS, handoverPhaseStatus } from '@rackium/shared/documents/handover.js'
import { HANDOVER_TYPES, HANDOVER_FILE_COUNT, FORMAT_MIME, clientShareProblem } from '@rackium/shared/documents/types.js'
import { toCsv } from '@rackium/shared/documents/model.js'
import { HandoverWorkflow } from '../models/handoverWorkflow.js'
import { HandoverBaseline } from '../models/handoverBaseline.js'
import { GeneratedDocument } from '../models/generatedDocument.js'
import { Approval } from '../models/approval.js'
import { File } from '../models/file.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { BomDesign } from '../models/bomDesign.js'
import { Building } from '../models/building.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, conflict, forbidden } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { withTransaction } from '../db/transaction.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { hldStatusByBuilding } from '../hld/service.js'
import { spStatusByBuilding } from '../delivery/solutionPackage.js'
import { linksOf, createLink, prepareSecrets } from '../delivery/shareLinks.js'
import { namesOf } from '../delivery/common.js'
// The ZIP writer loads on first use (the package is built rarely).
const renderZip = async (entries) => (await import('../documents/render/office.js')).renderZip(entries)
import { documentView } from '../documents/service.js'
import { modeLabelsOf } from '../hld/cmoDecisions.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))

// Handover phase status per building (calculated from the workflow).
export async function handoverStatusByBuilding(session = null) {
  const rows = await HandoverWorkflow.find({}, { buildingId: 1, state: 1 }).session(session).lean()
  return new Map(rows.map((r) => [String(r.buildingId), handoverPhaseStatus(r.state)]))
}

// Handover (brief v2.3 §5.9, v2.2 §3.11; DATA-MODEL §5.12; M6b): the
// checklist, compiling the 11 documents as background jobs, review, delivery
// to the client by share link, and — on the client's acceptance — the
// immutable baseline, after which the design is read-only.
export function createHandoverService({ storage, services, documents }) {
  const audit = (req, building, actor, action, extra) => recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'handover', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })
  const link = (req, building) => paths.building(req.org.id, req.project.id, building.id, 'handover')

  async function workflowOf(building, session = null) {
    const existing = await HandoverWorkflow.findOne({ buildingId: building.id }).session(session)
    if (existing) return existing
    try {
      const [w] = await HandoverWorkflow.create([{ buildingId: building.id }], { session })
      return w
    } catch (err) {
      if (err.code !== 11000) throw err
      return HandoverWorkflow.findOne({ buildingId: building.id }).session(session)
    }
  }

  async function facts(req, building) {
    const [survey, hld, lldDoc, sp, bomDesign] = await Promise.all([surveyStatusByBuilding(), hldStatusByBuilding(), LldDesign.findOne({ buildingId: building.id }, { frozen: 1, latestApprovedVersionId: 1 }).lean(), spStatusByBuilding(), BomDesign.findOne({ buildingId: building.id }, { approvedVersionId: 1 }).lean()])
    const bom = await services.delivery.bom.view(req, building.id).catch(() => ({ lines: [] }))
    const dep = await services.deployment.view(req, building.id)
    const cmdb = dep.started ? await services.cmdb.view(req, building.id) : null
    // Kit removed after cutover is no longer deployed (DATA-MODEL §5.22).
    const devices = (dep.devices ?? []).filter((d) => d.status !== 'retired')
    const removals = dep.removals ?? []
    const workflow = await HandoverWorkflow.findOne({ buildingId: building.id }, { oldGearOverride: 1 }).lean()
    const override = workflow?.oldGearOverride ?? null
    const unresolved = devices.reduce((n, d) => n + (d.openDeviations ?? 0), 0)
    return {
      surveyVerified: survey.get(building.id) === 'approved',
      hldApproved: hld.get(building.id) === 'approved',
      lldApproved: Boolean(lldDoc?.frozen && lldDoc?.latestApprovedVersionId),
      spApproved: sp.get(building.id) === 'approved',
      bom: { approved: Boolean(bomDesign?.approvedVersionId), lines: bom.lines.length, undelivered: bom.lines.filter((l) => (l.procurement?.status ?? 'not_ordered') !== 'delivered').length },
      deployment: { planned: devices.length, accepted: devices.filter((d) => ['accepted', 'in_service', 'maintenance'].includes(d.status)).length },
      cmdb: { designCount: cmdb?.reconciliation?.designCount ?? devices.length, cmdbCount: cmdb?.reconciliation?.cmdbCount ?? 0 },
      exceptions: { open: (dep.exceptions ?? []).filter((e) => e.status === 'open').length, rejectedUncorrected: unresolved },
      // After cutover: installed interim kit blocks; CMO gear left on site is a warning the PM may override.
      cutover: {
        interimOnSite: removals.filter((r) => r.kind === 'interim' && r.onSite).map((r) => r.label),
        cmoOnSite: removals.filter((r) => r.kind === 'cmo' && !r.removed).map((r) => ({ id: r.id, name: r.label })),
        override: override ? { reason: override.reason, by: override.byName ?? null, at: override.at ?? null, deviceIds: (override.devices ?? []).map((d) => d.id) } : null,
      },
      labels: await modeLabelsOf(),
    }
  }

  // The documents of a compile round, per handover type and format.
  async function roundDocuments(workflow) {
    if (!workflow.round) return []
    // The package ZIP carries the round too; it is not one of the round's documents.
    return GeneratedDocument.find({ 'handover.workflowId': workflow._id, 'handover.round': workflow.round, typeKey: { $ne: 'handover-package' } }).sort({ requestedAt: 1 }).lean()
  }
  const documentTable = (docs) =>
    HANDOVER_TYPES.map((t) => {
      const files = t.handover.map((format) => {
        const d = docs.filter((x) => x.typeKey === t.key && x.format === format).sort((a, b) => b.version - a.version)[0]
        return { format, document: d ? documentView(d) : null }
      })
      const statuses = files.map((f) => f.document?.status ?? 'missing')
      const status = statuses.every((s) => s === 'ready') ? 'ready' : statuses.some((s) => s === 'failed') ? 'failed' : statuses.some((s) => s === 'missing') ? 'not_compiled' : 'generating'
      return { key: t.key, name: t.name, formats: t.handover, status, files }
    })

  // The package ZIP of a compiled round: every document plus a manifest.
  async function buildPackage(req, building, workflow, docs, actorId) {
    for (const d of docs) if (clientShareProblem(d)) throw new Error(clientShareProblem(d))
    const entries = []
    const manifest = [['Document', 'Format', 'Version', 'File', 'SHA-256', 'Bytes']]
    for (const d of docs) {
      const file = await File.findById(d.fileId).lean()
      entries.push({ path: d.fileName, data: await storage.read(file.storageKey) })
      manifest.push([d.typeKey, d.format, d.version, d.fileName, d.sha256, d.sizeBytes])
    }
    // CMO gear the PM kept on site, with the reason (DATA-MODEL §5.22).
    const kept = workflow.oldGearOverride
    if (kept?.devices?.length) {
      entries.push({ path: 'kept-on-site.csv', data: toCsv([['Device', 'Reason', 'Kept by', 'At'], ...kept.devices.map((d) => [d.name, kept.reason, kept.byName ?? '', kept.at ? new Date(kept.at).toISOString() : ''])]) })
      manifest.push(['kept-on-site', 'csv', '', 'kept-on-site.csv', '', ''])
    }
    entries.push({ path: 'manifest.csv', data: toCsv(manifest) })
    const buffer = await renderZip(entries)
    const last = await GeneratedDocument.findOne({ buildingId: oid(building.id), typeKey: 'handover-package', format: 'zip' }).sort({ version: -1 }).lean()
    const version = (last?.version ?? 0) + 1
    const fileId = new mongoose.Types.ObjectId()
    const fileName = `${building.code}-handover-package-v${version}.zip`
    const storageKey = `documents/${req.project.id}/${fileId}`
    await storage.put(storageKey, buffer)
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
    const [pkg] = await GeneratedDocument.create([{ buildingId: building.id, typeKey: 'handover-package', format: 'zip', version, status: 'ready', progress: 100, requestKey: `handover:${workflow._id}:${workflow.round}`, requestedBy: actorId, requestedByName: 'Handover', handover: { workflowId: workflow._id, round: workflow.round }, fileId, fileName, sizeBytes: buffer.length, sha256, finishedAt: new Date(), options: { round: workflow.round } }])
    await File.create({ _id: fileId, buildingId: building.id, attachedTo: { type: 'generatedDocument', id: pkg._id }, category: 'document', fileName, storageKey, mimeType: FORMAT_MIME.zip, sizeBytes: buffer.length, sha256, uploadedBy: actorId })
    return pkg
  }

  async function view(req, buildingId) {
    const building = await requireBuilding(req, buildingId)
    const { roles } = await callerAccess(req)
    const workflow = (await HandoverWorkflow.findOne({ buildingId: building.id }).lean()) ?? { state: 'pending', round: 0 }
    const checklist = handoverChecklist(await facts(req, building))
    const ready = checklistReady(checklist)
    const docs = workflow._id ? await roundDocuments(workflow) : []
    const baseline = await HandoverBaseline.findOne({ buildingId: building.id }).sort({ number: -1 }).lean()
    const approvals = workflow._id ? await Approval.find({ buildingId: building.id, gate: 'handover_client' }).sort({ submittedAt: -1 }).lean() : []
    const names = await namesOf([workflow.compiledBy, workflow.reviewedBy, workflow.deliveredBy])
    const pkg = workflow.packageDocumentId ? await GeneratedDocument.findById(workflow.packageDocumentId).lean() : null
    const state = shownState(workflow.state, ready)
    return {
      building: { id: building.id, code: building.code, name: building.name },
      state,
      stateLabel: HANDOVER_STATE_LABELS[state],
      phaseStatus: handoverPhaseStatus(workflow._id ? workflow.state : null),
      round: workflow.round ?? 0,
      checklist,
      ready,
      documents: documentTable(docs),
      compiledCount: docs.filter((d) => d.status === 'ready').length,
      fileCount: HANDOVER_FILE_COUNT,
      package: pkg ? documentView(pkg) : null,
      timeline: { compiledAt: workflow.compiledAt ?? null, compiledBy: names.get(String(workflow.compiledBy)) ?? null, reviewedAt: workflow.reviewedAt ?? null, reviewedBy: names.get(String(workflow.reviewedBy)) ?? null, deliveredAt: workflow.deliveredAt ?? null, deliveredBy: names.get(String(workflow.deliveredBy)) ?? null, acceptedAt: workflow.acceptedAt ?? null },
      lastDecision: workflow.lastDecision ?? null,
      approvals: approvals.map((a) => ({ id: String(a._id), status: a.status, submittedAt: a.submittedAt, client: a.client ? { name: a.client.name, role: a.client.role } : null, decision: a.decision ? { value: a.decision.value, decidedAt: a.decision.decidedAt, comments: a.decision.comments, signed: Boolean(a.decision.signatureFileId) } : null })),
      shareLinks: (await linksOf(building.id)).filter((l) => l.kind === 'handover'),
      baseline: baseline ? { label: baseline.label, acceptedAt: baseline.acceptedAt, client: baseline.client, documents: baseline.documents.length, packageDocumentId: baseline.packageDocumentId ? String(baseline.packageDocumentId) : null } : null,
      permissions: { compile: roles.includes('pm') && !handoverActionProblem('compile', { state: workflow.state, ready, roles }), review: !handoverActionProblem('review', { state: workflow.state, roles }), deliver: !handoverActionProblem('deliver', { state: workflow.state, roles }), keepOldGear: roles.includes('pm') && !['delivered', 'accepted'].includes(workflow.state) },
    }
  }

  async function step(req, buildingId, action, actor, fn) {
    const building = await requireBuilding(req, buildingId)
    const { roles } = await callerAccess(req)
    const workflow = await workflowOf(building)
    const ready = action === 'compile' ? checklistReady(handoverChecklist(await facts(req, building))) : true
    const problem = handoverActionProblem(action, { state: workflow.state, ready, roles })
    if (problem) throw /Only/.test(problem) ? forbidden(problem) : conflict('invalid_step', problem)
    return fn(building, workflow)
  }

  return {
    view,
    handoverStatusByBuilding,

    // Compile: a new round of the 11 documents as background jobs.
    // The PM keeps CMO gear marked Replace or Remove on site at handover, with
    // a reason (decision 4 as the product owner ruled; DATA-MODEL §5.22): the
    // checklist's warning is then met for the devices on site now. null
    // withdraws it. Audited; listed in the handover package.
    async keepOldGear(req, buildingId, { reason }, actor) {
      const building = await requireBuilding(req, buildingId)
      const { roles } = await callerAccess(req)
      if (!roles.includes('pm')) throw forbidden('Only a PM keeps old gear on site at handover')
      const workflow = await workflowOf(building)
      if (['delivered', 'accepted'].includes(workflow.state)) throw conflict('invalid_step', `The handover is ${HANDOVER_STATE_LABELS[workflow.state]} — nothing can change now`)
      const { cutover } = await facts(req, building)
      if (reason && !cutover.cmoOnSite.length) throw conflict('nothing_on_site', 'No gear marked Replace or Remove is left on site')
      const byName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const before = workflow.oldGearOverride?.reason ?? null
      const next = reason ? { reason, by: actor.userId, byName, at: new Date(), devices: cutover.cmoOnSite } : null
      const done = await HandoverWorkflow.updateOne({ _id: workflow._id, revision: workflow.revision }, { $set: { oldGearOverride: next, updatedAt: new Date() }, $inc: { revision: 1 } })
      if (!done.modifiedCount) throw conflict('stale', 'The handover changed meanwhile — reload')
      await audit(req, building, actor, reason ? 'handover.old_gear_kept' : 'handover.old_gear_override_withdrawn', {
        objectType: 'HandoverWorkflow',
        objectId: String(workflow._id),
        comment: reason ? `${cutover.cmoOnSite.map((d) => d.name).join(', ')} kept on site: ${reason}` : 'Keeping old gear on site withdrawn',
        changes: [{ objectType: 'HandoverWorkflow', objectId: String(workflow._id), field: 'oldGearOverride', before, after: reason }],
      })
      return view(req, building.id)
    },

    async compile(req, buildingId, actor) {
      return step(req, buildingId, 'compile', actor, async (building, workflow) => {
        const updated = await HandoverWorkflow.findOneAndUpdate({ _id: workflow._id, revision: workflow.revision }, { $set: { state: 'compiling', compiledAt: null, packageDocumentId: null, updatedAt: new Date() }, $inc: { round: 1, revision: 1 } }, { returnDocument: 'after' }).lean()
        if (!updated) throw conflict('stale', 'The handover changed meanwhile — reload')
        for (const t of HANDOVER_TYPES) for (const format of t.handover) await documents.enqueue(req, { buildingId: building.id, typeKey: t.key, format, options: {}, handover: { workflowId: updated._id, round: updated.round } }, actor)
        await audit(req, building, actor, 'handover.compile_started', { objectType: 'HandoverWorkflow', objectId: String(updated._id), comment: `Round ${updated.round}: ${HANDOVER_FILE_COUNT} file(s) queued` })
        return view(req, building.id)
      })
    },

    // Failed documents of the current round queued again.
    async retryFailed(req, buildingId, actor) {
      const building = await requireBuilding(req, buildingId)
      const { roles } = await callerAccess(req)
      if (!roles.includes('pm')) throw forbidden('Only a PM compiles the handover package')
      const workflow = await workflowOf(building)
      if (workflow.state !== 'compiling') throw conflict('invalid_step', 'Nothing is being compiled')
      const docs = await roundDocuments(workflow)
      for (const t of HANDOVER_TYPES) {
        for (const format of t.handover) {
          const latest = docs.filter((d) => d.typeKey === t.key && d.format === format).sort((a, b) => b.version - a.version)[0]
          if (!latest || latest.status === 'failed') await documents.enqueue(req, { buildingId: building.id, typeKey: t.key, format, options: { retry: (latest?.version ?? 0) + 1 }, handover: { workflowId: workflow._id, round: workflow.round } }, actor)
        }
      }
      return view(req, building.id)
    },

    // Called when one of a round's documents is ready or failed: the round
    // complete → the package ZIP is built and the workflow is Compiled.
    async documentFinished(job) {
      const workflow = await HandoverWorkflow.findById(job.handover.workflowId).lean()
      if (!workflow || workflow.state !== 'compiling' || workflow.round !== job.handover.round) return
      const docs = await roundDocuments(workflow)
      const table = documentTable(docs)
      if (!table.every((t) => t.status === 'ready')) return
      const req = { org: { id: String(job.organisationId) }, project: { id: String(job.projectId) } }
      const building = { id: String(workflow.buildingId), code: (await Building.findById(workflow.buildingId, { code: 1 }).lean())?.code ?? 'building' }
      const latest = table.flatMap((t) => t.files.map((f) => docs.find((d) => String(d._id) === f.document.id)))
      // Claimed once per round; Compiled only together with the package, so
      // the screen never shows Compiled without it.
      const claimed = await HandoverWorkflow.findOneAndUpdate({ _id: workflow._id, state: 'compiling', round: workflow.round, packagingRound: { $ne: workflow.round } }, { $set: { packagingRound: workflow.round } }, { returnDocument: 'after' }).lean()
      if (!claimed) return
      const pkg = await buildPackage(req, building, workflow, latest, job.requestedBy)
      const done = await HandoverWorkflow.updateOne({ _id: workflow._id, state: 'compiling', round: workflow.round }, { $set: { state: 'compiled', compiledAt: new Date(), compiledBy: job.requestedBy, packageDocumentId: pkg._id, updatedAt: new Date() }, $inc: { revision: 1 } })
      if (!done.modifiedCount) return // recompiled meanwhile: this round's package is left unused
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'handover', actor: userActor(job.requestedBy), action: 'handover.compiled', objectType: 'HandoverWorkflow', objectId: String(workflow._id), changeType: 'system', source: 'system', comment: `Round ${workflow.round}: ${latest.length} file(s) and the package ${pkg.fileName}` })
    },

    async review(req, buildingId, actor) {
      return step(req, buildingId, 'review', actor, async (building, workflow) => {
        const done = await HandoverWorkflow.updateOne({ _id: workflow._id, state: 'compiled' }, { $set: { state: 'under_review', reviewedAt: new Date(), reviewedBy: actor.userId, updatedAt: new Date() }, $inc: { revision: 1 } })
        if (!done.modifiedCount) throw conflict('stale', 'The handover changed meanwhile — reload')
        await audit(req, building, actor, 'handover.reviewed', { objectType: 'HandoverWorkflow', objectId: String(workflow._id) })
        return view(req, building.id)
      })
    },

    // Sent to the client: an approval and a password-protected, time-limited share link.
    async deliver(req, buildingId, body, actor) {
      const secrets = await prepareSecrets(body.password)
      const result = await step(req, buildingId, 'deliver', actor, async (building, workflow) =>
        withTransaction(async (session) => {
          const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'handover', gate: 'handover_client', designVersionId: null, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
          const done = await HandoverWorkflow.updateOne({ _id: workflow._id, state: 'under_review' }, { $set: { state: 'delivered', deliveredAt: new Date(), deliveredBy: actor.userId, approvalId: approval._id, updatedAt: new Date() }, $inc: { revision: 1 } }, { session })
          if (!done.modifiedCount) throw conflict('stale', 'The handover changed meanwhile — reload')
          const shareLink = await createLink({ building, kind: 'handover', approvalId: approval._id, secrets, expiryDays: body.expiryDays, actor, session })
          await audit(req, building, actor, 'handover.delivered', { objectType: 'HandoverWorkflow', objectId: String(workflow._id), comment: `Share link ${shareLink._id}, expires ${shareLink.expiresAt.toISOString().slice(0, 10)}`, session })
          return { building, shareLink }
        })
      )
      return { shareLink: { id: String(result.shareLink._id), token: secrets.token, password: secrets.password, generatedPassword: secrets.generatedPassword, url: `/approve/${secrets.token}`, expiresAt: result.shareLink.expiresAt }, handover: await view(req, result.building.id) }
    },

    // What the client sees through the link: the package's documents.
    async publicSubject(link) {
      const workflow = await HandoverWorkflow.findOne({ buildingId: link.buildingId }).lean()
      const docs = workflow ? await roundDocuments(workflow) : []
      const pkg = workflow?.packageDocumentId ? await GeneratedDocument.findById(workflow.packageDocumentId).lean() : null
      return { handover: { round: workflow?.round ?? 0, state: workflow?.state ?? 'pending', documents: documentTable(docs).map((t) => ({ key: t.key, name: t.name, files: t.files.filter((f) => f.document?.status === 'ready').map((f) => ({ id: f.document.id, format: f.format, fileName: f.document.fileName, sizeBytes: f.document.sizeBytes })) })), package: pkg ? { id: String(pkg._id), fileName: pkg.fileName, sizeBytes: pkg.sizeBytes } : null } }
    },
    // The documents a handover link may download (its own round only).
    async publicDocumentIds(link) {
      const workflow = await HandoverWorkflow.findOne({ buildingId: link.buildingId }).lean()
      if (!workflow) return []
      const docs = await roundDocuments(workflow)
      return [...docs.map((d) => String(d._id)), ...(workflow.packageDocumentId ? [String(workflow.packageDocumentId)] : [])]
    },

    // The client's decision (inside the public approval transaction).
    async decide({ approval, decision, comments, client, building, scope, session }) {
      const workflow = await HandoverWorkflow.findOne({ buildingId: building.id }).session(session).lean()
      if (!workflow || workflow.state !== 'delivered') throw new AppError(409, 'already_decided', 'This handover is no longer awaiting a decision.')
      const now = new Date()
      const lastDecision = { value: decision, by: client.name, role: client.role, comments: comments || null, at: now }
      if (decision !== 'approved') {
        await HandoverWorkflow.updateOne({ _id: workflow._id }, { $set: { state: 'changes_requested', approvalId: null, lastDecision, updatedAt: now }, $inc: { revision: 1 } }, { session })
        return { accepted: false }
      }
      // Accepted: the immutable baseline, written once.
      const docs = await roundDocuments(workflow)
      const number = (await HandoverBaseline.countDocuments({ buildingId: building.id }).session(session)) + 1
      const [hld, lld, sp, bom] = await Promise.all([HldDesign.findOne({ buildingId: building.id }).session(session).lean(), LldDesign.findOne({ buildingId: building.id }).session(session).lean(), SolutionPackage.findOne({ buildingId: building.id }).session(session).lean(), BomDesign.findOne({ buildingId: building.id }).session(session).lean()])
      const [baseline] = await HandoverBaseline.create(
        [
          {
            buildingId: building.id,
            number,
            label: `v${number}.0`,
            acceptedAt: now,
            approvalId: approval._id,
            client: { name: client.name, role: client.role },
            designVersionIds: { hld: hld?.latestApprovedVersionId ?? null, lld: lld?.latestApprovedVersionId ?? null, solutionPackage: sp?.latestApprovedVersionId ?? null, bom: bom?.approvedVersionId ?? null },
            documents: docs.filter((d) => d.status === 'ready').map((d) => ({ documentId: d._id, typeKey: d.typeKey, format: d.format, version: d.version, fileName: d.fileName, sha256: d.sha256, sizeBytes: d.sizeBytes })),
            packageDocumentId: workflow.packageDocumentId ?? null,
          },
        ],
        { session }
      )
      await HandoverWorkflow.updateOne({ _id: workflow._id }, { $set: { state: 'accepted', acceptedAt: now, baselineId: baseline._id, lastDecision, updatedAt: now }, $inc: { revision: 1 } }, { session })
      await recordAudit({ organisationId: scope.organisationId, projectId: scope.projectId, buildingId: building.id, phaseKey: 'handover', actor: { type: 'client_link', clientName: client.name, clientRole: client.role, shareLinkId: client.shareLinkId }, action: 'handover.baseline_written', objectType: 'HandoverBaseline', objectId: String(baseline._id), changeType: 'client_decision', source: 'client_link', comment: `Baseline ${baseline.label}: ${baseline.documents.length} document(s); design read-only`, session })
      return { accepted: true, baseline: baseline.label }
    },

    notifyDecision({ scope, building, decision, clientName }) {
      const verb = decision === 'approved' ? 'accepted' : decision === 'rejected' ? 'rejected' : 'requested changes to'
      return notifyQuietly({ type: decision === 'approved' ? 'handover_accepted' : 'handover_changes_requested', buildingId: building.id, title: `${clientName} (client) ${verb} the handover of ${building.code}`, relatedObjectType: 'handover', relatedObjectId: building.id, link: paths.building(scope.organisationId, scope.projectId, building.id, 'handover'), to: { roles: ['pm', 'architect'] } })
    },

    link,
  }
}

// Builds the immutable baseline lookup for a building (read-only).
export async function baselineOf(buildingId) {
  return HandoverBaseline.findOne({ buildingId }).sort({ number: -1 }).lean()
}
