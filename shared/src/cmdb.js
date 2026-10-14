// CMDB on the real backend (brief v2.3 §5.8; client audit 9.1, 9.2;
// DATA-MODEL §8.2; M6a). The CMDB is the as-built record: devices accepted in
// deployment, never design data. Pure helpers shared by the server and the
// client: field-level provenance, the cable matrix with its hop trace,
// lifecycle dates, lifecycle import matching, reconciliation and the
// orthogonal route drawn over a rack elevation.
import { ACCEPTED_DEVICE } from './deployment.js'
import { addDays } from './timeZone.js'

export const PROVENANCE_SOURCES = ['design', 'manual', 'import', 'deployment']
export const PROVENANCE_LABEL = { design: 'Design', manual: 'Manual', import: 'Import', deployment: 'Deployment' }
export const provenanceEntry = (source, { userId = null, userName = null, at = new Date(), importBatchId = null } = {}) => ({
  source,
  setBy: userId,
  setByName: userName,
  setAt: at instanceof Date ? at.toISOString() : at,
  importBatchId,
})

export const isCmdbRecord = (device) => ACCEPTED_DEVICE.has(device.status)

// Operational fields an Architect or PM may edit in the CMDB.
export const OPERATIONAL_FIELDS = ['assetTag', 'notes', 'status', 'warrantyStart', 'warrantyEnd', 'refreshDate']
export const OPERATIONAL_STATUSES = ['in_service', 'maintenance']
export const LIFECYCLE_FIELDS = ['warrantyStart', 'warrantyEnd', 'refreshDate']

// --- Lifecycle ---------------------------------------------------------------------

// One date against today (local date): expired / due within 90 days / ok.
export function dateState(date, today, soonDays = 90) {
  if (!date) return null
  const d = String(date).slice(0, 10)
  if (d < today) return 'expired'
  if (d <= addDays(today, soonDays)) return 'soon'
  return 'ok'
}
export function lifecycleSummary({ warrantyEnd, refreshDate, eosDate, eolDate }, today) {
  return {
    warranty: dateState(warrantyEnd, today),
    refresh: dateState(refreshDate, today),
    eos: dateState(eosDate, today),
    eol: dateState(eolDate, today),
  }
}

// --- Lifecycle import (CSV / Excel) -------------------------------------------------------

const HEADER_ALIASES = {
  serial: ['serial', 'serial number', 'serialnumber', 'sn'],
  hostname: ['hostname', 'host', 'device', 'name'],
  warrantyStart: ['warranty start', 'warrantystart', 'warranty_start'],
  warrantyEnd: ['warranty end', 'warrantyend', 'warranty_end'],
  refreshDate: ['refresh', 'refresh date', 'refreshdate', 'refresh_date'],
}
const norm = (s) => String(s ?? '').trim().toLowerCase()

// A cell to YYYY-MM-DD: ISO text, DD.MM.YYYY, DD/MM/YYYY, a Date, or an Excel serial.
export function importDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return valid(m[1], m[2], m[3])
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (m) return valid(m[3], m[2].padStart(2, '0'), m[1].padStart(2, '0'))
  return undefined
}
function valid(y, m, d) {
  const iso = `${y}-${m}-${d}`
  const t = new Date(`${iso}T00:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : undefined
}

// Rows (objects keyed by header) → [{ row, deviceId, match, values, problems }].
// Matched by serial first, then by hostname. `devices`: CMDB records
// [{ id, serial, hostname }].
export function matchLifecycleRows(rows, devices) {
  const bySerial = new Map(devices.filter((d) => d.serial).map((d) => [norm(d.serial), d]))
  const byHost = new Map(devices.filter((d) => d.hostname).map((d) => [norm(d.hostname), d]))
  return rows.map((raw, i) => {
    const cell = {}
    for (const [k, v] of Object.entries(raw)) {
      const field = Object.keys(HEADER_ALIASES).find((f) => HEADER_ALIASES[f].includes(norm(k)))
      if (field) cell[field] = v
    }
    const problems = []
    let device = null
    let match = null
    if (cell.serial && bySerial.has(norm(cell.serial))) [device, match] = [bySerial.get(norm(cell.serial)), 'serial']
    else if (cell.hostname && byHost.has(norm(cell.hostname))) [device, match] = [byHost.get(norm(cell.hostname)), 'hostname']
    else problems.push(cell.serial || cell.hostname ? `No CMDB record with serial or hostname "${cell.serial ?? cell.hostname}"` : 'Needs a serial or hostname')
    const values = {}
    for (const f of LIFECYCLE_FIELDS) {
      if (!(f in cell)) continue
      const d = importDate(cell[f])
      if (d === undefined) problems.push(`${f}: "${cell[f]}" is not a date`)
      else if (d) values[f] = d
    }
    if (values.warrantyStart && values.warrantyEnd && values.warrantyEnd < values.warrantyStart) problems.push('Warranty end is before warranty start')
    if (!problems.length && !Object.keys(values).length) problems.push('No lifecycle dates in this row')
    return { row: i + 2, deviceId: device?.id ?? null, match, values, problems }
  })
}

// --- Cable matrix ---------------------------------------------------------------------------

// Every port of the CMDB with its far end and the hops between.
// `connections`: connection views with source/dest { deviceId, portId },
// hops [{ patchPanelId, inPort, outPort }], segments [{ cableId, installedM, effectiveM }],
// status, testResult; `nameOf(deviceId)`.
export function cableMatrix(connections, nameOf) {
  const rows = []
  for (const c of connections) {
    const hopText = (c.hops ?? []).map((h) => `${nameOf(h.patchPanelId)} ${h.inPort ?? '?'}/${h.outPort ?? '?'}`)
    const cableIds = (c.segments ?? []).map((s) => s.cableId).filter(Boolean)
    const base = { connectionId: c.id, media: c.media, status: c.status, testResult: c.testResult ?? null, cableIds, lengthM: sumLengths(c.segments) }
    rows.push({ ...base, key: `${c.id}:s`, deviceId: String(c.source.deviceId), device: nameOf(c.source.deviceId), port: c.source.portId, toDeviceId: String(c.dest.deviceId), toDevice: nameOf(c.dest.deviceId), toPort: c.dest.portId, hops: hopText })
    rows.push({ ...base, key: `${c.id}:d`, deviceId: String(c.dest.deviceId), device: nameOf(c.dest.deviceId), port: c.dest.portId, toDeviceId: String(c.source.deviceId), toDevice: nameOf(c.source.deviceId), toPort: c.source.portId, hops: [...hopText].reverse() })
  }
  return rows.sort((a, b) => a.device.localeCompare(b.device) || String(a.port).localeCompare(String(b.port), undefined, { numeric: true }))
}
function sumLengths(segments = []) {
  const ls = segments.map((s) => s.installedM ?? s.effectiveM)
  return ls.every((l) => l != null) && ls.length ? Math.round(ls.reduce((a, b) => a + b, 0) * 10) / 10 : null
}

// --- Reconciliation -----------------------------------------------------------------------

// Design baseline (frozen LLD devices) vs installed (CMDB) counts, devices
// without a serial, one cable ID used twice, open exceptions.
export function reconcile({ designDevices, devices, connections, openExceptions = 0 }) {
  const installed = devices.filter((d) => ['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance'].includes(d.status))
  const cmdb = devices.filter(isCmdbRecord)
  const seen = new Map()
  for (const c of connections) {
    for (const s of c.segments ?? []) {
      if (!s.cableId) continue
      const k = norm(s.cableId)
      if (!seen.has(k)) seen.set(k, { cableId: s.cableId, connectionIds: new Set() })
      seen.get(k).connectionIds.add(String(c.id))
    }
  }
  const cableIdConflicts = [...seen.values()].filter((v) => v.connectionIds.size > 1).map((v) => ({ cableId: v.cableId, connections: v.connectionIds.size }))
  return {
    designCount: designDevices.length,
    installedCount: installed.length,
    cmdbCount: cmdb.length,
    notInstalled: designDevices.length - installed.length,
    missingSerials: installed.filter((d) => !d.serial).map((d) => ({ id: d.id, hostname: d.hostname })),
    cableIdConflicts,
    openExceptions,
  }
}

// --- Port route over the rack elevation -----------------------------------------------

// The route as orthogonal segments through the given waypoints: each step
// goes horizontally first, then vertically, so the line never runs diagonally
// (cable managers are waypoints at their own x). Returns an SVG path.
export function orthogonalPath(points) {
  if (points.length < 2) return ''
  const d = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]
    const q = points[i]
    if (p.x !== q.x) d.push(`H ${q.x}`)
    if (p.y !== q.y) d.push(`V ${q.y}`)
  }
  return d.join(' ')
}
