import { bomImpact, withMargin } from '@rackium/shared/bomCalc.js'
import { procurementProblem, PROCUREMENT_STATUSES, PROCUREMENT_LABELS, nextStatuses } from '@rackium/shared/procurement.js'
import { canSeePrices } from '@rackium/shared/policy.js'
import { BomDesign } from '../models/bomDesign.js'
import { ProcurementLine } from '../models/procurementLine.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { Approval } from '../models/approval.js'
import { DesignVersion } from '../models/designVersion.js'
import { LldDesign } from '../models/lldDesign.js'
import { HldDesign } from '../models/hldDesign.js'
import { withTransaction } from '../db/transaction.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { computeBom, writeSnapshotVersion, readSnapshot, namesOf } from './common.js'

const PRICE_FIELDS = ['unitPriceMinor', 'lineTotalMinor']
const day = (v) => (v ? new Date(`${v}T00:00:00.000Z`) : null)
const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null)

// The BOM (brief v2.3 §5.6; M5a): a Draft calculated live from the design;
// after the Solution Package approval the PM approves it as the procurement
// BOM and the procurement fields unlock.
export function createBomService({ storage, lld }) {
  async function state(building) {
    const [sp, bomDesign] = await Promise.all([SolutionPackage.findOne({ buildingId: building.id }, { state: 1 }).lean(), BomDesign.findOne({ buildingId: building.id }).lean()])
    return { spApproved: sp?.state === 'approved', bomDesign }
  }
  async function approvedSnapshot(bomDesign) {
    if (!bomDesign?.approvedVersionId) return null
    const version = await DesignVersion.findById(bomDesign.approvedVersionId).lean()
    return version ? { version, snapshot: await readSnapshot(storage, version.snapshotFileId) } : null
  }
  const audit = (req, building, actor, action, extra) => recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'bom', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })

  return {
    async view(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const { bom, design, settings, org } = await computeBom(lld, req, building)
      const { spApproved, bomDesign } = await state(building)
      const approved = await approvedSnapshot(bomDesign)
      const impact = approved ? bomImpact(approved.snapshot, bom) : null
      const changed = new Set((impact?.lines ?? []).map((l) => l.key))
      const rows = await ProcurementLine.find({ buildingId: building.id }).lean()
      const rowByKey = new Map(rows.map((r) => [r.lineKey, r]))
      const names = await namesOf([...rows.map((r) => r.updatedBy), bomDesign?.approvedBy])
      const { roles } = await callerAccess(req)
      const showPrices = canSeePrices(roles, { architectsSeePrices: org.architectsSeePrices })
      const procurementOf = (key, vendor) => {
        const r = rowByKey.get(key)
        return {
          status: r?.status ?? 'not_ordered',
          vendor: r?.vendor ?? vendor ?? null,
          poNumber: r?.poNumber ?? null,
          expectedDelivery: dayOf(r?.expectedDelivery),
          actualDelivery: dayOf(r?.actualDelivery),
          notes: r?.notes ?? null,
          version: r?.version ?? 0,
          updatedBy: r ? names.get(String(r.updatedBy)) ?? null : null,
          updatedAt: r?.updatedAt ?? null,
          next: nextStatuses(r?.status ?? 'not_ordered'),
        }
      }
      const strip = (l) => (showPrices ? l : Object.fromEntries(Object.entries(l).filter(([k]) => !PRICE_FIELDS.includes(k))))
      const lines = bom.lines.map((l) => strip({ ...l, procurement: procurementOf(l.key, l.vendor), changedSinceApproval: changed.has(l.key) }))
      const lineKeys = new Set(bom.lines.map((l) => l.key))
      // Procurement facts for lines a later change removed from the BOM.
      const orphans = rows.filter((r) => !lineKeys.has(r.lineKey)).map((r) => ({ key: r.lineKey, lineType: r.lineType, procurement: procurementOf(r.lineKey, r.vendor) }))
      const bomApproved = Boolean(bomDesign?.approvedVersionId)
      return {
        building: { id: building.id, code: building.code, name: building.name },
        stage: design.stage,
        status: bomApproved && !impact?.total ? 'approved' : 'in_progress',
        subLabel: spApproved ? (bomApproved && impact?.total ? 'Changed since approval' : null) : 'Draft',
        lines,
        orphans,
        calc: bom.calc,
        reconciliation: bom.reconciliation,
        currency: bom.currency,
        unpricedCount: bom.unpricedCount,
        showPrices,
        pricing: showPrices ? { costMinor: bom.costMinor, marginPercent: settings.marginPercent, sellMinor: withMargin(bom.costMinor, settings.marginPercent) } : null,
        procurement: {
          unlocked: spApproved && bomApproved,
          spApproved,
          bomApproved,
          approvedAt: bomDesign?.approvedAt ?? null,
          approvedBy: names.get(String(bomDesign?.approvedBy)) ?? null,
          approvedVersionNumber: approved?.version.number ?? null,
          changesSinceApproval: impact?.lines ?? [],
          statuses: PROCUREMENT_STATUSES.map((s) => ({ key: s, label: PROCUREMENT_LABELS[s] })),
        },
      }
    },

    // The PM approves the procurement BOM (brief §5.6, D21: no separate
    // reviewer). Again after a change request changed it.
    async approve(req, { buildingId }, actor) {
      const building = await requireBuilding(req, buildingId)
      const { spApproved, bomDesign } = await state(building)
      if (!spApproved) throw conflict('solution_package_not_approved', 'The procurement BOM is approved after the client approves the Solution Package')
      const { bom } = await computeBom(lld, req, building)
      const approved = await approvedSnapshot(bomDesign)
      if (approved && bomImpact(approved.snapshot, bom).total === 0) throw conflict('already_approved', 'This BOM is already approved — nothing changed since')
      return withTransaction(async (session) => {
        const { versionId, number } = await writeSnapshotVersion({ storage, building, designType: 'bom', label: `Procurement BOM v${(approved?.version.number ?? 0) + 1}`, payload: { lines: bom.lines, costMinor: bom.costMinor, currency: bom.currency }, actor, frozen: true, counts: { devices: bom.reconciliation.realCount, connections: 0 }, session })
        const now = new Date()
        const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'bom', gate: 'bom_pm', designVersionId: versionId, submittedBy: actor.userId, submittedAt: now, status: 'approved', reviewerId: actor.userId, decision: { value: 'approved', decidedAt: now, decidedBy: actor.userId, decidedByRole: actor.role } }], { session })
        await BomDesign.updateOne({ buildingId: building.id }, { $set: { approvedVersionId: versionId, approvedAt: now, approvedBy: actor.userId, approvalId: approval._id } }, { upsert: true, session })
        await audit(req, building, actor, 'bom.approved', { objectType: 'DesignVersion', objectId: versionId, comment: `Procurement BOM v${number}: ${bom.lines.length} line(s)`, session })
        return { versionNumber: number }
      })
    },

    // One procurement line: status (validated transitions), vendor, PO,
    // expected/actual delivery, notes. Optimistic `version`.
    async updateLine(req, body, actor) {
      const building = await requireBuilding(req, body.buildingId)
      const { spApproved, bomDesign } = await state(building)
      if (!spApproved || !bomDesign?.approvedVersionId) throw conflict('procurement_locked', 'Procurement unlocks once the Solution Package is approved and the PM approves the procurement BOM')
      const { bom } = await computeBom(lld, req, building)
      const line = bom.lines.find((l) => l.key === body.lineKey)
      const current = await ProcurementLine.findOne({ buildingId: building.id, lineKey: body.lineKey }).lean()
      if (!line && !current) throw notFound('This line is not in the BOM')
      const patch = {}
      for (const f of ['status', 'vendor', 'poNumber', 'notes']) if (body[f] !== undefined) patch[f] = body[f] || (f === 'status' ? undefined : null)
      if (body.expectedDelivery !== undefined) patch.expectedDelivery = day(body.expectedDelivery)
      if (body.actualDelivery !== undefined) patch.actualDelivery = day(body.actualDelivery)
      const problem = procurementProblem(current ?? { status: 'not_ordered' }, { ...patch, actualDelivery: patch.actualDelivery !== undefined ? patch.actualDelivery : current?.actualDelivery })
      if (problem) throw badRequest(problem)
      return withTransaction(async (session) => {
        let saved
        const now = new Date()
        if (current) {
          saved = await ProcurementLine.findOneAndUpdate({ _id: current._id, version: body.version }, { $set: { ...patch, updatedBy: actor.userId, updatedAt: now }, $inc: { version: 1 } }, { session, returnDocument: 'after' }).lean()
        } else if (body.version === 0) {
          try {
            ;[saved] = await ProcurementLine.create([{ buildingId: building.id, lineKey: body.lineKey, lineType: line.lineType, deviceId: line.deviceId ?? null, vendor: line.vendor ?? null, ...patch, version: 1, updatedBy: actor.userId, updatedAt: now }], { session })
            saved = saved.toObject()
          } catch (err) {
            if (err.code !== 11000) throw err
          }
        }
        if (!saved) {
          const latest = await ProcurementLine.findOne({ buildingId: building.id, lineKey: body.lineKey }).session(session).lean()
          const who = (await namesOf([latest?.updatedBy])).get(String(latest?.updatedBy)) ?? 'someone'
          throw new AppError(409, 'stale_line', `This line was changed by ${who} since you loaded it. Reload, then make your change again.`, { version: latest?.version ?? 0 })
        }
        const changes = Object.keys(patch).map((f) => ({ objectType: 'ProcurementLine', objectId: String(saved._id), field: f, before: current?.[f] instanceof Date ? dayOf(current[f]) : current?.[f] ?? (f === 'status' ? 'not_ordered' : null), after: patch[f] instanceof Date ? dayOf(patch[f]) : patch[f] ?? null }))
        await audit(req, building, actor, 'procurement.line.updated', { objectType: 'ProcurementLine', objectId: saved._id, comment: `${line?.item ?? body.lineKey}${patch.status ? ` → ${PROCUREMENT_LABELS[patch.status]}` : ''}`, changes, session })
        return { line: { key: body.lineKey, status: saved.status, version: saved.version } }
      })
    },
  }
}

// BOM phase status per building (calculated): approved once the PM approved
// the procurement BOM, in progress while a design exists.
export async function bomStatusByBuilding() {
  const [designs, llds, hlds] = await Promise.all([BomDesign.find({ approvedVersionId: { $ne: null } }, { buildingId: 1 }).lean(), LldDesign.find({}, { buildingId: 1 }).lean(), HldDesign.find({}, { buildingId: 1 }).lean()])
  const out = new Map()
  for (const d of [...hlds, ...llds]) out.set(String(d.buildingId), 'in_progress')
  for (const d of designs) out.set(String(d.buildingId), 'approved')
  return out
}
