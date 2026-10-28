// Document assembly (M6b): one pure function per document, from plain data
// (shaped by server/src/documents/loaders.js) to the document model
// (./model.js). Each is unit-tested from fixtures.
import { SECTIONS, REQUIRED_INPUT_GROUPS } from '../solutionPackage.js'
import { cableMatrix } from '../cmdb.js'
import { DGUV_STATUS_LABEL, STATUS_LABELS } from '../deployment.js'
import { RESOURCE_TASKS } from '../billOfResources.js'
import { p, h3, kv, table, list, note, svg, image, section, day, sheetOf } from './model.js'
import { topologySvg, rackElevationSvg } from './svg.js'

const MEDIA = { cat6a: 'Cat6A', os2: 'OS2', om4: 'OM4', dac: 'DAC', stack: 'Stack' }
const KIND = { patch_cord: 'Patch cord', trunk: 'Trunk', direct: 'Direct' }
const PHASE = { cmo: 'CMO', survey: 'Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'Solution Package', bom: 'BOM', deployment: 'Deployment', cmdb: 'CMDB', handover: 'Handover' }
const PHASE_STATUS = { not_started: 'Not started', in_progress: 'In progress', awaiting_approval: 'Awaiting approval', changes_requested: 'Changes requested', blocked: 'Blocked', approved: 'Approved', completed: 'Completed' }
export const money = (minor, currency) =>(minor == null ? '—' : `${currency ?? 'EUR'} ${(minor / 100).toFixed(2)}`)

function base(ctx, title, subtitle) {
  return {
    title,
    subtitle: subtitle ?? `${ctx.building?.code ?? ''} ${ctx.building?.name ?? ''}`.trim(),
    meta: { project: ctx.project?.name ?? null, projectCode: ctx.project?.code ?? null, client: ctx.project?.clientName ?? null, building: ctx.building ? `${ctx.building.code} ${ctx.building.name ?? ''}`.trim() : null, version: ctx.versionLabel ?? null, date: day(ctx.generatedAt ?? new Date()) },
    sections: [],
  }
}

// --- Schedules shared by the LLD document, the cable workbook and the SP ------

// The configurable column headings of the cable schedule (the client's SC
// headings are not supplied yet; these placeholders apply until then).
export const DEFAULT_SCHEDULE_HEADINGS = {
  cableId: 'Cable ID',
  fromDevice: 'From device',
  fromPort: 'From port',
  toDevice: 'To device',
  toPort: 'To port',
  media: 'Media',
  kind: 'Cable type',
  lengthM: 'Length (m)',
  status: 'Status',
}
export const SCHEDULE_COLUMN_KEYS = Object.keys(DEFAULT_SCHEDULE_HEADINGS)
export const scheduleHeadings = (custom = {}) => ({ ...DEFAULT_SCHEDULE_HEADINGS, ...Object.fromEntries(Object.entries(custom ?? {}).filter(([k, v]) => k in DEFAULT_SCHEDULE_HEADINGS && String(v ?? '').trim())) })

// One row per cable segment. connections: LLD connection views (segments with
// from/to, cableId, effectiveM; status) or as-built (installedM).
export function cableScheduleRows(connections, nameOf) {
  const rows = []
  for (const c of connections) {
    for (const s of c.segments ?? []) {
      rows.push({
        cableId: s.installed?.cableId ?? s.cableId ?? '',
        fromDevice: nameOf(s.from?.deviceId),
        fromPort: s.from?.portId ?? '',
        toDevice: nameOf(s.to?.deviceId),
        toPort: s.to?.portId ?? '',
        media: MEDIA[c.media] ?? c.media,
        kind: KIND[s.kind] ?? s.kind ?? '',
        lengthM: s.installed?.installedM ?? s.installedM ?? s.effectiveM ?? '',
        status: STATUS_LABELS[c.status] ?? c.status ?? '',
      })
    }
  }
  return rows.sort((a, b) => String(a.cableId).localeCompare(String(b.cableId), undefined, { numeric: true }))
}
// Every port of every active device: what it connects to.
export function portScheduleRows(devices, connections, nameOf) {
  const rows = []
  for (const d of devices) {
    if (d.isPanel || !d.ports?.length) continue
    for (const port of d.ports) {
      const c = connections.find((x) => (x.source.deviceId === d.id && x.source.portId === port.id) || (x.dest.deviceId === d.id && x.dest.portId === port.id))
      const far = c ? (c.source.deviceId === d.id ? c.dest : c.source) : null
      rows.push({ device: d.hostname ?? d.label, port: port.id, type: port.type ?? '', connectedTo: far ? `${nameOf(far.deviceId)} ${far.portId ?? ''}`.trim() : 'free', cableId: c ? c.cableId ?? c.segments?.[0]?.cableId ?? '' : '', media: c ? MEDIA[c.media] ?? c.media : '' })
    }
  }
  return rows
}
const scheduleTable = (rows, headings) => table(SCHEDULE_COLUMN_KEYS.map((k) => ({ key: k, label: headings[k] })), rows, { empty: 'No cables.' })
const portTable = (rows) => table([{ key: 'device', label: 'Device' }, { key: 'port', label: 'Port' }, { key: 'type', label: 'Type' }, { key: 'connectedTo', label: 'Connected to' }, { key: 'cableId', label: 'Cable ID' }, { key: 'media', label: 'Media' }], rows, { empty: 'No ports.' })
const nameMap = (devices) => {
  const m = new Map(devices.map((d) => [String(d.id), d.hostname ?? d.label ?? 'device']))
  return (id) => m.get(String(id)) ?? '—'
}

// --- HLD document ---------------------------------------------------------------
// data: { floors, rooms, racks, devices, connections, design: { state, preset },
//         version: { number, label, createdAt } | null, approvals: [{ status, submittedBy, decision }] }
export function hldDocument(ctx, data) {
  const doc = base(ctx, 'High-Level Design')
  const nameOf = nameMap(data.devices)
  const roomCode = new Map(data.rooms.map((r) => [r.id, r.code]))
  const rackCode = new Map(data.racks.map((r) => [r.id, r.code]))
  doc.sections = [
    section('overview', 'Overview', [
      kv([
        ['Design preset', data.design?.preset ?? '—'],
        ['Status', PHASE_STATUS[data.status] ?? data.status ?? '—'],
        ['Approved version', data.version ? `v${data.version.number} (${day(data.version.createdAt)})` : 'Not approved'],
        ['Planned devices', data.devices.length],
        ['Uplinks', data.connections.length],
        ['Rooms', data.rooms.length],
      ]),
    ]),
    section('topology', 'Physical topology', [svg(topologySvg({ floors: data.floors, rooms: data.rooms, devices: data.devices, connections: data.connections, title: 'Physical topology' }), 'Devices by floor and room; links in their media colour')]),
    section('inventory', 'Device inventory', [table([{ key: 'hostname', label: 'Hostname' }, { key: 'role', label: 'Role' }, { key: 'model', label: 'Model' }, { key: 'room', label: 'Room' }, { key: 'rack', label: 'Rack' }], data.devices.map((d) => ({ hostname: d.hostname ?? d.label, role: d.roleLabel ?? d.role, model: d.model, room: roomCode.get(d.roomId), rack: rackCode.get(d.rackId) })))]),
    section('uplinks', 'Uplinks', [table([{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'media', label: 'Media' }, { key: 'speed', label: 'Speed' }, { key: 'length', label: 'Length (m)' }], data.connections.map((c) => ({ from: `${nameOf(c.source.deviceId)} ${c.source.portId ?? ''}`.trim(), to: `${nameOf(c.dest.deviceId)} ${c.dest.portId ?? ''}`.trim(), media: MEDIA[c.media] ?? c.media, speed: c.speed, length: c.length?.suggestedM ?? c.lengths?.effectiveM ?? '' })))]),
    section('approvals', 'Approval history', [table([{ key: 'status', label: 'Status' }, { key: 'by', label: 'Submitted by' }, { key: 'decision', label: 'Decision' }], (data.approvals ?? []).map((a) => ({ status: a.status, by: a.submittedBy, decision: a.decision ? `${a.decision.value} by ${a.decision.decidedBy ?? '—'} on ${day(a.decision.decidedAt)}` : '' })), { empty: 'No approvals yet.' })]),
  ]
  return doc
}

// --- LLD document -----------------------------------------------------------------
// data: lld view { floors, rooms, racks [{ code, roomId, heightU, placements }], devices, connections, versions }
export function lldDocument(ctx, data, { headings = {} } = {}) {
  const doc = base(ctx, 'Low-Level Design')
  const devices = data.devices.filter((d) => d.inDesign !== false)
  const nameOf = nameMap(data.devices)
  const roomCode = new Map(data.rooms.map((r) => [r.id, r.code]))
  const approved = (data.versions ?? []).find((v) => v.frozen)
  doc.sections = [
    section('overview', 'Overview', [kv([['Approved version', approved ? `v${approved.number} ${approved.label ?? ''}`.trim() : 'Not approved'], ['Devices', devices.length], ['Patch panels', devices.filter((d) => d.isPanel).length], ['Connections', data.connections.length], ['Cables', data.connections.reduce((n, c) => n + (c.segments?.length ?? 1), 0)], ['Racks', data.racks.length]])]),
    section(
      'racks',
      'Rack elevations',
      data.racks.map((r) => svg(rackElevationSvg({ code: r.code, heightU: r.heightU, placements: r.placements, roomCode: roomCode.get(r.roomId) }), `Rack ${r.code} · ${roomCode.get(r.roomId) ?? ''}`))
    ),
    section('ports', 'Port schedule', [portTable(portScheduleRows(devices, data.connections, nameOf))]),
    section('cables', 'Cable schedule', [scheduleTable(cableScheduleRows(data.connections, nameOf), scheduleHeadings(headings))]),
  ]
  return doc
}

// The Excel workbook: cable schedule, cable matrix and port schedule (configurable headings).
export function cableWorkbook(ctx, data, { headings = {} } = {}) {
  const h = scheduleHeadings(headings)
  const devices = data.devices.filter((d) => d.inDesign !== false)
  const nameOf = nameMap(data.devices)
  const matrix = cableMatrix(
    data.connections.map((c) => ({ ...c, segments: (c.segments ?? []).map((s) => ({ cableId: s.installed?.cableId ?? s.cableId, installedM: s.installed?.installedM ?? s.installedM ?? null, effectiveM: s.effectiveM })) })),
    nameOf
  )
  const matrixBlock = table(
    [{ key: 'device', label: 'Device' }, { key: 'port', label: 'Port' }, { key: 'hops', label: 'Hops' }, { key: 'toDevice', label: 'Destination' }, { key: 'toPort', label: 'Destination port' }, { key: 'cableIds', label: 'Cable IDs' }, { key: 'lengthM', label: 'Length (m)' }, { key: 'media', label: 'Media' }],
    matrix.map((r) => ({ ...r, hops: r.hops.join(' → ') || 'direct', cableIds: r.cableIds.join(', '), media: MEDIA[r.media] ?? r.media }))
  )
  return {
    sheets: [sheetOf('Cable schedule', scheduleTable(cableScheduleRows(data.connections, nameOf), h)), sheetOf('Cable matrix', matrixBlock), sheetOf('Port schedule', portTable(portScheduleRows(devices, data.connections, nameOf)))],
    placeholderHeadings: SCHEDULE_COLUMN_KEYS.filter((k) => !headings?.[k]),
  }
}

// --- Survey report ------------------------------------------------------------------
// data: { buildingFields: [tab], rooms: [{ code, floorName, tabs: [tab], racks: [{ code, heightU }], photos: [fileId] }] }
// tab: { tab, status, fields: [{ label, value }], tables: [{ title, columns, rows }] } (./survey.js).
// Every table section is printed in full; a long table continues across pages
// with its header repeated.
export function surveyReport(ctx, data) {
  const doc = base(ctx, 'Physical Site Survey Report')
  const tabBlocks = (t) => [
    ...(t.fields.length ? [kv(t.fields.map((f) => [f.label, f.value]))] : []),
    ...(t.tables ?? []).flatMap((tb) => [h3(tb.title), table(tb.columns, tb.rows, { empty: 'No rows recorded.' })]),
    ...(!t.fields.length && !(t.tables ?? []).length ? [p('No data recorded.')] : []),
  ]
  doc.sections = [
    section('summary', 'Summary', [kv([['Rooms surveyed', data.rooms.length], ['Racks', data.rooms.reduce((n, r) => n + r.racks.length, 0)], ['Photos', data.rooms.reduce((n, r) => n + r.photos.length, 0)], ['Survey status', data.status ?? '—']])]),
    section(
      'building',
      'Building',
      [...(data.buildingFields.length ? [] : [p('No building-level survey data recorded.')]), ...(data.buildingPhotos ?? []).map((id, k) => image(id, `Building photo ${k + 1}`))],
      data.buildingFields.map((t, i) => section(`building-${i}`, `${t.tab} (${t.status})`, tabBlocks(t)))
    ),
    section(
      'rooms',
      'Rooms',
      data.rooms.length ? [] : [p('No rooms surveyed.')],
      data.rooms.map((r, i) =>
        section(`room-${i}`, `Room ${r.code}${r.floorName ? ` · ${r.floorName}` : ''}`, [
          ...r.tabs.flatMap((t) => [h3(`${t.tab} — ${t.status}`), ...tabBlocks(t)]),
          r.racks.length ? table([{ key: 'code', label: 'Rack' }, { key: 'heightU', label: 'Height (U)' }], r.racks) : p('No racks.'),
          ...r.photos.map((id, k) => image(id, `${r.code} photo ${k + 1}`)),
        ])
      )
    ),
  ]
  return doc
}

// --- Solution Package (18 sections, brief v2.3 §5.5) ------------------------------
// data: { sp: SP view, hld, lld, bom: BOM view, prices: 'none'|'sell'|'cost', marginPercent }
export function solutionPackageDocument(ctx, data) {
  const doc = base(ctx, 'Solution Package')
  const { sp, lld, hld, bom } = data
  const prices = data.prices ?? 'none'
  const devices = (lld?.devices ?? hld?.devices ?? []).filter((d) => d.inDesign !== false)
  const connections = lld?.connections ?? hld?.connections ?? []
  const nameOf = nameMap(lld?.devices ?? hld?.devices ?? [])
  const group = (key) => sp.groups.find((g) => g.key === key)
  const groupBlocks = (key) => {
    const g = group(key)
    if (!g) return [note('No input recorded.', 'warning')]
    if (key === 'addressing') return [table([{ key: 'label', label: 'Segment' }, { key: 'vlanId', label: 'VLAN' }, { key: 'cidr', label: 'CIDR' }, { key: 'gateway', label: 'Gateway' }], g.addressingEntries ?? [], { empty: 'No addressing entries.' })]
    return [kv((g.kvPairs ?? []).map((x) => [x.key, x.value])), g.status !== 'complete' ? note(`Input status: ${g.status}`, 'warning') : null].filter(Boolean)
  }
  const factor = prices === 'sell' ? 1 + (data.marginPercent ?? 0) / 100 : 1
  const bomColumns = [{ key: 'category', label: 'Category' }, { key: 'item', label: 'Item' }, { key: 'spec', label: 'Specification' }, { key: 'qty', label: 'Qty' }, { key: 'unit', label: 'Unit' }, ...(prices === 'none' ? [] : [{ key: 'unitPrice', label: 'Unit price' }, { key: 'lineTotal', label: 'Line total' }])]
  const bomRows = (bom?.lines ?? []).map((l) => ({ ...l, unitPrice: money(l.unitPriceMinor == null ? null : Math.round(l.unitPriceMinor * factor), bom.currency), lineTotal: money(l.lineTotalMinor == null ? null : Math.round(l.lineTotalMinor * factor), bom.currency) }))
  const content = {
    scope: [kv([['Project', ctx.project?.name], ['Client', ctx.project?.clientName], ['Building', ctx.building ? `${ctx.building.code} ${ctx.building.name ?? ''}` : null], ['Package status', sp.state], ['Completeness', `${sp.packageCompleteness ?? 0}%`]])],
    site: [kv([['Floors', (lld ?? hld)?.floors?.length], ['Rooms', (lld ?? hld)?.rooms?.length], ['Racks', (lld ?? hld)?.racks?.length]])],
    physical: [table([{ key: 'code', label: 'Rack' }, { key: 'heightU', label: 'Height (U)' }], (lld ?? hld)?.racks ?? [])],
    naming: [table([{ key: 'hostname', label: 'Hostname' }, { key: 'role', label: 'Role' }, { key: 'model', label: 'Model' }], devices.filter((d) => !d.isPanel).map((d) => ({ hostname: d.hostname ?? d.label, role: d.roleLabel ?? d.role, model: d.model })))],
    diagrams: [svg(topologySvg({ floors: (lld ?? hld).floors, rooms: (lld ?? hld).rooms, devices: devices.filter((d) => !d.isPanel), connections }), 'Physical topology'), ...(lld?.racks ?? []).map((r) => svg(rackElevationSvg({ code: r.code, heightU: r.heightU, placements: r.placements }), `Rack ${r.code}`))],
    schedules: [portTable(portScheduleRows(devices, connections, nameOf))],
    cabling: [scheduleTable(cableScheduleRows(connections, nameOf), scheduleHeadings(data.headings))],
    compliance: [table([{ key: 'name', label: 'Validation area' }, { key: 'result', label: 'Result' }, { key: 'detail', label: 'Detail' }], (sp.validationAreas ?? []).map((a) => ({ name: a.name, result: a.result, detail: `${a.passed}/${a.total}` }))), ...(sp.acceptedWarnings ?? []).map((w) => note(`Accepted: ${w.text} — ${w.acceptedBy}`, 'warning'))],
    bom: [table(bomColumns, bomRows, { empty: 'No BOM lines.' }), prices === 'none' ? note('Quantities only — prices are not included in this export.') : kv([['Total', money(Math.round((bom?.pricing?.costMinor ?? bom?.lines?.reduce((n, l) => n + (l.lineTotalMinor ?? 0), 0) ?? 0) * factor), bom?.currency)]])],
    resources: [table([{ key: 'task', label: 'Task' }, { key: 'count', label: 'Count' }], Object.entries(sp.resourceEstimate?.totalsByTask ?? {}).map(([k, n]) => ({ task: RESOURCE_TASKS.find((t) => t.id === k)?.label ?? k, count: n }))), kv([['Estimated effort', `${sp.resourceEstimate?.totalHours ?? 0} h`]])],
    'open-items': [list([...(sp.groups ?? []).filter((g) => g.status !== 'complete').map((g) => `Input group ${g.n}. ${g.name}: ${g.status}`), ...(sp.acceptedWarnings ?? []).map((w) => `Accepted warning: ${w.text}`)].concat(['Assumptions and dependencies as agreed in the Required Inputs.']))],
  }
  doc.sections = SECTIONS.map((s) => section(s.id, s.name, [p(`Source: ${s.generatedFrom}`), ...(s.inputGroup ? groupBlocks(s.inputGroup) : content[s.id] ?? [p('—')])]))
  return doc
}

// --- BOM -------------------------------------------------------------------------------
// data: BOM view { lines, currency, pricing, procurement }, prices mode
export function bomDocument(ctx, data, { prices = 'none', marginPercent = 0 } = {}) {
  const doc = base(ctx, 'Bill of Materials')
  const factor = prices === 'sell' ? 1 + marginPercent / 100 : 1
  const columns = [{ key: 'category', label: 'Category' }, { key: 'item', label: 'Item' }, { key: 'spec', label: 'Specification' }, { key: 'qty', label: 'Qty' }, { key: 'unit', label: 'Unit' }, { key: 'source', label: 'Source' }, { key: 'procurement', label: 'Procurement' }, ...(prices === 'none' ? [] : [{ key: 'unitPrice', label: `Unit price (${data.currency})` }, { key: 'lineTotal', label: `Line total (${data.currency})` }])]
  const rows = data.lines.map((l) => ({ ...l, procurement: l.procurement?.status ?? 'not_ordered', unitPrice: l.unitPriceMinor == null ? '' : Math.round(l.unitPriceMinor * factor) / 100, lineTotal: l.lineTotalMinor == null ? '' : Math.round(l.lineTotalMinor * factor) / 100 }))
  const total = Math.round(data.lines.reduce((n, l) => n + (l.lineTotalMinor ?? 0), 0) * factor)
  const block = table(columns, rows, { empty: 'No BOM lines.' })
  doc.sections = [
    section('summary', 'Summary', [kv([['Lines', data.lines.length], ['Serialised devices', data.lines.filter((l) => l.lineType === 'serialised').length], ['Approved', data.procurement?.bomApproved ? `v${data.procurement.approvedVersionNumber}` : 'No'], ...(prices === 'none' ? [] : [['Total', money(total, data.currency)]])])]),
    section('lines', 'Lines', [block]),
  ]
  return { doc, sheet: sheetOf('BOM', block) }
}

// --- Deployment report -------------------------------------------------------------
// data: deployment view { devices, connections, exceptions, pipeline }, photos: deviceId → [fileId]
export function deploymentReport(ctx, data, { photos = {} } = {}) {
  const doc = base(ctx, 'Deployment Report')
  doc.sections = [
    section('summary', 'Summary', [kv([['Devices planned', data.pipeline.devices.planned], ['Installed', data.pipeline.devices.installed], ['Tested', data.pipeline.devices.tested], ['Accepted', data.pipeline.devices.accepted], ['Connections installed', `${data.pipeline.connections.installed}/${data.pipeline.connections.planned}`], ['Connections tested', data.pipeline.connections.tested], ['Open exceptions', data.exceptions.filter((e) => e.status === 'open').length]])]),
    section('installations', 'Installation records', [
      table(
        [{ key: 'device', label: 'Device' }, { key: 'status', label: 'Status' }, { key: 'serial', label: 'Serial' }, { key: 'mac', label: 'MAC' }, { key: 'placement', label: 'Rack / RU / face' }, { key: 'by', label: 'Technician' }, { key: 'at', label: 'Installed' }],
        data.devices.map((d) => ({ device: d.hostname ?? d.label, status: d.statusLabel, serial: d.installation.serial, mac: d.installation.mac, placement: d.installation.rackCode ? `${d.installation.rackCode} / ${d.installation.ru ?? '—'} / ${d.installation.face ?? '—'}` : '', by: d.installation.technician, at: day(d.installation.installedAt) }))
      ),
    ]),
    section('tests', 'Link tests', [table([{ key: 'link', label: 'Connection' }, { key: 'status', label: 'Status' }, { key: 'cables', label: 'Cables' }, { key: 'test', label: 'Test' }, { key: 'by', label: 'Tested by' }], data.connections.map((c) => ({ link: `${c.source.name} ${c.source.portId ?? ''} → ${c.dest.name} ${c.dest.portId ?? ''}`, status: c.statusLabel, cables: c.segments.map((s) => `${s.installed?.cableId ?? s.cableId ?? '—'} (${s.installed?.installedM ?? '—'} m)`).join(', '), test: c.test ? c.test.result : '', by: c.test?.by ?? '' })))]),
    section('exceptions', 'Exceptions', [exceptionTable(data.exceptions)]),
    section(
      'photos',
      'Evidence photos',
      Object.keys(photos).length ? [] : [p('No evidence photos.')],
      data.devices.filter((d) => photos[d.id]?.length).map((d, i) => section(`photos-${i}`, d.hostname ?? d.label, photos[d.id].map((id, k) => image(id, `${d.hostname ?? d.label} — photo ${k + 1}`))))
    ),
  ]
  return doc
}
const exceptionTable = (exceptions) =>
  table(
    [{ key: 'device', label: 'Device' }, { key: 'field', label: 'Field' }, { key: 'designed', label: 'Designed' }, { key: 'installed', label: 'Installed' }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' }, { key: 'review', label: 'Review' }],
    exceptions.map((e) => ({ device: e.deviceName, field: e.label, designed: e.designedValue, installed: e.installedValue, reason: e.reason, status: e.status, review: e.reviewedBy ? `${e.reviewedBy}${e.reviewNote ? `: ${e.reviewNote}` : ''}` : '' })),
    { empty: 'No exceptions.' }
  )

// --- Exception register -------------------------------------------------------------
export function exceptionRegister(ctx, data) {
  const doc = base(ctx, 'Exception Register')
  const count = (s) => data.exceptions.filter((e) => e.status === s).length
  doc.sections = [section('summary', 'Summary', [kv([['Logged', data.exceptions.length], ['Open', count('open')], ['Accepted', count('accepted')], ['Rejected', count('rejected')], ['Corrected', count('corrected')], ['Superseded', count('superseded')]])]), section('register', 'Register', [exceptionTable(data.exceptions)])]
  return doc
}

// --- As-built vs as-designed ----------------------------------------------------------
export function asBuiltComparison(ctx, data) {
  const doc = base(ctx, 'As-built vs As-designed')
  const deviceRows = data.devices.flatMap((d) => d.deviations.map((x) => ({ object: d.hostname ?? d.label, field: x.label, designed: x.designedValue, installed: x.installedValue, handled: x.handled ? 'Exception logged' : 'Unresolved' })))
  const connRows = data.connections.flatMap((c) => c.deviations.map((x) => ({ object: `${c.source.name} → ${c.dest.name}`, field: x.label, designed: x.designedValue, installed: x.installedValue, handled: x.handled ? 'Exception logged' : 'Unresolved' })))
  const cols = [{ key: 'object', label: 'Device / connection' }, { key: 'field', label: 'Field' }, { key: 'designed', label: 'As designed' }, { key: 'installed', label: 'As built' }, { key: 'handled', label: 'Resolution' }]
  doc.sections = [
    section('summary', 'Summary', [kv([['Devices installed', data.devices.filter((d) => !['planned', 'ordered', 'delivered'].includes(d.status)).length], ['Device differences', deviceRows.length], ['Connection differences', connRows.length], ['Accepted exceptions', data.exceptions.filter((e) => e.status === 'accepted').length]]), deviceRows.length + connRows.length === 0 ? note('The installation matches the frozen design field by field.', 'success') : null]),
    section('devices', 'Devices', [table(cols, deviceRows, { empty: 'No differences.' })]),
    section('connections', 'Connections', [table(cols, connRows, { empty: 'No differences.' })]),
    section('exceptions', 'Exceptions', [exceptionTable(data.exceptions)]),
  ]
  return doc
}

// --- CMDB extract -----------------------------------------------------------------------
const CMDB_COLUMNS = [
  ['hostname', 'Hostname'],
  // A device renamed through a change request keeps its old name (DATA-MODEL §5.19).
  ['legacyHostname', 'Legacy hostname'],
  ['role', 'Role'],
  ['model', 'Model'],
  ['serial', 'Serial'],
  ['mac', 'MAC'],
  ['room', 'Room'],
  ['rack', 'Rack'],
  ['ru', 'RU'],
  ['status', 'Status'],
  ['assetTag', 'Asset tag'],
  ['warrantyEnd', 'Warranty end'],
  ['dguv', 'DGUV'],
]
export function cmdbRowsOf(records) {
  return records.map((r) => ({ hostname: r.hostname ?? r.name ?? r.label, legacyHostname: r.legacyHostname ?? '', role: r.roleLabel ?? r.role ?? r.category, model: r.model, serial: r.serial, mac: r.mac, room: r.roomCode, rack: r.rackCode, ru: r.ru, status: r.statusLabel, assetTag: r.assetTag, warrantyEnd: r.lifecycle?.warrantyEnd, dguv: r.dguv?.label ?? 'n/a' }))
}
export function cmdbExtract(ctx, data) {
  const doc = base(ctx, 'CMDB Extract')
  const block = table(CMDB_COLUMNS.map(([key, label]) => ({ key, label })), cmdbRowsOf(data.records), { empty: 'No accepted records.' })
  doc.sections = [
    section('summary', 'Summary', [kv([['Records', data.records.length], ['Accepted connections', data.connections.length], ['Retired records', (data.retiredRecords ?? []).length]])]),
    section('records', 'Configuration items', [block]),
    section('connections', 'Connections', [table([{ key: 'device', label: 'Device' }, { key: 'port', label: 'Port' }, { key: 'toDevice', label: 'Destination' }, { key: 'toPort', label: 'Port' }, { key: 'cableIds', label: 'Cable IDs' }, { key: 'test', label: 'Test' }], (data.cableMatrix ?? []).map((r) => ({ ...r, cableIds: r.cableIds.join(', '), test: r.testResult })))]),
  ]
  const json = { building: ctx.building, generatedAt: ctx.generatedAt, records: data.records.map((r) => ({ id: r.id, hostname: r.hostname, legacyHostname: r.legacyHostname ?? null, role: r.role, model: r.model, vendor: r.vendor, serial: r.serial, mac: r.mac, assetTag: r.assetTag, status: r.status, location: { room: r.roomCode, rack: r.rackCode, ru: r.ru, face: r.face }, lifecycle: r.lifecycle, dguv: r.dguv, provenance: r.provenance, acceptedAt: r.acceptedAt })), connections: data.connections }
  return { doc, sheet: sheetOf('CMDB', block), json }
}

// --- DGUV V3 report ---------------------------------------------------------------------
// data: { devices: [{ label, room, rack, lastInspectionDate, inspector, dueDate, status }] , settings }
export function dguvReport(ctx, data) {
  const doc = base(ctx, 'DGUV V3 Inspection Report')
  // Exempt devices (addendum v2.3 Q13) are listed apart, each with its reason.
  const inScope = data.devices.filter((d) => d.status !== 'exempt')
  const exempt = data.devices.filter((d) => d.status === 'exempt')
  const block = table(
    [{ key: 'device', label: 'Device' }, { key: 'location', label: 'Location' }, { key: 'last', label: 'Last inspection' }, { key: 'inspector', label: 'Inspector' }, { key: 'due', label: 'Due' }, { key: 'status', label: 'Status' }],
    inScope.map((d) => ({ device: d.label, location: [d.room, d.rack].filter(Boolean).join(' · '), last: d.lastInspectionDate ?? 'Not inspected', inspector: d.inspector, due: d.dueDate, status: d.status ? DGUV_STATUS_LABEL[d.status] : 'Not inspected' })),
    { empty: 'No installed devices to inspect.' }
  )
  const exemptBlock = table([{ key: 'device', label: 'Device' }, { key: 'location', label: 'Location' }, { key: 'reason', label: 'Reason' }], exempt.map((d) => ({ device: d.label, location: [d.room, d.rack].filter(Boolean).join(' · '), reason: d.exemptReason })), { empty: 'No exempt devices.' })
  const count = (s) => inScope.filter((d) => (d.status ?? 'not_inspected') === s).length
  doc.sections = [
    section('summary', 'Summary', [kv([['Devices to inspect', inScope.length], ['Valid', count('valid')], ['Expiring soon', count('expiring_soon')], ['Expiring', count('expiring')], ['Overdue', count('overdue')], ['Not inspected', count('not_inspected')], ['Exempt (not inspected, with a reason)', exempt.length], ['Interval', `${data.settings.intervalMonths} months (warning ${data.settings.expiringSoonDays} / ${data.settings.expiringDays} days)`]])]),
    section('devices', 'Devices', [block]),
    section('exempt', 'Exempt devices', [exemptBlock]),
  ]
  return { doc, sheet: sheetOf('DGUV', block), exemptSheet: sheetOf('Exempt', exemptBlock) }
}

// --- Audit log ------------------------------------------------------------------------------
export function auditLogDocument(ctx, data) {
  const doc = base(ctx, 'Audit Log', ctx.project?.name ?? '')
  const block = table(
    [{ key: 'at', label: 'When' }, { key: 'actor', label: 'Who' }, { key: 'action', label: 'Action' }, { key: 'object', label: 'Object' }, { key: 'changeType', label: 'Change type' }, { key: 'comment', label: 'Comment' }],
    data.entries.map((e) => ({ at: new Date(e.occurredAt).toISOString().replace('T', ' ').slice(0, 16), actor: e.actorName ?? e.actor?.type, action: e.action, object: `${e.objectType}${e.objectId ? ` ${String(e.objectId).slice(-6)}` : ''}`, changeType: e.changeType, comment: e.comment ?? '' })),
    { empty: 'No entries for these filters.' }
  )
  doc.sections = [section('filters', 'Filters', [kv(Object.entries(data.filters ?? {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, v])), p(`${data.entries.length} entr${data.entries.length === 1 ? 'y' : 'ies'}${data.truncated ? ' (first 5,000 shown)' : ''}`)]), section('entries', 'Entries', [block])]
  return { doc, sheet: sheetOf('Audit log', block) }
}

// --- Executive summary ------------------------------------------------------------------------
// data: { phases: [{ phaseKey, status }], kpis, dguv, pipeline, exceptions, documents: [{ name, format, version }], baseline }
export function executiveSummary(ctx, data) {
  const doc = base(ctx, 'Executive Summary')
  doc.sections = [
    section('status', 'Project status', [table([{ key: 'phase', label: 'Phase' }, { key: 'status', label: 'Status' }], data.phases.map((ph) => ({ phase: PHASE[ph.phaseKey] ?? ph.phaseKey, status: PHASE_STATUS[ph.status] ?? ph.status })))]),
    section('figures', 'Key figures', [kv([['Devices', data.kpis?.devices], ['Connections designed', data.kpis?.connectionStatus?.designed ?? data.kpis?.connections], ['Connections installed', data.kpis?.connectionStatus?.installed], ['Connections accepted', data.kpis?.connectionStatus?.accepted], ['Devices accepted', data.pipeline?.devices.accepted], ['Open exceptions', (data.exceptions ?? []).filter((e) => e.status === 'open').length], ['DGUV not inspected', data.dguv?.notInspected ?? 0], ['DGUV exempt (with a reason)', data.dguv?.exempt ?? 0], ['DGUV overdue', data.dguv?.overdue ?? 0], ['Completion', `${data.kpis?.completionPercent ?? 0}%`]])]),
    section('documents', 'Handover documents', [table([{ key: 'name', label: 'Document' }, { key: 'format', label: 'Format' }], data.documents ?? [])]),
    section('baseline', 'Baseline', [data.baseline ? kv([['Baseline', data.baseline.label], ['Accepted', day(data.baseline.acceptedAt)]]) : p('The baseline is written when the client accepts the handover.')]),
  ]
  return doc
}

// --- Photo evidence pack ---------------------------------------------------------------
// files: [{ id, fileName, room, rack, device, category }] → ZIP paths, organised by room/rack.
export function photoPaths(files) {
  const safe = (s) => String(s ?? '').replace(/[^\w.\- ]+/g, '_').trim() || 'unnamed'
  const used = new Set()
  return files.map((f) => {
    const dir = [safe(f.room ?? 'Building'), f.rack ? safe(f.rack) : null, f.device ? safe(f.device) : null].filter(Boolean).join('/')
    let path = `${dir}/${safe(f.fileName)}`
    for (let n = 2; used.has(path); n++) path = `${dir}/${n}-${safe(f.fileName)}`
    used.add(path)
    return { id: f.id, path }
  })
}

export const SP_SECTION_TITLES = SECTIONS.map((s) => s.name)
export const INPUT_GROUP_COUNT = REQUIRED_INPUT_GROUPS.length
