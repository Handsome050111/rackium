import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'
import { MEDIA_LABEL, endLabel, buildPortGroups } from '@rackium/shared/lldModel.js'
import { portKey, portOptions, suggestPort } from '@rackium/shared/lldDesign.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}/lld`
const none = (value) => Promise.resolve(value)
const branchQuery = (branchId) => (branchId ? `?branchId=${branchId}` : '')

// Real mode only (M4b). Mock mode's LLD keeps using api/lldDesign.js and
// api/lld.js. Every design write carries the revision the screen loaded; a
// stale one comes back as a 409 `stale_revision` naming who changed it.
export const lldApi = {
  view: (o, p, buildingId, branchId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}${branchQuery(branchId)}`) : none(null)),
  validate: (o, p, buildingId, branchId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/validation${branchQuery(branchId)}`) : none({ findings: [], summary: { critical: 0, warning: 0, info: 0, blocksSubmit: false } })),
  reconciliation: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/buildings/${buildingId}/reconciliation`) : none(null)),
  start: (o, p, body) => (real ? apiRequest(`${base(o, p)}/start`, { method: 'POST', body }) : none(null)),
  rebase: (o, p, body) => (real ? apiRequest(`${base(o, p)}/rebase`, { method: 'POST', body }) : none(null)),
  copyFromHld: (o, p, body) => (real ? apiRequest(`${base(o, p)}/copy-from-hld`, { method: 'POST', body }) : none(null)),
  addDevice: (o, p, body) => (real ? apiRequest(`${base(o, p)}/devices`, { method: 'POST', body }) : none(null)),
  place: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/devices/${id}/placement`, { method: 'PUT', body }) : none(null)),
  deleteDevice: (o, p, id, baseRevision) => (real ? apiRequest(`${base(o, p)}/devices/${id}?baseRevision=${baseRevision}`, { method: 'DELETE' }) : none(null)),
  createConnection: (o, p, body) => (real ? apiRequest(`${base(o, p)}/connections`, { method: 'POST', body }) : none(null)),
  updateConnection: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/connections/${id}`, { method: 'PATCH', body }) : none(null)),
  deleteConnection: (o, p, id, baseRevision) => (real ? apiRequest(`${base(o, p)}/connections/${id}?baseRevision=${baseRevision}`, { method: 'DELETE' }) : none(null)),
  renamePreview: (o, p, body) => (real ? apiRequest(`${base(o, p)}/rename/preview`, { method: 'POST', body }) : none({ rows: [] })),
  rename: (o, p, body) => (real ? apiRequest(`${base(o, p)}/rename`, { method: 'POST', body }) : none(null)),
  saveVersion: (o, p, body) => (real ? apiRequest(`${base(o, p)}/versions`, { method: 'POST', body }) : none(null)),
  diff: (o, p, { buildingId, from, to }) => (real ? apiRequest(`${base(o, p)}/versions/diff?buildingId=${buildingId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) : none(null)),
  restore: (o, p, versionId, body) => (real ? apiRequest(`${base(o, p)}/versions/${versionId}/restore`, { method: 'POST', body }) : none(null)),
  createBranch: (o, p, body) => (real ? apiRequest(`${base(o, p)}/branches`, { method: 'POST', body }) : none(null)),
  promoteBranch: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/branches/${id}/promote`, { method: 'POST', body }) : none(null)),
  discardBranch: (o, p, id) => (real ? apiRequest(`${base(o, p)}/branches/${id}/discard`, { method: 'POST', body: {} }) : none(null)),
  submit: (o, p, body) => (real ? apiRequest(`${base(o, p)}/submit`, { method: 'POST', body }) : none(null)),
  decide: (o, p, body) => (real ? apiRequest(`${base(o, p)}/decision`, { method: 'POST', body }) : none(null)),
}

// --- Pure helpers (unit-tested) ------------------------------------------------

// A device's catalogue ports as the prototype PortFace / port-schedule map:
// access ports in two zig-zag rows (odd on top) when there are many, module
// ports apart (brief §6.5: never merged).
export function portMapOf(device) {
  const ports = (device?.ports ?? []).map((p) => ({ id: p.id, label: p.id, n: p.n, type: p.type }))
  const modulePorts = ports.filter((p, i) => device.ports[i].role === 'module')
  const access = ports.filter((p, i) => device.ports[i].role !== 'module')
  const rows = access.length > 24 ? [access.filter((_, i) => i % 2 === 0), access.filter((_, i) => i % 2 === 1)] : [access]
  return { rows: access.length ? rows : [], modulePorts }
}

// The occupied port keys of a device in this design (panel keys carry #rear / #front).
export const occupiedKeysOf = (device, exceptConnectionId = null) => new Set((device?.occupied ?? []).filter((o) => o.connectionId !== exceptConnectionId).map((o) => o.portKey))

// Port choices for one end or hop side, with the system's suggestion (never
// applied by itself, brief §5.4).
export function portChoices(device, { media, side = null, exceptConnectionId = null }) {
  if (!device) return { options: [], suggestion: null }
  const options = portOptions(device.ports ?? [], { media, occupiedKeys: occupiedKeysOf(device, exceptConnectionId), side: side ?? (device.isPanel ? 'front' : null) })
  return { options, suggestion: suggestPort(options) }
}
export const isPortFree = (device, portId, side = null, exceptConnectionId = null) => !occupiedKeysOf(device, exceptConnectionId).has(portKey(portId, side ?? (device?.isPanel ? 'front' : null)))

// The server's LLD view as the prototype LLD tabs' context (api/lldDesign.js
// getLldContext shape), so the real screen reuses Connectivity, Rack
// Elevations, Port Schedule and Cable Schedule as they are.
export function toLldContext(view, validation = null) {
  const floorById = Object.fromEntries(view.floors.map((f) => [f.id, f]))
  const roomById = Object.fromEntries(view.rooms.map((r) => [r.id, r]))
  const rackById = Object.fromEntries(view.racks.map((r) => [r.id, r]))
  const rackPosition = {}
  for (const room of view.rooms) view.racks.filter((k) => k.roomId === room.id).forEach((k, i) => (rackPosition[k.id] = i + 1))
  const placeOf = (d) => {
    const rack = d.rackId ? rackById[d.rackId] : null
    const room = roomById[rack?.roomId ?? d.roomId]
    return { rackId: rack?.id ?? null, rackCode: rack?.code ?? null, rackPosition: rack ? rackPosition[rack.id] : null, roomId: room?.id ?? null, roomCode: room?.code ?? null, floorName: room ? floorById[room.floorId]?.name ?? null : null }
  }
  const entities = view.devices.map((d) => ({
    id: d.id,
    type: d.isPanel ? 'patchpanel' : 'device',
    role: d.isPanel ? 'patchpanel' : d.role,
    label: d.label,
    hostname: d.hostname ?? d.label,
    model: d.model,
    status: d.inDesign ? 'planned' : 'existing',
    ru: d.ru,
    inDesign: d.inDesign,
    ...placeOf(d),
  }))
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]))

  const rows = view.connections
    .map((c) => {
      const source = entityById[c.source.deviceId]
      const dest = entityById[c.dest.deviceId]
      if (!source || !dest) return null
      const panelEnd = [
        { entity: source, port: c.source.portId },
        { entity: dest, port: c.dest.portId },
      ].find((end) => end.entity.type === 'patchpanel')
      return {
        id: c.id,
        cableId: c.cableId,
        source: { entityId: source.id, entity: source, port: c.source.portId, label: endLabel(source, c.source.portId) },
        dest: { entityId: dest.id, entity: dest, port: c.dest.portId, label: endLabel(dest, c.dest.portId) },
        hops: c.hops.map((h) => ({ ...h, deviceId: h.patchPanelId, cableId: h.segmentCableId, label: `${entityById[h.patchPanelId]?.label ?? 'Panel'} ${h.inPort}→${h.outPort}` })),
        horizontalTbd: Boolean(panelEnd),
        patchPanelPort: panelEnd ? `${panelEnd.entity.label} / ${panelEnd.port}` : null,
        media: c.media,
        mediaLabel: MEDIA_LABEL[c.media] ?? c.media,
        speed: c.speed,
        sourceSfp: c.sourceSfpCode,
        destSfp: c.destSfpCode,
        length: {
          estimated: c.length.lengthEstimated,
          estimateReason: c.length.estimateReason,
          placementPending: c.length.placementPending,
          rawMeters: c.length.lengthM,
          suggested: c.lengths.suggestedM,
          customLengthRequired: c.length.customLengthRequired,
          engineerSelected: c.lengths.engineerSelectedM,
          effective: c.lengths.effectiveM,
          installed: c.lengths.installedM,
        },
        statusLabel: c.cableId ? 'Designed' : 'Cable ID pending',
      }
    })
    .filter(Boolean)

  const portSchedule = view.devices
    .filter((d) => d.inDesign && !d.isPanel && d.role !== 'ap' && d.ports.length)
    .map((d) => ({ device: entityById[d.id], groups: buildPortGroups(entityById[d.id], portMapOf(d), rows) }))
    .filter((entry) => entry.groups.length > 0)

  const rackElevations = view.racks.map((rack) => {
    const room = roomById[rack.roomId]
    return { rack: { id: rack.id, code: rack.code, heightU: rack.heightU }, room: { id: room?.id, code: room?.code }, floorName: room ? floorById[room.floorId]?.name : null, placements: rack.placements, freeRuByFace: rack.freeRuByFace }
  })

  const connectionFindings = {}
  for (const f of validation?.findings ?? []) {
    if (f.objectType !== 'connection') continue
    const entry = (connectionFindings[f.objectId] ??= { blocked: false, warning: false })
    if (f.severity === 'critical') entry.blocked = true
    if (f.severity === 'warning') entry.warning = true
  }
  const topologyDevices = view.devices.filter((d) => d.inDesign && !d.isPanel).map((d) => ({ ...d, position: null }))
  const summary = validation?.summary ?? null
  const cableIdFindings = (validation?.findings ?? []).filter((f) => f.rule === 'VAL-013').length

  return {
    entities,
    entityById,
    rows,
    portSchedule,
    rackElevations,
    topology: { floors: view.floors, rooms: view.rooms, devices: topologyDevices, connections: view.connections, connectionFindings },
    // NexAI analyser: the approved HLD's device count against the LLD's own (no panels, no surveyed gear).
    hldDeviceCount: view.hld.deviceCount ?? null,
    lldDeviceCount: view.devices.filter((d) => d.inDesign && !d.isPanel).length,
    distributionRequired: view.devices.some((d) => d.inDesign && d.role === 'distribution'),
    siteSize: null,
    hld: {
      status: view.hld.state ?? 'not_started',
      currentVersion: view.hld.latestApprovedNumber,
      basedOnVersion: view.hld.basedOnNumber,
      stale: view.hld.changed,
      changesSince: [],
    },
    checks: {
      portConflicts: 0, // impossible: the occupancy registry refuses a double booking
      duplicateCableIds: cableIdFindings,
      missingCableIds: rows.filter((r) => !r.cableId).length,
    },
    summary,
  }
}

// One-line text for a diff/reconciliation field change.
export function fieldChangeText(f) {
  const v = (x) => (x == null || x === '' ? '—' : String(x))
  return `${f.field}: ${v(f.before)} → ${v(f.after)}`
}
