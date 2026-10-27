// Reports, report schedules and analytics (brief v2.2 §21.5, §21.6, §21.9;
// M7a-3). Pure: the server loads the rows, these functions count them.
import { localDate, localTime, weekdayOf, addDays, dateString, DEFAULT_TIME_ZONE } from './timeZone.js'

// --- The seven standard reports (v2.2 §21.9) ---------------------------------
// Document types of the M6b engine (documents/types.js), project-level,
// generated with the requester's roles and scope. `person`: figures about
// named people (Org Admin and PM only); `prices`: may carry prices (client
// prices for those who may see them; cost prices in internal documents only).
export const REPORTS = [
  { key: 'weekly-status', name: 'Weekly Status' },
  { key: 'resource-utilisation', name: 'Resource Utilisation', person: true },
  { key: 'bom-summary', name: 'BOM Summary', prices: true },
  { key: 'survey-progress', name: 'Survey Progress' },
  { key: 'compliance-report', name: 'Compliance' },
  { key: 'design-change', name: 'Design Change' },
  { key: 'installation-progress', name: 'Installation Progress' },
]
export const REPORT_KEYS = REPORTS.map((r) => r.key)
export const REPORT_FORMATS = ['pdf', 'csv', 'xlsx']
export const reportOf = (key) => REPORTS.find((r) => r.key === key) ?? null

// --- Report schedules ----------------------------------------------------------
// Weekly on a weekday (0 Sunday … 6 Saturday) or monthly on a day (1–28, so
// every month has it), at a local time in the organisation's time zone.
export const SCHEDULE_FREQUENCIES = ['weekly', 'monthly']
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const isSendDay = (s, day) => (s.frequency === 'monthly' ? Number(dateString(day).slice(8, 10)) === s.dayOfMonth : weekdayOf(day) === s.weekday)

// The local date a schedule is due on at `now`, or null: today is its day,
// the local time has reached its time, and it has not been sent today.
export function scheduleDueOn(schedule, now, tz = DEFAULT_TIME_ZONE) {
  const today = localDate(now, tz)
  if (schedule.lastSentOn === today) return null
  if (localTime(now, tz) < schedule.time) return null
  return isSendDay(schedule, today) ? today : null
}

// The next local date it will be sent on (today when still to come).
export function nextScheduleDate(schedule, now, tz = DEFAULT_TIME_ZONE) {
  const today = localDate(now, tz)
  const pending = schedule.lastSentOn !== today && localTime(now, tz) < schedule.time
  for (let i = pending ? 0 : 1; i <= 62; i++) {
    const day = addDays(today, i)
    if (isSendDay(schedule, day)) return day
  }
  return null
}

export function describeSchedule(s) {
  return s.frequency === 'monthly' ? `Monthly on day ${s.dayOfMonth} at ${s.time}` : `Weekly on ${WEEKDAY_NAMES[s.weekday]} at ${s.time}`
}

// --- Analytics (v2.2 §21.9; addendum v2.3 Q14–15): seven metrics, each with a monthly trend line ---
// Rows whose date is unknown (a phase completion backfilled without
// evidence, a stamp that was never recorded) are left out of every average,
// and how many were left out is reported with the metric.

const DAY_MS = 86400000
const round1 = (n) => Math.round(n * 10) / 10
const utcDay = (day) => {
  const [y, m, d] = dateString(day).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
// Calendar days between two local dates (a DST change never shifts it).
export const daysBetween = (from, to) => (utcDay(to) - utcDay(from)) / DAY_MS
const monthOf = (day) => dateString(day).slice(0, 7)
const avg = (list) => (list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null)

// Points { on: 'YYYY-MM-DD', value } → one entry per month, oldest first.
// `sum`: the count of points per month; `avg`: their mean.
export function monthlyTrend(points, mode = 'avg') {
  const byMonth = new Map()
  for (const pt of points) {
    const m = monthOf(pt.on)
    if (!byMonth.has(m)) byMonth.set(m, [])
    byMonth.get(m).push(pt.value ?? 1)
  }
  return [...byMonth.keys()].sort().map((period) => {
    const values = byMonth.get(period)
    return { period, value: mode === 'sum' ? values.length : avg(values), count: values.length }
  })
}

// 1. Phase duration: from the previous active phase's completion (the first
// phase: its planned start) to this phase's completion, in calendar days.
// `history`: phaseHistory rows { buildingId, phaseKey, event, on, dateKnown }
// in the order recorded; the phase's current completion is its last row
// when that row is a completion. `startOf(buildingId, phaseKey)`: the
// planned start of a building's first phase, or null.
export function phaseDurations({ history, phaseKeys, buildingIds, startOf = () => null }) {
  const last = new Map()
  for (const h of history) last.set(`${h.buildingId}|${h.phaseKey}`, h)
  const completion = (b, p) => {
    const h = last.get(`${b}|${p}`)
    return h?.event === 'completed' ? h : null
  }
  const byPhase = new Map(phaseKeys.map((p) => [p, []]))
  const points = []
  let excluded = 0
  for (const b of buildingIds.map(String)) {
    phaseKeys.forEach((p, i) => {
      const end = completion(b, p)
      if (!end) return
      if (!end.dateKnown || !end.on) return void (excluded += 1)
      let start
      if (i === 0) start = startOf(b, p)
      else {
        const prev = completion(b, phaseKeys[i - 1])
        start = prev?.dateKnown ? prev.on : null
      }
      if (!start) return void (excluded += 1)
      const days = Math.max(0, daysBetween(start, end.on))
      byPhase.get(p).push(days)
      points.push({ on: end.on, value: days })
    })
  }
  return {
    phases: phaseKeys.map((p) => ({ phaseKey: p, avgDays: avg(byPhase.get(p)), count: byPhase.get(p).length })),
    avgDays: avg(points.map((x) => x.value)),
    count: points.length,
    excluded,
    trend: monthlyTrend(points),
  }
}

// 2. Blocker frequency: blockers raised per month, and per phase.
// `blockers`: { phaseKey, raisedOn }.
export function blockerFrequency({ blockers }) {
  const known = blockers.filter((b) => b.raisedOn)
  const byPhase = {}
  for (const b of known) byPhase[b.phaseKey] = (byPhase[b.phaseKey] ?? 0) + 1
  const trend = monthlyTrend(known.map((b) => ({ on: b.raisedOn })), 'sum')
  return { total: known.length, byPhase, perMonth: avg(trend.map((t) => t.value)), excluded: blockers.length - known.length, trend }
}

// 3. Blocker resolution time: days from raised to resolved (resolved ones).
// `blockers`: { status, raisedOn, resolvedOn }.
export function blockerResolution({ blockers }) {
  const resolved = blockers.filter((b) => b.status === 'resolved')
  const known = resolved.filter((b) => b.raisedOn && b.resolvedOn)
  const points = known.map((b) => ({ on: b.resolvedOn, value: Math.max(0, daysBetween(b.raisedOn, b.resolvedOn)) }))
  return { avgDays: avg(points.map((x) => x.value)), count: points.length, open: blockers.length - resolved.length, excluded: resolved.length - known.length, trend: monthlyTrend(points) }
}

// 4. BOM accuracy (addendum v2.3 Q15): the approved procurement BOM against
// what was installed — the variance with money attached. Compared where
// Rackium records the as-built: serialised devices, optics (per code) and
// cables (per medium); other lines (PSUs, cords, cage nuts, accessories) are
// not recorded as installed and are counted as not comparable. Only
// buildings whose deployment is complete; one with no known completion date
// is left out and counted. `buildings`: { buildingId, finished, on,
// approved: { devices, optics: {code: qty}, cables: {media: qty} } | null,
// installed: same shape, notComparable }.
export function bomAccuracy({ buildings }) {
  const rows = []
  let inProgress = 0
  let noApprovedBom = 0
  let excluded = 0
  for (const b of buildings) {
    if (!b.approved) {
      noApprovedBom += 1
      continue
    }
    if (!b.finished) {
      inProgress += 1
      continue
    }
    if (!b.on) {
      excluded += 1
      continue
    }
    const pairs = [[b.approved.devices, b.installed.devices]]
    for (const kind of ['optics', 'cables']) {
      for (const key of new Set([...Object.keys(b.approved[kind]), ...Object.keys(b.installed[kind])])) pairs.push([b.approved[kind][key] ?? 0, b.installed[kind][key] ?? 0])
    }
    const base = pairs.reduce((n, [a]) => n + a, 0)
    const moved = pairs.reduce((n, [a, i]) => n + Math.abs(i - a), 0)
    const variancePct = base ? round1((moved / base) * 100) : moved ? 100 : 0
    const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0)
    rows.push({
      buildingId: String(b.buildingId),
      on: b.on,
      variancePct,
      accuracyPct: round1(Math.max(0, 100 - variancePct)),
      devices: { approved: b.approved.devices, installed: b.installed.devices },
      optics: { approved: sum(b.approved.optics), installed: sum(b.installed.optics) },
      cables: { approved: sum(b.approved.cables), installed: sum(b.installed.cables) },
      notComparable: b.notComparable ?? 0,
    })
  }
  return {
    avgAccuracyPct: avg(rows.map((r) => r.accuracyPct)),
    avgVariancePct: avg(rows.map((r) => r.variancePct)),
    count: rows.length,
    inProgress,
    noApprovedBom,
    excluded,
    buildings: rows.map(({ on, ...rest }) => rest),
    trend: monthlyTrend(rows.map((r) => ({ on: r.on, value: r.accuracyPct }))),
  }
}

// 5. BOM revision count (addendum v2.3 Q15, reported apart from accuracy):
// how often a building's procurement BOM was approved again after the first
// approval, and how far the final version moved from the first — the sum of
// quantity changes per line over the first version's total quantity.
// `versions`: { buildingId, number, on, lines: [{ key, qty }] | null
// (snapshot unreadable) }.
export function bomRevisions({ versions }) {
  const byBuilding = new Map()
  for (const v of versions) {
    const k = String(v.buildingId)
    if (!byBuilding.has(k)) byBuilding.set(k, [])
    byBuilding.get(k).push(v)
  }
  const buildings = []
  let excluded = 0
  for (const [buildingId, list] of byBuilding) {
    list.sort((a, b) => a.number - b.number)
    const first = list[0]
    const latest = list[list.length - 1]
    if (!first.lines || !latest.lines || !latest.on) {
      excluded += 1
      continue
    }
    const qty = (lines) => new Map(lines.map((l) => [l.key, Number(l.qty) || 0]))
    const a = qty(first.lines)
    const b = qty(latest.lines)
    const base = [...a.values()].reduce((s, n) => s + n, 0)
    let moved = 0
    for (const key of new Set([...a.keys(), ...b.keys()])) moved += Math.abs((b.get(key) ?? 0) - (a.get(key) ?? 0))
    buildings.push({ buildingId, versions: list.length, revisions: list.length - 1, changePct: base ? round1((moved / base) * 100) : moved ? 100 : 0, on: latest.on })
  }
  return {
    avgRevisions: avg(buildings.map((b) => b.revisions)),
    totalRevisions: buildings.reduce((n, b) => n + b.revisions, 0),
    avgChangePct: avg(buildings.map((b) => b.changePct)),
    count: buildings.length,
    changed: buildings.filter((b) => b.revisions > 0).length,
    excluded,
    buildings: buildings.map(({ on, ...rest }) => rest),
    trend: monthlyTrend(buildings.map((b) => ({ on: b.on, value: b.revisions }))),
  }
}

// 6. Survey completion: verified tabs out of the tabs the buildings need,
// verified per month, and per technician (who submitted the tab).
// `records`: { status, submittedBy, verifiedOn }; `expected`: tab count.
export function surveyCompletion({ records, expected }) {
  const done = records.filter((r) => ['verified', 'imported'].includes(r.status))
  const dated = done.filter((r) => r.verifiedOn)
  const people = new Map()
  for (const r of records) {
    if (!r.submittedBy) continue
    const k = String(r.submittedBy)
    if (!people.has(k)) people.set(k, { userId: k, submitted: 0, verified: 0, rejected: 0, points: [] })
    const p = people.get(k)
    p.submitted += 1
    if (['verified', 'imported'].includes(r.status)) {
      p.verified += 1
      if (r.verifiedOn) p.points.push({ on: r.verifiedOn })
    }
    if (r.status === 'rejected') p.rejected += 1
  }
  return {
    expected,
    verified: done.length,
    completionPct: expected ? Math.round((Math.min(done.length, expected) / expected) * 100) : null,
    excluded: done.length - dated.length,
    trend: monthlyTrend(dated.map((r) => ({ on: r.verifiedOn })), 'sum'),
    byTechnician: [...people.values()].map(({ points, ...p }) => ({ ...p, completionPct: p.submitted ? Math.round((p.verified / p.submitted) * 100) : null, trend: monthlyTrend(points, 'sum') })),
  }
}

// 7. Approval turnaround: days from submission to decision, per gate. The
// PM's own procurement-BOM approval is a sign-off, not a review: not counted.
// `approvals`: { gate, status, submittedAt, decidedAt } (instants).
export const TURNAROUND_GATES = ['hld_internal', 'lld_internal', 'sp_internal', 'sp_client', 'deployment_acceptance', 'handover_client', 'change_request']
export function approvalTurnaround({ approvals, timeZone = DEFAULT_TIME_ZONE }) {
  const reviewed = approvals.filter((a) => TURNAROUND_GATES.includes(a.gate))
  const decided = reviewed.filter((a) => a.status !== 'pending')
  const known = decided.filter((a) => a.submittedAt && a.decidedAt)
  const points = known.map((a) => ({ gate: a.gate, on: localDate(a.decidedAt, timeZone), value: Math.max(0, (new Date(a.decidedAt) - new Date(a.submittedAt)) / DAY_MS) }))
  const byGate = TURNAROUND_GATES.map((gate) => {
    const list = points.filter((x) => x.gate === gate)
    return { gate, avgDays: avg(list.map((x) => x.value)), count: list.length }
  }).filter((g) => g.count)
  return { avgDays: avg(points.map((x) => x.value)), count: points.length, pending: reviewed.length - decided.length, excluded: decided.length - known.length, byGate, trend: monthlyTrend(points) }
}

export const METRIC_KEYS = ['phaseDuration', 'blockerFrequency', 'blockerResolution', 'bomAccuracy', 'bomRevisions', 'surveyCompletion', 'approvalTurnaround']
export const METRIC_LABELS = {
  phaseDuration: 'Phase duration',
  blockerFrequency: 'Blocker frequency',
  blockerResolution: 'Blocker resolution time',
  bomAccuracy: 'BOM accuracy (approved vs installed)',
  bomRevisions: 'BOM revision count',
  surveyCompletion: 'Survey completion',
  approvalTurnaround: 'Approval turnaround',
}
