import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'
import { uploadFile } from './filesApi.js'
import { newObjectId } from '../lib/realOfflineQueue.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}`
const none = (value) => Promise.resolve(value)

// Real mode only (M6a). Mock mode keeps api/deploymentDesign.js and api/cmdbDesign.js.
export const deploymentApi = {
  view: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/deployment/buildings/${buildingId}`) : none(null)),
  saveInstallation: (o, p, deviceId, body) => (real ? apiRequest(`${base(o, p)}/deployment/devices/${deviceId}/installation`, { method: 'PUT', body }) : none(null)),
  recordDguv: (o, p, deviceId, body) => (real ? apiRequest(`${base(o, p)}/deployment/devices/${deviceId}/dguv`, { method: 'PUT', body }) : none(null)),
  overrideDguv: (o, p, deviceId, body) => (real ? apiRequest(`${base(o, p)}/deployment/devices/${deviceId}/dguv-override`, { method: 'PUT', body }) : none(null)),
  setStatus: (o, p, deviceId, body) => (real ? apiRequest(`${base(o, p)}/deployment/devices/${deviceId}/status`, { method: 'POST', body }) : none(null)),
  saveConnection: (o, p, connectionId, body) => (real ? apiRequest(`${base(o, p)}/deployment/connections/${connectionId}/installation`, { method: 'PUT', body }) : none(null)),
  testConnection: (o, p, connectionId, body) => (real ? apiRequest(`${base(o, p)}/deployment/connections/${connectionId}/test`, { method: 'POST', body }) : none(null)),
  acceptConnection: (o, p, connectionId) => (real ? apiRequest(`${base(o, p)}/deployment/connections/${connectionId}/accept`, { method: 'POST', body: {} }) : none(null)),
  logException: (o, p, body) => (real ? apiRequest(`${base(o, p)}/deployment/exceptions`, { method: 'POST', body }) : none(null)),
  reviewException: (o, p, exceptionId, body) => (real ? apiRequest(`${base(o, p)}/deployment/exceptions/${exceptionId}/review`, { method: 'POST', body }) : none(null)),
  // Evidence photos and DGUV certificates go to the device (existing file service).
  uploadDeviceFile: (o, p, deviceId, file, category) =>
    uploadFile(o, p, file, { fileId: newObjectId(), fileName: file.name || 'photo.jpg', mimeType: file.type || 'image/jpeg', category, attachedTo: { type: 'device', id: deviceId }, capturedAt: null, caption: null }),
}

export const cmdbApi = {
  view: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/cmdb/buildings/${buildingId}`) : none(null)),
  edit: (o, p, deviceId, body) => (real ? apiRequest(`${base(o, p)}/cmdb/records/${deviceId}`, { method: 'PATCH', body }) : none(null)),
  importLifecycle: (o, p, body) => (real ? apiRequest(`${base(o, p)}/cmdb/lifecycle-import`, { method: 'POST', body }) : none(null)),
}

// --- Pure helpers (unit-tested) ------------------------------------------------

// The installation form's starting values: what was recorded, else the design.
export function installationDraft(device) {
  const inst = device.installation ?? {}
  return {
    serial: inst.serial ?? '',
    mac: inst.mac ?? '',
    rackId: inst.rackId ?? device.rackId ?? '',
    ru: inst.ru ?? device.ru ?? '',
    face: inst.face ?? device.face ?? 'front',
    pduOutlet: inst.pduOutlet ?? '',
    notes: inst.notes ?? '',
  }
}

// The form as the request body: empty text is null, the RU a number.
export function installationBody(draft, { placed }) {
  const text = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim())
  return {
    serial: text(draft.serial),
    mac: text(draft.mac),
    ...(placed ? { rackId: draft.rackId || null, ru: draft.ru === '' || draft.ru == null ? null : Number(draft.ru), face: draft.face || null } : {}),
    pduOutlet: text(draft.pduOutlet),
    notes: text(draft.notes),
  }
}

// One connection's patching form: per cable, recorded values else the design.
export function patchingDraft(conn) {
  return {
    sourcePort: conn.installed?.sourcePort ?? conn.source.portId ?? '',
    destPort: conn.installed?.destPort ?? conn.dest.portId ?? '',
    segments: conn.segments.map((s) => ({
      index: s.index,
      cableId: s.installed?.cableId ?? s.cableId ?? '',
      installedM: s.installed?.installedM ?? '',
      confirmed: Boolean(s.installed?.confirmed),
    })),
  }
}
export function patchingBody(draft, { confirm = false } = {}) {
  return {
    sourcePort: draft.sourcePort.trim() || null,
    destPort: draft.destPort.trim() || null,
    segments: draft.segments.map((s) => ({ index: s.index, cableId: String(s.cableId).trim() || null, installedM: s.installedM === '' || s.installedM == null ? null : Number(s.installedM), confirmed: Boolean(s.confirmed) })),
    ...(confirm ? { confirm: true } : {}),
  }
}

// Inventory rows for the prototype's table and the Excel export.
export function cmdbRows(records) {
  return records.map((r) => ({
    ...r,
    role: r.roleLabel ?? r.role ?? r.category ?? '',
    lifecycle: r.statusLabel,
    acceptance: r.acceptedAt ? `Accepted ${String(r.acceptedAt).slice(0, 10)}${r.acceptedBy ? ` by ${r.acceptedBy}` : ''}` : '—',
    dguv: r.dguv ? { status: r.dguv.label ?? r.dguv.status } : null,
  }))
}

// Search across hostname, serial, MAC and cable IDs; filters by status and room.
export function filterRecords(records, connections, { q = '', status = '', roomCode = '' } = {}) {
  const needle = q.trim().toLowerCase()
  const cablesOf = new Map()
  for (const c of connections) {
    for (const s of c.segments ?? []) {
      if (!s.cableId) continue
      for (const id of [c.source.deviceId, c.dest.deviceId]) cablesOf.set(id, [...(cablesOf.get(id) ?? []), s.cableId])
    }
  }
  return records.filter((r) => {
    if (status && r.status !== status) return false
    if (roomCode && r.roomCode !== roomCode) return false
    if (!needle) return true
    return [r.hostname, r.label, r.serial, r.mac, r.assetTag, ...(cablesOf.get(r.id) ?? [])].some((v) => v && String(v).toLowerCase().includes(needle))
  })
}

// A sheet (first row headers) as row objects for the lifecycle import.
export async function readSheetRows(file) {
  const XLSX = await import('xlsx')
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
  const sheet = book.Sheets[book.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'number' || v == null ? v : String(v)])))
}
