// Deployment & Installation on the real backend (brief v2.3 §5.7, §4.4, §6.9;
// DATA-MODEL §4.1a, §4.11, §5.2, §5.3; M6a). Pure rules shared by the server
// and the client: status flows and who may move them, delivery gating,
// serial/MAC checks, deviation detection against the frozen LLD, DGUV status
// on the organisation's local date, and the pipeline numbers.
import { deploymentLabel } from './deploymentModel.js'
import { addDays } from './timeZone.js'

// --- Status flows --------------------------------------------------------------

export const DEVICE_FLOW = ['planned', 'ordered', 'delivered', 'installed', 'configured', 'tested', 'accepted']
export const CONNECTION_FLOW = ['designed', 'approved', 'installed', 'tested', 'accepted']
export const ACCEPTED_DEVICE = new Set(['accepted', 'in_service', 'maintenance'])
export const ACCEPTED_CONNECTION = new Set(['accepted', 'in_service'])
export const STATUS_LABELS = {
  planned: 'Planned',
  ordered: 'Ordered',
  delivered: 'Delivered',
  installed: 'Installed',
  configured: 'Configured',
  tested: 'Tested',
  accepted: 'Accepted',
  in_service: 'In service',
  maintenance: 'Maintenance',
  retired: 'Retired',
  designed: 'Designed',
  approved: 'Approved',
  faulty: 'Faulty',
}
export { deploymentLabel }

// Who moves a device to a status (the installation itself is "installed").
const DEVICE_STEP_ROLES = {
  installed: ['field_engineer'],
  configured: ['field_engineer'],
  tested: ['field_engineer'],
  accepted: ['pm', 'reviewer'],
}

// Why a device cannot move `from` → `to` now (null: it can). `ctx`: { roles,
// delivered, serial, mainsPowered, dguvRecorded, openDeviations (count of
// differences neither corrected nor logged), openExceptions (logged, not yet
// accepted), connections: [{ status }] }.
export function deviceStepProblem(from, to, ctx) {
  const roles = ctx.roles ?? []
  const allowed = DEVICE_STEP_ROLES[to]
  if (!allowed) return `A device cannot be set to ${STATUS_LABELS[to] ?? to} here`
  if (!allowed.some((r) => roles.includes(r))) return to === 'accepted' ? 'Only a PM or Reviewer accepts a device' : 'Only the Field Engineer records installation steps'
  const order = DEVICE_FLOW.indexOf(to)
  const current = DEVICE_FLOW.indexOf(from)
  if (to === 'installed') {
    if (!ctx.delivered) return 'Awaiting delivery — the device can be installed once its procurement line is Delivered'
    if (current > order) return null // re-confirming an installed device keeps its status
    return null
  }
  if (current !== order - 1) return `${STATUS_LABELS[from] ?? from} cannot move to ${STATUS_LABELS[to]} — next is ${STATUS_LABELS[DEVICE_FLOW[current + 1]] ?? 'nothing'}`
  if (to === 'tested') {
    const untested = (ctx.connections ?? []).filter((c) => !['tested', 'accepted', 'in_service'].includes(c.status))
    if (untested.length) return `${untested.length} connection(s) of this device are not tested yet`
  }
  if (to === 'accepted') {
    const missing = acceptanceBlockers(ctx)
    if (missing.length) return `Cannot accept yet: ${missing.join('; ')}`
  }
  return null
}

export function acceptanceBlockers(ctx) {
  const out = []
  if (ctx.serialised !== false && !ctx.serial) out.push('no serial number recorded')
  if (ctx.mainsPowered && !ctx.dguvRecorded) out.push('no DGUV inspection recorded')
  if (ctx.openDeviations > 0) out.push(`${ctx.openDeviations} deviation(s) neither corrected nor logged as an exception`)
  if (ctx.openExceptions > 0) out.push(`${ctx.openExceptions} exception(s) not yet accepted`)
  return out
}

// Connections: installed (patching confirmed on every cable) → tested
// (pass; a fail is "faulty") → accepted (PM or Reviewer).
export function connectionStepProblem(from, to, { roles = [], segmentsConfirmed = true } = {}) {
  if (to === 'installed') {
    if (!roles.includes('field_engineer')) return 'Only the Field Engineer confirms patching'
    if (!segmentsConfirmed) return 'Confirm every cable of the route first'
    return null
  }
  if (to === 'tested' || to === 'faulty') {
    if (!roles.includes('field_engineer')) return 'Only the Field Engineer records a link test'
    if (!['installed', 'tested', 'faulty'].includes(from)) return 'Confirm the patching before the link test'
    return null
  }
  if (to === 'accepted') {
    if (!roles.some((r) => ['pm', 'reviewer'].includes(r))) return 'Only a PM or Reviewer accepts a connection'
    if (from !== 'tested') return 'A connection is accepted once its link test has passed'
    return null
  }
  return `A connection cannot be set to ${to} here`
}

// --- Delivery gating (brief D22, M6a) ------------------------------------------------

// A serialised device is installable once its own procurement line
// (device:<id>) is Delivered; a passive item (patch panel, cable manager) once
// its aggregated line is. `lineStatus`: the procurement status of that line.
export const isDelivered = (lineStatus) => lineStatus === 'delivered'

// --- Serial and MAC ------------------------------------------------------------------

// Any common notation (colons, dashes, Cisco dots, none) to the stored form
// the CMO import uses: lower case, colon-separated. null: empty; undefined:
// not a MAC.
export function installMac(raw) {
  if (raw == null || String(raw).trim() === '') return null
  const s = String(raw).trim()
  if (/[^0-9a-f:.\- ]/i.test(s)) return undefined
  const hex = s.replace(/[:.\- ]/g, '').toLowerCase()
  if (hex.length !== 12) return undefined
  return hex.match(/.{2}/g).join(':')
}
export function macProblem(raw) {
  return installMac(raw) === undefined ? 'A MAC address has 12 hexadecimal digits, e.g. 00:1A:2B:3C:4D:5E' : null
}
export const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{1,63}$/
// A serial is unique in the project: one held by a CMO-imported device or
// by another installed device is refused, naming the holder. `holder`:
// { kind: 'cmo' | 'device', name } or null.
export function serialProblem(serial, holder = null) {
  if (!serial) return null
  if (!SERIAL_PATTERN.test(String(serial).trim())) return 'A serial has 2 to 64 letters, digits, dashes, dots, slashes or underscores'
  if (!holder) return null
  return holder.kind === 'cmo' ? `Serial ${serial} belongs to the CMO-imported device ${holder.name} — check the label` : `Serial ${serial} is already recorded on ${holder.name}`
}

// --- Deviations against the frozen LLD ----------------------------------------------------

// Installed length outside max(0.5 m, 10 %) of the designed (Engineer
// Selected, else Suggested) length is a deviation ★.
export const LENGTH_TOLERANCE = { minM: 0.5, pct: 10 }
export function lengthBeyondTolerance(designedM, installedM, tol = LENGTH_TOLERANCE) {
  if (designedM == null || installedM == null) return false
  return Math.abs(installedM - designedM) > Math.max(tol.minM, (designedM * tol.pct) / 100)
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const shown = (v) => (v == null || v === '' ? '—' : String(v))

// Device placement: rack, RU, face. `design`: { rackId, rackCode, ru, face };
// `installed`: { rackId, rackCode, ru, face } (null fields = not recorded yet).
export function deviceDeviations(design, installed) {
  const out = []
  if (!installed) return out
  if (installed.rackId && design.rackId && String(installed.rackId) !== String(design.rackId)) out.push({ field: 'rack', label: 'Rack', designedValue: shown(design.rackCode ?? design.rackId), installedValue: shown(installed.rackCode ?? installed.rackId) })
  if (installed.ru != null && design.ru != null && Number(installed.ru) !== Number(design.ru)) out.push({ field: 'ru', label: 'RU', designedValue: shown(design.ru), installedValue: shown(installed.ru) })
  if (installed.face && design.face && installed.face !== design.face) out.push({ field: 'face', label: 'Face', designedValue: design.face, installedValue: installed.face })
  return out
}

// One connection: ends, media, SFPs; per cable segment the cable ID and the
// installed length. `design`: the LLD connection view (source, dest, media,
// sourceSfpCode, destSfpCode, segments [{ index, cableId, effectiveM }]);
// `installed`: { sourcePort, destPort, media, sourceSfpCode, destSfpCode,
// segments: [{ index, cableId, installedM }] }. Unrecorded values are skipped.
export function connectionDeviations(design, installed, tol = LENGTH_TOLERANCE) {
  const out = []
  if (!installed) return out
  const check = (field, label, designed, value) => {
    if (value == null || value === '') return
    if (!same(designed, value)) out.push({ field, label, designedValue: shown(designed), installedValue: shown(value) })
  }
  check('source_port', 'Source port', design.source?.portId, installed.sourcePort)
  check('dest_port', 'Destination port', design.dest?.portId, installed.destPort)
  check('media', 'Media', design.media, installed.media)
  check('source_sfp', 'Source SFP', design.sourceSfpCode, installed.sourceSfpCode)
  check('dest_sfp', 'Destination SFP', design.destSfpCode, installed.destSfpCode)
  for (const seg of installed.segments ?? []) {
    const d = (design.segments ?? []).find((s) => s.index === seg.index)
    if (!d) continue
    const n = (design.segments ?? []).length > 1 ? ` (cable ${seg.index + 1})` : ''
    check(`cable_id:${seg.index}`, `Cable ID${n}`, d.cableId, seg.cableId)
    if (lengthBeyondTolerance(d.effectiveM, seg.installedM, tol)) out.push({ field: `length:${seg.index}`, label: `Length${n}`, designedValue: `${d.effectiveM} m`, installedValue: `${seg.installedM} m` })
  }
  return out
}

// Deviations not yet handled: neither corrected (they would no longer be
// detected) nor logged as an exception (open or accepted) for the value
// installed now.
export const LIVE_EXCEPTION = new Set(['open', 'accepted'])
const exceptionKey = (field, installedValue) => `${field}\u0000${String(installedValue ?? '').toLowerCase()}`
export function unhandledDeviations(deviations, exceptions, { deviceId, connectionId = null }) {
  const logged = new Set(
    exceptions
      .filter((e) => LIVE_EXCEPTION.has(e.status) && (connectionId ? String(e.connectionId) === String(connectionId) : !e.connectionId && String(e.deviceId) === String(deviceId)))
      .map((e) => exceptionKey(e.field, e.installedValue))
  )
  return deviations.filter((d) => !logged.has(exceptionKey(d.field, d.installedValue)))
}
// What happens to a live exception when the installation is saved again:
// its deviation is gone → corrected; it now shows another value → superseded.
export function exceptionOutcome(exception, deviations) {
  const d = deviations.find((x) => x.field === exception.field)
  if (!d) return 'corrected'
  return String(d.installedValue ?? '').toLowerCase() === String(exception.installedValue ?? '').toLowerCase() ? null : 'superseded'
}

// --- DGUV on the organisation's local date (brief §6.9, M6a) --------------------------------

export const DEFAULT_DGUV = { intervalMonths: 48, expiringSoonDays: 90, expiringDays: 30 }
export const DGUV_STATUS_LABEL = { valid: 'Valid', expiring_soon: 'Expiring soon', expiring: 'Expiring', overdue: 'Overdue' }

function addMonthsToDate(dateStr, months) {
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

// null when the device has no DGUV obligation. `today`: the local date
// (YYYY-MM-DD) in the organisation's time zone. A mains-powered device with
// no inspection is overdue.
export function dguvStatus({ lastInspectionDate = null, mainsPowered }, today, settings = DEFAULT_DGUV) {
  if (!mainsPowered) return null
  const s = { ...DEFAULT_DGUV, ...settings }
  if (!lastInspectionDate) return { dueDate: null, daysRemaining: null, status: 'overdue', label: DGUV_STATUS_LABEL.overdue }
  const dueDate = addMonthsToDate(lastInspectionDate, s.intervalMonths)
  const daysRemaining = daysBetween(today, dueDate)
  const status = daysRemaining < 0 ? 'overdue' : daysRemaining <= s.expiringDays ? 'expiring' : daysRemaining <= s.expiringSoonDays ? 'expiring_soon' : 'valid'
  return { dueDate, daysRemaining, status, label: DGUV_STATUS_LABEL[status] }
}
// Mains-powered: the catalogue model has a power inlet or PSUs (a PoE-only AP has none).
export const isMainsPowered = (item) => Boolean(item && (item.powerInletType || (item.psuCount ?? 0) > 0))

// --- Pipeline and location tree ------------------------------------------------------

// planned → installed → tested → remaining, over devices and connections.
export function pipelineStats(devices, connections) {
  const installedD = devices.filter((d) => ['installed', 'configured', 'tested', 'accepted', 'in_service'].includes(d.status)).length
  const testedD = devices.filter((d) => ['tested', 'accepted', 'in_service'].includes(d.status)).length
  const acceptedD = devices.filter((d) => ACCEPTED_DEVICE.has(d.status)).length
  const installedC = connections.filter((c) => ['installed', 'tested', 'accepted', 'in_service', 'faulty'].includes(c.status)).length
  const testedC = connections.filter((c) => ['tested', 'accepted', 'in_service'].includes(c.status)).length
  return {
    devices: { planned: devices.length, installed: installedD, tested: testedD, accepted: acceptedD, remaining: devices.length - installedD },
    connections: { planned: connections.length, installed: installedC, tested: testedC, faulty: connections.filter((c) => c.status === 'faulty').length, remaining: connections.length - installedC },
    progress: devices.length ? Math.round((acceptedD / devices.length) * 100) : 0,
  }
}

// Deployment phase status per building: not started until a device is
// installed; completed when every device is accepted.
export function deploymentPhaseStatus(devices) {
  if (!devices.length || !devices.some((d) => ['installed', 'configured', 'tested', 'accepted', 'in_service'].includes(d.status))) return 'not_started'
  return devices.every((d) => ACCEPTED_DEVICE.has(d.status)) ? 'completed' : 'in_progress'
}
export function cmdbPhaseStatus(designCount, acceptedCount) {
  if (!acceptedCount) return 'not_started'
  return acceptedCount >= designCount ? 'completed' : 'in_progress'
}

// --- Room checklist (the Bill of Resources tasks, brief §5.5, ticked off) ------------

// devices: [{ roomCode, role, passive, notProcured, mainsPowered, dguvRecorded, rackId, status }];
// connections: [{ roomCode, media, status }]; racks: [{ id, roomCode }].
const INSTALLED = new Set(['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance'])
export function roomChecklists({ devices, connections, racks }) {
  const rooms = new Map()
  const tick = (room, task, done) => {
    const key = room ?? 'Unassigned'
    if (!rooms.has(key)) rooms.set(key, new Map())
    const t = rooms.get(key).get(task) ?? { total: 0, done: 0 }
    t.total += 1
    if (done) t.done += 1
    rooms.get(key).set(task, t)
  }
  for (const d of devices) {
    if (d.notProcured) continue
    const installed = INSTALLED.has(d.status)
    if (d.passive) tick(d.roomCode, 'install-rack-accessory', installed)
    else tick(d.roomCode, d.role === 'ap' ? 'mount-ap' : 'install-device', installed)
    if (d.mainsPowered) tick(d.roomCode, 'dguv-inspection', Boolean(d.dguvRecorded))
  }
  for (const r of racks) {
    const inRack = devices.filter((d) => d.rackId === r.id)
    tick(r.roomCode, 'install-rack-accessory', inRack.length > 0 && inRack.every((d) => INSTALLED.has(d.status)))
  }
  for (const c of connections) {
    const patched = ['installed', 'tested', 'faulty', 'accepted', 'in_service'].includes(c.status)
    tick(c.roomCode, c.media === 'cat6a' ? 'patch-copper' : 'patch-fibre', patched)
    tick(c.roomCode, 'label-cable', patched)
    tick(c.roomCode, 'test-link', ['tested', 'accepted', 'in_service'].includes(c.status))
  }
  return [...rooms.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([room, tasks]) => ({ room, tasks: TASK_ORDER.filter((t) => tasks.has(t.id)).map((t) => ({ id: t.id, label: t.label, ...tasks.get(t.id) })) }))
}
const TASK_ORDER = [
  { id: 'install-device', label: 'Install device' },
  { id: 'mount-ap', label: 'Mount AP' },
  { id: 'install-rack-accessory', label: 'Install rack / accessory' },
  { id: 'patch-copper', label: 'Patch copper cable' },
  { id: 'patch-fibre', label: 'Patch fibre cable' },
  { id: 'label-cable', label: 'Label cable' },
  { id: 'test-link', label: 'Test link' },
  { id: 'dguv-inspection', label: 'DGUV inspection' },
]

export { addDays }
