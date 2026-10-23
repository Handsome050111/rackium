import mongoose from 'mongoose'
import { addDays } from '@rackium/shared/timeZone.js'
import { expectedSurveyTabs } from '@rackium/shared/surveyForm.js'
import { can, ACTIONS } from '@rackium/shared/policy.js'
import { summarise } from '@rackium/shared/dguvRollup.js'
import { BomDesign } from '../models/bomDesign.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { DesignVersion } from '../models/designVersion.js'
import { ProcurementLine } from '../models/procurementLine.js'
import { Blocker } from '../models/blocker.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { Room } from '../models/room.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { User } from '../models/user.js'
import { projectSettings, computeBom } from '../delivery/common.js'
import { projectScope } from '../access/scope.js'
import { projectFacts, projectPeople, localDay } from '../insights/facts.js'

const pct = (a, b) => (b ? Math.round((Math.min(a, b) / b) * 100) : null)

// The data of each standard report (M7a-3), read with the requester's roles
// and scope (the job's request context: documents/service.js jobReq). A
// scoped member's report holds their buildings only; figures per person only
// for the Org Admin and PM; prices only as the request was allowed.
export function createReportData({ lld, deployment }) {
  async function weeklyStatus(req, now) {
    const facts = await projectFacts(req, { now, lld })
    const scope = await projectScope(req)
    const weekFrom = addDays(facts.today, -6)
    const blockers = (await Blocker.find({}, { buildingId: 1, raisedAt: 1, resolvedAt: 1, status: 1 }).lean()).filter((b) => b.buildingId && scope.coversBuilding(String(b.buildingId)))
    const inWeek = (d) => {
      const day = localDay(d, facts.timeZone)
      return day && day >= weekFrom && day <= facts.today
    }
    const horizon = addDays(facts.today, 14)
    const codeOf = new Map(facts.buildings.map((b) => [b.id, b.code]))
    const milestones = facts.schedule.milestones
      .filter((m) => !m.done && m.dueDate && m.dueDate >= facts.today && m.dueDate <= horizon)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((m) => ({ building: m.buildingId ? codeOf.get(String(m.buildingId)) ?? '—' : 'Project', name: m.name, dueDate: m.dueDate }))
    return {
      ...common(facts),
      weekFrom,
      milestones,
      buildings: facts.buildings.map((b) => ({ code: b.code, name: b.name, currentPhase: b.currentPhase, progress: b.progress, overdue: b.overdue, openBlockers: b.openBlockers, raised: blockers.filter((x) => String(x.buildingId) === b.id && inWeek(x.raisedAt)).length, resolved: blockers.filter((x) => String(x.buildingId) === b.id && x.status === 'resolved' && inWeek(x.resolvedAt)).length })),
    }
  }

  async function resourceUtilisation(req, now) {
    const facts = await projectFacts(req, { now, lld })
    // Checked again here: the request was refused earlier for anyone else.
    if (!facts.personLevel) throw new Error('The Resource Utilisation report is for the Org Admin and PMs')
    const people = await projectPeople(req, facts)
    return { ...common(facts), people: people.map((p) => ({ name: p.name, roles: [p.role], buildings: p.assigned.length, primaryFor: p.primaryFor, openTasks: p.openTasks, overdueTasks: p.overdueTasks, completed30: p.completed30 })) }
  }

  // Prices reach the data only when the request carries a price mode the
  // requester was allowed (documents/types.js requestProblem).
  async function bomSummary(req, now, options) {
    const priced = (options.prices ?? 'none') !== 'none'
    const facts = await projectFacts(req, { now, lld })
    const ids = facts.buildings.map((b) => new mongoose.Types.ObjectId(b.id))
    const [designs, lines, hlds, llds] = await Promise.all([BomDesign.find({ buildingId: { $in: ids } }).lean(), ProcurementLine.find({ buildingId: { $in: ids } }, { buildingId: 1, status: 1 }).lean(), HldDesign.find({ buildingId: { $in: ids } }, { buildingId: 1 }).lean(), LldDesign.find({ buildingId: { $in: ids } }, { buildingId: 1 }).lean()])
    const hasDesign = new Set([...hlds, ...llds].map((d) => String(d.buildingId)))
    const versions = new Map((await DesignVersion.find({ _id: { $in: designs.map((d) => d.approvedVersionId).filter(Boolean) } }, { number: 1 }).lean()).map((v) => [String(v._id), v.number]))
    const approvedOf = new Map(designs.filter((d) => d.approvedVersionId).map((d) => [String(d.buildingId), `v${versions.get(String(d.approvedVersionId)) ?? '?'}`]))
    const { marginPercent } = await projectSettings()
    const rows = []
    let currency = 'EUR'
    for (const b of facts.buildings.filter((x) => hasDesign.has(x.id))) {
      const { bom } = await computeBom(lld, req, b)
      if (!bom.lines.length) continue
      currency = bom.currency ?? currency
      const statuses = {}
      for (const l of lines.filter((x) => String(x.buildingId) === b.id)) statuses[l.status] = (statuses[l.status] ?? 0) + 1
      rows.push({ code: b.code, name: b.name, approved: approvedOf.get(b.id) ?? null, lines: bom.lines.length, serialised: bom.lines.filter((l) => l.lineType === 'serialised').length, unpriced: bom.unpricedCount, statuses, costMinor: priced ? bom.costMinor : null })
    }
    return { ...common(facts), currency, marginPercent: priced ? marginPercent : 0, buildings: rows }
  }

  async function surveyProgress(req, now) {
    const facts = await projectFacts(req, { now, lld })
    const ids = facts.buildings.map((b) => new mongoose.Types.ObjectId(b.id))
    const [rooms, records] = await Promise.all([Room.find({ buildingId: { $in: ids } }, { buildingId: 1 }).lean(), SurveyTabRecord.find({ buildingId: { $in: ids } }, { buildingId: 1, roomId: 1, tab: 1, status: 1, submitted: 1 }).lean()])
    const buildings = facts.buildings.map((b) => {
      const expected = expectedSurveyTabs(rooms.filter((r) => String(r.buildingId) === b.id).map((r) => String(r._id)))
      const wanted = new Set(expected.map((t) => `${t.tab}|${t.roomId ?? ''}`))
      const mine = records.filter((r) => String(r.buildingId) === b.id && wanted.has(`${r.tab}|${r.roomId ? String(r.roomId) : ''}`))
      const count = (...s) => mine.filter((r) => s.includes(r.status)).length
      const verified = count('verified', 'imported')
      return { code: b.code, expected: expected.length, verified, submitted: count('submitted'), rejected: count('rejected'), draft: expected.length - verified - count('submitted') - count('rejected'), pct: pct(verified, expected.length) }
    })
    const out = { ...common(facts), buildings }
    if (can(facts.roles, ACTIONS.VIEW_PERSON_METRICS)) {
      const by = new Map()
      for (const r of records.filter((x) => x.submitted?.by)) {
        const k = String(r.submitted.by)
        if (!by.has(k)) by.set(k, { submitted: 0, verified: 0, rejected: 0 })
        const x = by.get(k)
        x.submitted += 1
        if (['verified', 'imported'].includes(r.status)) x.verified += 1
        if (r.status === 'rejected') x.rejected += 1
      }
      const names = new Map((await User.find({ _id: { $in: [...by.keys()].map((k) => new mongoose.Types.ObjectId(k)) } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
      out.byTechnician = [...by.entries()].map(([k, x]) => ({ name: names.get(k) ?? 'Former member', ...x, pct: pct(x.verified, x.submitted) }))
    }
    return out
  }

  async function complianceReport(req, now) {
    const facts = await projectFacts(req, { now, lld, withValidation: true })
    return {
      ...common(facts),
      dguv: summarise(facts.dguvItems),
      buildings: facts.buildings.map((b) => ({ code: b.code, devices: b.dguv.counts.total, compliantPct: b.dguv.compliantPct, overdue: b.dguv.counts.overdue, notInspected: b.dguv.counts.not_inspected, expiring: b.dguv.counts.expiring + b.dguv.counts.expiring_soon, critical: b.validation?.critical ?? 0, warning: b.validation?.warning ?? 0 })),
    }
  }

  async function designChange(req, now) {
    const facts = await projectFacts(req, { now, lld })
    const codeOf = new Map(facts.buildings.map((b) => [b.id, b.code]))
    const rows = (await ChangeRequest.find({}).sort({ buildingId: 1, number: 1 }).lean()).filter((c) => codeOf.has(String(c.buildingId)))
    return { ...common(facts), changes: rows.map((c) => ({ building: codeOf.get(String(c.buildingId)), number: c.number, title: c.title, status: c.status, submittedOn: localDay(c.submittedAt, facts.timeZone) ?? '—', decidedOn: localDay(c.decidedAt, facts.timeZone) ?? '—', affected: (c.affectedItems ?? []).length, reason: c.reason || '—' })) }
  }

  async function installationProgress(req, now) {
    const facts = await projectFacts(req, { now, lld })
    const buildings = []
    for (const b of facts.buildings) {
      const dep = await deployment.view(req, b.id)
      buildings.push(dep.started ? { code: b.code, started: true, devices: dep.pipeline.devices, connections: dep.pipeline.connections, openExceptions: (dep.exceptions ?? []).filter((e) => e.status === 'open').length, progress: dep.pipeline.progress } : { code: b.code, started: false })
    }
    return { ...common(facts), buildings }
  }

  const loaders = { 'weekly-status': weeklyStatus, 'resource-utilisation': resourceUtilisation, 'bom-summary': bomSummary, 'survey-progress': surveyProgress, 'compliance-report': complianceReport, 'design-change': designChange, 'installation-progress': installationProgress }
  return {
    async load(typeKey, req, { now = new Date(), options = {} } = {}) {
      const loader = loaders[typeKey]
      if (!loader) throw new Error(`Unknown report ${typeKey}`)
      return loader(req, now, options)
    },
  }
}

const common = (facts) => ({ today: facts.today, timeZone: facts.timeZone, scope: facts.scope })
