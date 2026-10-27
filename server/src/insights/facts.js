import mongoose from 'mongoose'
import { computeOverallProgress } from '@rackium/shared/phaseCalculations.js'
import { isDone } from '@rackium/shared/schedule.js'
import { summarise } from '@rackium/shared/dguvRollup.js'
import { isOverdue } from '@rackium/shared/notifications.js'
import { canSeePrices, can, ACTIONS } from '@rackium/shared/policy.js'
import { scopeCoversBuilding } from '@rackium/shared/scope.js'
import { withMargin } from '@rackium/shared/bomCalc.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { Building } from '../models/building.js'
import { Country } from '../models/country.js'
import { Blocker } from '../models/blocker.js'
import { Task } from '../models/task.js'
import { HldDesign } from '../models/hldDesign.js'
import { LldDesign } from '../models/lldDesign.js'
import { Membership } from '../models/membership.js'
import { User } from '../models/user.js'
import { Organisation } from '../models/organisation.js'
import { computeSchedule } from '../schedule/service.js'
import { dguvDevices } from '../deployment/asBuilt.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { callerAccess, projectScope } from '../access/scope.js'
import { computeBom, projectSettings } from '../delivery/common.js'

// What the M7a-3 dashboards, rollups, workload and reports count (brief v2.2
// §21.5, §21.6, §21.9), per building the caller can open — never more: a
// scoped member's totals are over their buildings only. Runs in the
// project's tenant scope. The phase statuses, risk and overdue come from the
// schedule (M7a-1), so every screen agrees on them.

const DAY_MS = 86400000
const id = (v) => (v ? String(v) : null)

// `withValidation`: the design's open findings (Critical, Warning) per
// building; `withBom`: the BOM's value — only computed for a caller who may
// see prices, so nothing priced is ever loaded for anyone else.
export async function projectFacts(req, { now = new Date(), lld, withValidation = false, withBom = false } = {}) {
  const scope = await projectScope(req)
  const { roles } = await callerAccess(req)
  const time = await orgTimeSettings(req.org.id)
  const tz = time.timeZone
  const org = await Organisation.findById(req.org.id, { 'settings.architectsSeePrices': 1 }).lean()
  const pricesVisible = canSeePrices(roles, { architectsSeePrices: Boolean(org?.settings?.architectsSeePrices) })
  const inScope = scope.buildings
  const schedule = await computeSchedule({ buildings: inScope.map((b) => ({ id: b.id })), now, timeZone: tz, scopeLimited: !scope.unrestricted })
  const [countries, blockers, docs, designed, dguv] = await Promise.all([
    Country.find({}, { code: 1, name: 1 }).lean(),
    Blocker.find({ status: { $ne: 'resolved' } }, { buildingId: 1, salId: 1 }).lean(),
    Building.find({}, { primaryArchitectId: 1, primaryFieldEngineerId: 1 }).lean(),
    withValidation || withBom ? Promise.all([HldDesign.find({}, { buildingId: 1 }).lean(), LldDesign.find({}, { buildingId: 1 }).lean()]) : [[], []],
    dguvDevices({ organisationId: req.org.id, projectId: req.project.id, now }),
  ])
  const countryOf = new Map(countries.map((c) => [String(c._id), c]))
  const docOf = new Map(docs.map((b) => [String(b._id), b]))
  const hasDesign = new Set([...designed[0], ...designed[1]].map((d) => String(d.buildingId)))
  const barsOf = new Map()
  for (const bar of schedule.plan.bars) {
    if (!barsOf.has(bar.buildingId)) barsOf.set(bar.buildingId, [])
    barsOf.get(bar.buildingId).push(bar)
  }
  const order = new Map(schedule.phaseKeys.map((p, i) => [p, i]))
  const settings = withBom && pricesVisible ? await projectSettings() : null

  const buildings = []
  for (const b of inScope) {
    const bars = (barsOf.get(b.id) ?? []).sort((x, y) => order.get(x.phaseKey) - order.get(y.phaseKey))
    const current = bars.find((x) => !isDone(x.status))
    const items = dguv.filter((x) => String(x.rec.buildingId) === b.id).map((x) => ({ inspected: x.inspected, exempt: Boolean(x.exempt), status: x.status?.status ?? null }))
    const country = b.countryId ? countryOf.get(b.countryId) : null
    const row = {
      id: b.id,
      code: b.code,
      name: b.name,
      salId: b.salId,
      salCode: b.salCode,
      countryId: b.countryId,
      countryCode: country?.code ?? null,
      countryName: country?.name ?? null,
      primaryArchitectId: id(docOf.get(b.id)?.primaryArchitectId),
      primaryFieldEngineerId: id(docOf.get(b.id)?.primaryFieldEngineerId),
      phases: bars.map((x) => ({ phaseKey: x.phaseKey, status: x.status, risk: x.risk, target: x.target ?? null })),
      progress: computeOverallProgress(bars.map((x) => ({ status: x.status }))),
      currentPhase: bars.length ? current?.phaseKey ?? 'done' : null,
      overdue: bars.filter((x) => x.risk === 'overdue').map((x) => ({ phaseKey: x.phaseKey, target: x.target })),
      atRisk: bars.some((x) => ['overdue', 'at_risk', 'blocked'].includes(x.risk)),
      openBlockers: blockers.filter((x) => (x.buildingId ? String(x.buildingId) === b.id : false)).length,
      dguv: summarise(items),
      validation: null,
      bom: null,
    }
    if (hasDesign.has(b.id)) {
      if (withBom && pricesVisible) {
        const { bom, design } = await computeBom(lld, req, b)
        row.validation = withValidation ? { critical: design.findings.critical, warning: design.findings.warning } : null
        row.bom = { costMinor: bom.costMinor, sellMinor: withMargin(bom.costMinor, settings.marginPercent), unpriced: bom.unpricedCount, lines: bom.lines.length, currency: bom.currency }
      } else if (withValidation) {
        const design = await lld.designData(req, b.id)
        row.validation = { critical: design.findings.critical, warning: design.findings.warning }
      }
    }
    buildings.push(row)
  }
  return {
    now,
    today: schedule.today,
    timeZone: tz,
    phaseKeys: schedule.phaseKeys,
    scope: { buildings: buildings.length, limited: !scope.unrestricted },
    roles,
    personLevel: can(roles, ACTIONS.VIEW_PERSON_METRICS),
    pricesVisible,
    buildings,
    schedule,
    dguvItems: dguv.filter((x) => scope.coversBuilding(x.rec.buildingId)).map((x) => ({ inspected: x.inspected, exempt: Boolean(x.exempt), status: x.status?.status ?? null })),
  }
}

// The value of the BOMs (cost and client price) over buildings — present only
// when the facts were loaded for a caller who may see prices.
export function bomValueOf(buildings) {
  const priced = buildings.filter((b) => b.bom)
  if (!priced.length) return { costMinor: 0, sellMinor: 0, unpricedLines: 0, buildings: 0, currency: null }
  return { costMinor: priced.reduce((n, b) => n + b.bom.costMinor, 0), sellMinor: priced.reduce((n, b) => n + b.bom.sellMinor, 0), unpricedLines: priced.reduce((n, b) => n + b.bom.unpriced, 0), buildings: priced.length, currency: priced[0].bom.currency }
}

// The project's people and their work, over the caller's buildings: active
// project members whose scope reaches one of them, or who have a task in
// one. Tasks count when they are in a building in scope or project-wide.
export async function projectPeople(req, facts) {
  const now = facts.now
  const inScope = new Map(facts.buildings.map((b) => [b.id, b]))
  const [members, tasks] = await Promise.all([
    Membership.find({ level: 'project', projectId: new mongoose.Types.ObjectId(String(req.project.id)), active: true }, { userId: 1, role: 1, scopes: 1 }).lean(),
    Task.find({}, { buildingId: 1, assignedTo: 1, status: 1, deadline: 1, completedAt: 1 }).lean(),
  ])
  const visible = tasks.filter((t) => !t.buildingId || inScope.has(String(t.buildingId)))
  const users = new Map((await User.find({ _id: { $in: members.map((m) => m.userId) } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]))
  const people = []
  for (const m of members) {
    const userId = String(m.userId)
    const mine = visible.filter((t) => String(t.assignedTo) === userId)
    const reaches = facts.buildings.some((b) => scopeCoversBuilding(m.scopes ?? [], b))
    if (!reaches && !mine.length) continue
    const open = mine.filter((t) => t.status !== 'complete')
    const cells = {}
    const projectWide = { tasks: 0, overdue: 0 }
    for (const t of open) {
      const target = t.buildingId ? (cells[String(t.buildingId)] ??= { tasks: 0, overdue: 0 }) : projectWide
      target.tasks += 1
      if (isOverdue(t, now, facts.timeZone)) target.overdue += 1
    }
    const primaryFor = facts.buildings.filter((b) => b.primaryArchitectId === userId || b.primaryFieldEngineerId === userId)
    const assigned = [...new Set([...primaryFor.map((b) => b.id), ...Object.keys(cells)])].map((bid) => inScope.get(bid)).filter(Boolean)
    const u = users.get(userId)
    people.push({
      userId,
      name: u?.name || u?.email || 'Member',
      role: m.role,
      cells,
      projectWide,
      primaryFor: primaryFor.map((b) => b.code),
      assigned: assigned.map((b) => ({ buildingId: b.id, code: b.code, currentPhase: b.currentPhase })),
      openTasks: open.length,
      overdueTasks: open.filter((t) => isOverdue(t, now, facts.timeZone)).length,
      completed30: mine.filter((t) => t.status === 'complete' && t.completedAt && now - new Date(t.completedAt) <= 30 * DAY_MS).length,
    })
  }
  people.sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name))
  return people
}

// Team utilisation without names: how many of the members have open work.
export function utilisationOf(people) {
  const active = people.filter((p) => p.openTasks > 0).length
  return { members: people.length, active, utilisationPct: people.length ? Math.round((active / people.length) * 100) : null, openTasks: people.reduce((n, p) => n + p.openTasks, 0), overdueTasks: people.reduce((n, p) => n + p.overdueTasks, 0) }
}

export const localDay = (d, tz) => (d ? localDate(d, tz) : null)
