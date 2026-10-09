import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/hld`
const none = (value) => Promise.resolve(value)

// Real mode only (M4a). Mock mode's HLD keeps using api/hld.js. Every design
// write carries the revision the screen loaded; a stale one comes back as a
// 409 `stale_revision` with who changed it.
export const hldApi = {
  library: (o, p) => (real ? apiRequest(`${base(o, p)}/library`) : none({ roles: [], optics: [], presets: [], variants: [] })),
  view: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}`) : none(null)),
  validate: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/validation`) : none({ findings: [], summary: { critical: 0, warning: 0, info: 0, blocksSubmit: false } })),
  generate: (o, p, body) => (real ? apiRequest(`${base(o, p)}/generate`, { method: 'POST', body }) : none(null)),
  addDevice: (o, p, body) => (real ? apiRequest(`${base(o, p)}/devices`, { method: 'POST', body }) : none(null)),
  updateDevice: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/devices/${id}`, { method: 'PATCH', body }) : none(null)),
  deleteDevice: (o, p, id, baseRevision) => (real ? apiRequest(`${base(o, p)}/devices/${id}?baseRevision=${baseRevision}`, { method: 'DELETE' }) : none(null)),
  moveDevice: (o, p, id, position) => (real ? apiRequest(`${base(o, p)}/devices/${id}/position`, { method: 'PUT', body: position }) : none(null)),
  checkUplink: (o, p, body) => (real ? apiRequest(`${base(o, p)}/uplinks/check`, { method: 'POST', body }) : none(null)),
  createUplink: (o, p, body) => (real ? apiRequest(`${base(o, p)}/uplinks`, { method: 'POST', body }) : none(null)),
  updateUplink: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/uplinks/${id}`, { method: 'PATCH', body }) : none(null)),
  deleteUplink: (o, p, id, baseRevision) => (real ? apiRequest(`${base(o, p)}/uplinks/${id}?baseRevision=${baseRevision}`, { method: 'DELETE' }) : none(null)),
  submit: (o, p, body) => (real ? apiRequest(`${base(o, p)}/submit`, { method: 'POST', body }) : none(null)),
  decide: (o, p, body) => (real ? apiRequest(`${base(o, p)}/decision`, { method: 'POST', body }) : none(null)),
}

// --- Pure helpers (unit-tested) ------------------------------------------------

// The Edit Uplink draft (prototype EditUplinkPanel shape) ↔ the API body.
export function draftToUplinkBody(draft) {
  return {
    source: { deviceId: draft.sourceDeviceId, portId: draft.sourcePort || null },
    dest: { deviceId: draft.destDeviceId, portId: draft.destPort || null },
    media: draft.media,
    speed: draft.speed,
    sourceSfpCode: draft.media === 'os2' || draft.media === 'om4' ? draft.sourceSfp || null : null,
    destSfpCode: draft.media === 'os2' || draft.media === 'om4' ? draft.destSfp || null : null,
    viaPatchPanel: Boolean(draft.usePatchPanel),
  }
}
export function uplinkToDraft(conn) {
  return {
    sourceDeviceId: conn.source.deviceId,
    sourcePort: conn.source.portId,
    destDeviceId: conn.dest.deviceId,
    destPort: conn.dest.portId,
    media: conn.media,
    speed: conn.speed,
    sourceSfp: conn.sourceSfpCode,
    destSfp: conn.destSfpCode,
    usePatchPanel: conn.viaPatchPanel,
  }
}

// The library (server roles) as prototype HldObjectLibrary categories, every
// role enabled; Passive keeps the prototype's room/rack references.
const GROUPS = [
  { key: 'active_networking', label: 'Active networking' },
  { key: 'server', label: 'Server' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'external', label: 'External' },
]
export function libraryCategories(roles) {
  return GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    items: roles
      .filter((r) => r.group === g.key)
      .map((r) => ({ id: `hld-${r.role}`, label: r.code ? `${r.label} (${r.code})` : r.label, role: r.role, icon: r.icon, model: r.defaultModel })),
  })).filter((g) => g.items.length)
}

// Per-uplink status for the canvas edges, from the server's findings.
export function connectionStatus(findings) {
  const out = {}
  for (const f of findings ?? []) {
    if (f.objectType !== 'connection') continue
    const entry = (out[f.objectId] ??= { blocked: false, warning: false })
    if (f.severity === 'critical') entry.blocked = true
    if (f.severity === 'warning') entry.warning = true
  }
  return out
}
