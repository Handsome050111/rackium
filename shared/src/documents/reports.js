// The seven standard reports (brief v2.2 §21.9; M7a-3): one pure function
// each, from the data the server loaded with the requester's roles and
// scope to the document model (./model.js) and its sheets (Excel, CSV).
// Nothing here decides who sees what: a section the requester may not see
// (figures per person, prices) is simply not in the data.
import { PHASE_LABELS } from '../notifications.js'
import { DGUV_STATE_LABEL } from '../dguvRollup.js'
import { PROCUREMENT_LABELS } from '../procurement.js'
import { kv, p, table, section, note, sheetOf, day, toCsv } from './model.js'
import { money } from './assemble.js'
import { INTERNAL_COST_MARK } from './types.js'

const phaseName = (k) => (k === 'done' ? 'All phases done' : PHASE_LABELS[k] ?? k ?? '—')
const pct = (n) => (n == null ? '—' : `${n}%`)

function base(ctx, title) {
  return {
    title,
    subtitle: ctx.project?.name ?? '',
    meta: { project: ctx.project?.name ?? null, projectCode: ctx.project?.code ?? null, client: ctx.project?.clientName ?? null, building: null, version: ctx.versionLabel ?? null, date: day(ctx.generatedAt ?? new Date()) },
    sections: [],
  }
}
// Who the report covers: the requester's buildings (a scoped member's are fewer).
const coverage = (data) => p(`Covers ${data.scope.buildings} building(s)${data.scope.limited ? ' — the buildings in your scope' : ' — the whole project'}, as of ${data.today} (${data.timeZone}).`)

// --- Weekly Status ---------------------------------------------------------------
// data: { today, weekFrom, timeZone, scope, buildings: [{ code, name, currentPhase,
//   progress, overdue: [{ phaseKey, target }], openBlockers, raised, resolved }],
//   milestones: [{ building, name, dueDate }] }
export function weeklyStatus(ctx, data) {
  const doc = base(ctx, 'Weekly Status Report')
  const b = data.buildings
  const buildings = table(
    [{ key: 'code', label: 'Building' }, { key: 'name', label: 'Name' }, { key: 'phase', label: 'Current phase' }, { key: 'progress', label: 'Progress' }, { key: 'overdue', label: 'Overdue phases' }, { key: 'blockers', label: 'Open blockers' }, { key: 'raised', label: 'Raised this week' }, { key: 'resolved', label: 'Resolved this week' }],
    b.map((x) => ({ code: x.code, name: x.name, phase: phaseName(x.currentPhase), progress: pct(x.progress), overdue: x.overdue.map((o) => phaseName(o.phaseKey)).join(', ') || 'None', blockers: x.openBlockers, raised: x.raised, resolved: x.resolved })),
    { empty: 'No buildings.' }
  )
  const overdue = table(
    [{ key: 'code', label: 'Building' }, { key: 'phase', label: 'Phase' }, { key: 'target', label: 'Target date' }],
    b.flatMap((x) => x.overdue.map((o) => ({ code: x.code, phase: phaseName(o.phaseKey), target: o.target }))),
    { empty: 'Nothing is overdue.' }
  )
  const milestones = table([{ key: 'building', label: 'Building' }, { key: 'name', label: 'Milestone' }, { key: 'dueDate', label: 'Due' }], data.milestones, { empty: 'No milestones due in the next 14 days.' })
  const avgProgress = b.length ? Math.round(b.reduce((n, x) => n + x.progress, 0) / b.length) : null
  doc.sections = [
    section('summary', 'Summary', [coverage(data), kv([['Week', `${data.weekFrom} – ${data.today}`], ['Buildings', b.length], ['Average progress', pct(avgProgress)], ['Buildings with an overdue phase', b.filter((x) => x.overdue.length).length], ['Open blockers', b.reduce((n, x) => n + x.openBlockers, 0)], ['Blockers raised this week', b.reduce((n, x) => n + x.raised, 0)], ['Blockers resolved this week', b.reduce((n, x) => n + x.resolved, 0)]])]),
    section('buildings', 'Buildings', [buildings]),
    section('overdue', 'Overdue phases', [overdue]),
    section('milestones', 'Milestones in the next 14 days', [milestones]),
  ]
  return { doc, sheets: [sheetOf('Buildings', buildings), sheetOf('Overdue', overdue), sheetOf('Milestones', milestones)] }
}

// --- Resource Utilisation (figures per person: Org Admin and PM only) -------------
// data: { people: [{ name, roles, buildings, primaryFor, openTasks, overdueTasks, completed30 }] }
export function resourceUtilisation(ctx, data) {
  const doc = base(ctx, 'Resource Utilisation Report')
  const people = table(
    [{ key: 'name', label: 'Person' }, { key: 'roles', label: 'Role' }, { key: 'buildings', label: 'Buildings with work' }, { key: 'primary', label: 'Primary for' }, { key: 'open', label: 'Open tasks' }, { key: 'overdue', label: 'Overdue tasks' }, { key: 'done', label: 'Completed (30 days)' }],
    data.people.map((x) => ({ name: x.name, roles: x.roles.join(', '), buildings: x.buildings, primary: x.primaryFor.join(', ') || '—', open: x.openTasks, overdue: x.overdueTasks, done: x.completed30 })),
    { empty: 'No project members.' }
  )
  const busy = data.people.filter((x) => x.openTasks > 0).length
  doc.sections = [
    section('summary', 'Summary', [coverage(data), kv([['Members', data.people.length], ['With open tasks', busy], ['Utilisation', pct(data.people.length ? Math.round((busy / data.people.length) * 100) : null)], ['Open tasks', data.people.reduce((n, x) => n + x.openTasks, 0)], ['Overdue tasks', data.people.reduce((n, x) => n + x.overdueTasks, 0)]])]),
    section('people', 'Workload per person', [people]),
  ]
  return { doc, sheets: [sheetOf('People', people)] }
}

// --- BOM Summary -------------------------------------------------------------------
// data: { currency, marginPercent, buildings: [{ code, name, approved, lines, serialised,
//   unpriced, statuses: { status: count }, costMinor }] }. `prices`: none | sell | cost —
// already allowed for the requester (types.js requestProblem).
export function bomSummary(ctx, data, { prices = 'none' } = {}) {
  const doc = base(ctx, 'BOM Summary Report')
  const value = (minor) => (prices === 'sell' ? Math.round(minor * (1 + data.marginPercent / 100)) : minor)
  const priceLabel = prices === 'sell' ? `Value — client price (${data.currency})` : `Value — cost (${data.currency})`
  const block = table(
    [{ key: 'code', label: 'Building' }, { key: 'approved', label: 'Procurement BOM' }, { key: 'lines', label: 'Lines' }, { key: 'serialised', label: 'Serialised' }, ...['not_ordered', 'ordered', 'delivered'].map((s) => ({ key: s, label: PROCUREMENT_LABELS[s] })), ...(prices === 'none' ? [] : [{ key: 'value', label: priceLabel }, { key: 'unpriced', label: 'Not priced' }])],
    data.buildings.map((x) => ({ code: x.code, approved: x.approved ?? 'Draft', lines: x.lines, serialised: x.serialised, not_ordered: x.statuses.not_ordered ?? 0, ordered: (x.statuses.ordered ?? 0) + (x.statuses.shipped ?? 0), delivered: x.statuses.delivered ?? 0, value: x.costMinor == null ? '' : Math.round(value(x.costMinor)) / 100, unpriced: x.unpriced })),
    { empty: 'No building has a BOM yet.' }
  )
  const total = data.buildings.reduce((n, x) => n + (x.costMinor ?? 0), 0)
  const rows = [['Buildings with a BOM', data.buildings.length], ['Lines', data.buildings.reduce((n, x) => n + x.lines, 0)], ['Approved procurement BOMs', data.buildings.filter((x) => x.approved).length]]
  if (prices !== 'none') rows.push([prices === 'sell' ? 'Total — client price' : 'Total — cost', money(value(total), data.currency)], ['Lines not priced (left out of the total)', data.buildings.reduce((n, x) => n + x.unpriced, 0)])
  doc.sections = [
    section('summary', 'Summary', [coverage(data), ...(prices === 'cost' ? [note(`${INTERNAL_COST_MARK}: for internal use only, never for the client.`, 'warning')] : []), kv(rows)]),
    section('buildings', 'Buildings', [block]),
  ]
  return { doc, sheets: [sheetOf('BOM summary', block)] }
}

// --- Survey Progress -----------------------------------------------------------------
// data: { buildings: [{ code, expected, verified, submitted, rejected, draft, pct }],
//   byTechnician?: [{ name, submitted, verified, rejected, pct }] } — byTechnician only
//   when the requester may see figures per person.
export function surveyProgress(ctx, data) {
  const doc = base(ctx, 'Survey Progress Report')
  const buildings = table(
    [{ key: 'code', label: 'Building' }, { key: 'expected', label: 'Tabs needed' }, { key: 'verified', label: 'Verified' }, { key: 'submitted', label: 'Awaiting verification' }, { key: 'rejected', label: 'Rejected' }, { key: 'draft', label: 'Draft' }, { key: 'pct', label: 'Complete' }],
    data.buildings.map((x) => ({ ...x, pct: pct(x.pct) })),
    { empty: 'No buildings.' }
  )
  const expected = data.buildings.reduce((n, x) => n + x.expected, 0)
  const verified = data.buildings.reduce((n, x) => n + Math.min(x.verified, x.expected), 0)
  doc.sections = [section('summary', 'Summary', [coverage(data), kv([['Tabs needed', expected], ['Verified', verified], ['Complete', pct(expected ? Math.round((verified / expected) * 100) : null)]])]), section('buildings', 'Buildings', [buildings])]
  const sheets = [sheetOf('Buildings', buildings)]
  if (data.byTechnician) {
    const people = table([{ key: 'name', label: 'Technician' }, { key: 'submitted', label: 'Submitted' }, { key: 'verified', label: 'Verified' }, { key: 'rejected', label: 'Rejected' }, { key: 'pct', label: 'Verified of submitted' }], data.byTechnician.map((x) => ({ ...x, pct: pct(x.pct) })), { empty: 'No tab has been submitted yet.' })
    doc.sections.push(section('technicians', 'By technician', [people]))
    sheets.push(sheetOf('Technicians', people))
  }
  return { doc, sheets }
}

// --- Compliance -----------------------------------------------------------------------
// data: { dguv: { counts, compliantPct }, buildings: [{ code, devices, compliantPct,
//   overdue, notInspected, expiring, critical, warning }] }
export function complianceReport(ctx, data) {
  const doc = base(ctx, 'Compliance Report')
  const block = table(
    [{ key: 'code', label: 'Building' }, { key: 'devices', label: 'DGUV devices' }, { key: 'compliant', label: 'DGUV compliant' }, { key: 'overdue', label: DGUV_STATE_LABEL.overdue }, { key: 'notInspected', label: DGUV_STATE_LABEL.not_inspected }, { key: 'expiring', label: 'Expiring (≤ 90 days)' }, { key: 'critical', label: 'Critical design findings' }, { key: 'warning', label: 'Design warnings' }],
    data.buildings.map((x) => ({ ...x, compliant: pct(x.compliantPct) })),
    { empty: 'No buildings.' }
  )
  const c = data.dguv.counts
  doc.sections = [
    section('summary', 'Summary', [coverage(data), kv([['DGUV devices', c.total], ['DGUV compliant', pct(data.dguv.compliantPct)], [DGUV_STATE_LABEL.overdue, c.overdue], [DGUV_STATE_LABEL.not_inspected, c.not_inspected], ['Expiring (≤ 90 days)', c.expiring + c.expiring_soon], ['Open Critical design findings', data.buildings.reduce((n, x) => n + x.critical, 0)], ['Design warnings', data.buildings.reduce((n, x) => n + x.warning, 0)]])]),
    section('buildings', 'Buildings', [block]),
  ]
  return { doc, sheets: [sheetOf('Compliance', block)] }
}

// --- Design Change --------------------------------------------------------------------
// data: { changes: [{ building, number, title, status, submittedOn, decidedOn, affected, reason }] }
const CR_STATUS = { draft: 'Draft', submitted: 'Submitted', awaiting_client: 'With the client', approved: 'Approved', changes_requested: 'Changes requested', rejected: 'Rejected', withdrawn: 'Withdrawn' }
export function designChange(ctx, data) {
  const doc = base(ctx, 'Design Change Report')
  const block = table(
    [{ key: 'building', label: 'Building' }, { key: 'number', label: 'CR' }, { key: 'title', label: 'Title' }, { key: 'status', label: 'Status' }, { key: 'submittedOn', label: 'Submitted' }, { key: 'decidedOn', label: 'Decided' }, { key: 'affected', label: 'Affected items' }, { key: 'reason', label: 'Reason' }],
    data.changes.map((x) => ({ ...x, number: `CR-${x.number}`, status: CR_STATUS[x.status] ?? x.status })),
    { empty: 'No change requests.' }
  )
  const count = (s) => data.changes.filter((x) => x.status === s).length
  doc.sections = [
    section('summary', 'Summary', [coverage(data), kv([['Change requests', data.changes.length], ['Open (draft, submitted, with the client, changes requested)', count('draft') + count('submitted') + count('awaiting_client') + count('changes_requested')], ['Approved', count('approved')], ['Rejected', count('rejected')], ['Withdrawn', count('withdrawn')]])]),
    section('changes', 'Change requests', [block]),
  ]
  return { doc, sheets: [sheetOf('Change requests', block)] }
}

// --- Installation Progress ------------------------------------------------------------
// data: { buildings: [{ code, started, devices: { planned, installed, tested, accepted },
//   connections: { planned, installed, tested, faulty }, openExceptions, progress }] }
export function installationProgress(ctx, data) {
  const doc = base(ctx, 'Installation Progress Report')
  const block = table(
    [{ key: 'code', label: 'Building' }, { key: 'devices', label: 'Devices planned' }, { key: 'installed', label: 'Installed' }, { key: 'tested', label: 'Tested' }, { key: 'accepted', label: 'Accepted' }, { key: 'links', label: 'Connections installed' }, { key: 'linksTested', label: 'Connections tested' }, { key: 'faulty', label: 'Faulty' }, { key: 'exceptions', label: 'Open exceptions' }, { key: 'progress', label: 'Accepted %' }],
    data.buildings.map((x) => (x.started ? { code: x.code, devices: x.devices.planned, installed: x.devices.installed, tested: x.devices.tested, accepted: x.devices.accepted, links: `${x.connections.installed}/${x.connections.planned}`, linksTested: x.connections.tested, faulty: x.connections.faulty, exceptions: x.openExceptions, progress: pct(x.progress) } : { code: x.code, devices: 'No LLD yet' })),
    { empty: 'No buildings.' }
  )
  const started = data.buildings.filter((x) => x.started)
  const sum = (f) => started.reduce((n, x) => n + f(x), 0)
  doc.sections = [
    section('summary', 'Summary', [coverage(data), kv([['Buildings with a deployment', started.length], ['Devices installed', `${sum((x) => x.devices.installed)}/${sum((x) => x.devices.planned)}`], ['Devices accepted', sum((x) => x.devices.accepted)], ['Connections installed', `${sum((x) => x.connections.installed)}/${sum((x) => x.connections.planned)}`], ['Faulty connections', sum((x) => x.connections.faulty)], ['Open exceptions', sum((x) => x.openExceptions)]])]),
    section('buildings', 'Buildings', [block]),
  ]
  return { doc, sheets: [sheetOf('Installation', block)] }
}

// The summary section as the first sheet, so a CSV or Excel report says
// what it covers (the requester's buildings) and carries its key figures.
function summarySheet(doc) {
  const s = doc.sections.find((x) => x.id === 'summary')
  const rows = [[doc.title], [doc.subtitle ?? '']]
  for (const b of s?.blocks ?? []) {
    if (b.type === 'p' || b.type === 'note') rows.push([b.text])
    if (b.type === 'kv') rows.push(...b.rows)
  }
  return { name: 'Summary', rows }
}
const withSummary = (fn) => (ctx, data, opts) => {
  const out = fn(ctx, data, opts)
  return { ...out, sheets: [summarySheet(out.doc), ...out.sheets] }
}

export const REPORT_ASSEMBLERS = {
  'weekly-status': withSummary(weeklyStatus),
  'resource-utilisation': withSummary(resourceUtilisation),
  'bom-summary': withSummary(bomSummary),
  'survey-progress': withSummary(surveyProgress),
  'compliance-report': withSummary(complianceReport),
  'design-change': withSummary(designChange),
  'installation-progress': withSummary(installationProgress),
}

// Every sheet of a report in one CSV: each under its own title row, a blank
// row between. An internal (cost price) report starts with the mark.
export function reportCsv(sheets, { internal = false } = {}) {
  const rows = internal ? [[INTERNAL_COST_MARK]] : []
  sheets.forEach((s, i) => {
    if (i > 0 || internal) rows.push([])
    rows.push([s.name], ...s.rows)
  })
  return toCsv(rows)
}
