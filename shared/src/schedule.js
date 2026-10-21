// Project Management Suite, part 1 (brief v2.2 §21.1–21.4, §21.7–21.8; M7a-1;
// DATA-MODEL §5.10 as built). Pure: the phase bars of the Gantt with their
// default starts, risk and the critical path; dependencies and cycles; the
// standard milestones; SLA status, projection and burn-down.
//
// Every date is a local calendar date 'YYYY-MM-DD' in the organisation's time
// zone; "today" is the organisation's local date (timeZone.js localDate). Day
// counts are calendar days, so a DST change never moves a deadline.
import { addDays } from './timeZone.js'
import { PROGRESS_WEIGHT } from './phaseCalculations.js'

export const SCHEDULE_DEFAULTS = { riskElapsedPct: 80, riskProgressPct: 50 }
export const DONE_STATUSES = new Set(['completed', 'approved'])
export const isDone = (status) => DONE_STATUSES.has(status)
export const RISK_LABEL = { done: 'Done', overdue: 'Overdue', blocked: 'Blocked', at_risk: 'At risk', on_track: 'On track', unscheduled: 'Unscheduled' }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isLocalDate(value) {
  const m = DATE_RE.exec(String(value ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === value
}
// Calendar days from a to b (b - a).
export function daysBetween(a, b) {
  const t = (s) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((t(b) - t(a)) / 86400000)
}
const maxDate = (a, b) => (!a ? b : !b ? a : a > b ? a : b)
export const keyOf = (buildingId, phaseKey) => `${buildingId}|${phaseKey}`

// A phase's progress 0–1: its own measure when there is one, else the status weight.
export function phaseProgress(status, measure = null) {
  if (isDone(status)) return 1
  if (typeof measure === 'number' && Number.isFinite(measure)) return Math.min(1, Math.max(0, measure))
  return PROGRESS_WEIGHT[status] ?? 0
}

// The predecessors of every building × phase: the previous active phase in
// the building (unless the phase is marked parallel) and the cross-building
// dependencies pointing at it (finish-to-start).
export function predecessorsOf({ buildingIds, phaseKeys, parallelPhases = [], dependencies = [] }) {
  const parallel = new Set(parallelPhases)
  const preds = new Map()
  for (const b of buildingIds) {
    phaseKeys.forEach((p, i) => {
      const list = []
      if (i > 0 && !parallel.has(p)) list.push(keyOf(b, phaseKeys[i - 1]))
      preds.set(keyOf(b, p), list)
    })
  }
  for (const d of dependencies) {
    const to = keyOf(d.to.buildingId, d.to.phaseKey)
    const from = keyOf(d.from.buildingId, d.from.phaseKey)
    if (preds.has(to) && preds.has(from)) preds.get(to).push(from)
  }
  return preds
}

// True when adding `candidate` (a dependency) would make a cycle.
export function createsCycle({ buildingIds, phaseKeys, parallelPhases, dependencies, candidate }) {
  const preds = predecessorsOf({ buildingIds, phaseKeys, parallelPhases, dependencies: [...dependencies, candidate] })
  const state = new Map()
  const visit = (k) => {
    if (state.get(k) === 1) return true
    if (state.get(k) === 2) return false
    state.set(k, 1)
    for (const p of preds.get(k) ?? []) if (visit(p)) return true
    state.set(k, 2)
    return false
  }
  return [...preds.keys()].some(visit)
}

// The risk of one phase bar (v2.2 §21.4).
export function phaseRisk({ status, progress, start, target, blocked = false, predecessorsDone = true, today, settings = SCHEDULE_DEFAULTS }) {
  if (isDone(status)) return 'done'
  if (!target) return 'unscheduled'
  if (today > target) return 'overdue'
  if (blocked || (!predecessorsDone && start && today >= start)) return 'blocked'
  if (start && today >= start) {
    const span = Math.max(1, daysBetween(start, target))
    const elapsedPct = (daysBetween(start, today) / span) * 100
    if (elapsedPct >= (settings.riskElapsedPct ?? SCHEDULE_DEFAULTS.riskElapsedPct) && progress * 100 < (settings.riskProgressPct ?? SCHEDULE_DEFAULTS.riskProgressPct)) return 'at_risk'
  }
  return 'on_track'
}

// Every bar of the Gantt. `rows`: { [key]: { status, measure, startDate, targetDate, completedOn, blocked } }.
export function scheduleBars({ buildingIds, phaseKeys, parallelPhases = [], dependencies = [], rows = {}, today, settings = SCHEDULE_DEFAULTS }) {
  const preds = predecessorsOf({ buildingIds, phaseKeys, parallelPhases, dependencies })
  const bars = []
  const byKey = new Map()
  for (const b of buildingIds) {
    phaseKeys.forEach((p, i) => {
      const key = keyOf(b, p)
      const row = rows[key] ?? {}
      const previousTarget = i > 0 ? rows[keyOf(b, phaseKeys[i - 1])]?.targetDate ?? null : null
      const start = row.startDate ?? previousTarget ?? null
      const bar = {
        key,
        buildingId: b,
        phaseKey: p,
        status: row.status ?? 'not_started',
        progress: phaseProgress(row.status ?? 'not_started', row.measure),
        startDate: row.startDate ?? null,
        start: start && row.targetDate && start > row.targetDate ? row.targetDate : start,
        target: row.targetDate ?? null,
        completedOn: row.completedOn ?? null,
        blocked: Boolean(row.blocked),
        predecessors: preds.get(key) ?? [],
      }
      bars.push(bar)
      byKey.set(key, bar)
    })
  }
  for (const bar of bars) {
    const predecessorsDone = bar.predecessors.every((k) => isDone(byKey.get(k)?.status))
    bar.risk = phaseRisk({ status: bar.status, progress: bar.progress, start: bar.start, target: bar.target, blocked: bar.blocked, predecessorsDone, today, settings })
    // A start before a predecessor's target: the plan contradicts a dependency.
    bar.conflicts = bar.predecessors.filter((k) => bar.start && byKey.get(k)?.target && bar.start < byKey.get(k).target)
  }
  const critical = criticalPath(bars)
  for (const bar of bars) bar.critical = critical.has(bar.key)
  return { bars, critical: [...critical], end: bars.reduce((e, b) => maxDate(e, b.target), null) }
}

// The chain that sets the end date: from the bar with the latest target, back
// through its predecessors, always to the one that finishes last.
export function criticalPath(bars) {
  const byKey = new Map(bars.map((b) => [b.key, b]))
  const scheduled = bars.filter((b) => b.target)
  if (!scheduled.length) return new Set()
  let current = scheduled.reduce((a, b) => (b.target > a.target ? b : a))
  const path = new Set()
  while (current && !path.has(current.key)) {
    path.add(current.key)
    const preds = current.predecessors.map((k) => byKey.get(k)).filter((b) => b?.target)
    current = preds.length ? preds.reduce((a, b) => (b.target > a.target ? b : a)) : null
  }
  return path
}

// The ten standard milestones (v2.2 §21.3), each tied to a phase or to the procurement lines.
export const STANDARD_MILESTONES = [
  { key: 'survey_complete', name: 'Survey Complete', phaseKey: 'survey' },
  { key: 'hld_approved', name: 'HLD Approved', phaseKey: 'hld' },
  { key: 'lld_approved', name: 'LLD Approved', phaseKey: 'lld' },
  { key: 'sp_approved', name: 'Solution Package Approved', phaseKey: 'solution-package' },
  { key: 'bom_approved', name: 'BOM Approved', phaseKey: 'bom' },
  { key: 'materials_ordered', name: 'Materials Ordered', phaseKey: 'bom', procurement: 'ordered' },
  { key: 'materials_delivered', name: 'Materials Delivered', phaseKey: 'bom', procurement: 'delivered' },
  { key: 'installation_complete', name: 'Installation Complete', phaseKey: 'deployment' },
  { key: 'cmdb_accepted', name: 'CMDB Accepted', phaseKey: 'cmdb' },
  { key: 'handover_complete', name: 'Handover Complete', phaseKey: 'handover' },
]
export const STANDARD_MILESTONE_KEYS = STANDARD_MILESTONES.map((m) => m.key)

// One building's standard milestones for its active phases. `bars`: that
// building's bars by phase; `procurement`: { ordered, delivered } (Booleans
// with their days); `overrides`: { [standardKey]: dueDate }.
export function standardMilestones({ buildingId, phaseKeys, barsByPhase, procurement = {}, overrides = {} }) {
  return STANDARD_MILESTONES.filter((m) => phaseKeys.includes(m.phaseKey)).map((m) => {
    const bar = barsByPhase[m.phaseKey]
    const done = m.procurement ? Boolean(procurement[m.procurement]?.done) : isDone(bar?.status)
    const doneOn = m.procurement ? procurement[m.procurement]?.on ?? null : bar?.completedOn ?? null
    return { id: `${m.key}:${buildingId}`, standardKey: m.key, buildingId, name: m.name, dueDate: overrides[m.key] ?? bar?.target ?? null, done, doneOn, custom: false }
  })
}

// The earliest open milestone with a due date (the dashboard's "Next milestone").
export function nextMilestone(milestones) {
  return milestones.filter((m) => !m.done && m.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.name.localeCompare(b.name)))[0] ?? null
}

// --- SLAs (v2.2 §21.8) ------------------------------------------------------------

// The work items of an SLA: the buildings × phases in its scope.
export function slaItemKeys({ sla, buildingIds, phaseKeys }) {
  const buildings = sla.buildingId ? buildingIds.filter((b) => b === String(sla.buildingId)) : buildingIds
  const phases = sla.phaseKey ? phaseKeys.filter((p) => p === sla.phaseKey) : phaseKeys
  return buildings.flatMap((b) => phases.map((p) => keyOf(b, p)))
}

// Whether an item is done at the end of a day, from its history events
// ([{ event, on, dateKnown }] in order). A completion with no known date
// counts as done from the start.
function doneOnDay(item, day) {
  let done = false
  for (const e of item.events ?? []) {
    const on = e.on ?? (e.event === 'completed' ? '0000-01-01' : null)
    if (on && on <= day) done = e.event === 'completed'
  }
  return done
}

// The SLA's status. `items`: [{ key, done, events }]; dates local.
export function slaStatus({ sla, items, today }) {
  const total = items.length
  const remaining = items.filter((i) => !i.done).length
  const doneCount = total - remaining
  const elapsed = Math.max(0, daysBetween(sla.startDate, today))
  const span = Math.max(1, daysBetween(sla.startDate, sla.dueDate))
  let projectedOn = null
  if (remaining > 0 && doneCount > 0 && elapsed > 0) projectedOn = addDays(today, Math.ceil(remaining / (doneCount / elapsed)))
  let status
  if (total > 0 && remaining === 0) status = 'met'
  else if (today > sla.dueDate) status = 'breached'
  else if (projectedOn ? projectedOn > sla.dueDate : elapsed / span >= 0.5) status = 'at_risk'
  else status = 'on_track'
  return { status, total, remaining, done: doneCount, projectedOn }
}
export const SLA_STATUS_LABEL = { met: 'Met', breached: 'Breached', at_risk: 'At risk', on_track: 'On track' }

// Burn-down: remaining items at the end of each day from the start to the
// later of today and the due date, with the ideal straight line.
export function slaBurndown({ sla, items, today }) {
  const end = maxDate(today, sla.dueDate)
  const total = items.length
  const span = Math.max(1, daysBetween(sla.startDate, sla.dueDate))
  const out = []
  for (let day = sla.startDate, i = 0; day <= end && i < 3660; day = addDays(day, 1), i += 1) {
    const ideal = day <= sla.dueDate ? Math.round(total * (1 - daysBetween(sla.startDate, day) / span) * 100) / 100 : 0
    out.push({ date: day, ideal, actual: day <= today ? items.filter((it) => !doneOnDay(it, day)).length : null })
  }
  return out
}
