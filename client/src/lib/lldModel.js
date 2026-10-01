// Pure LLD derivations (brief v2.3 §5.4, §6.2, §6.3; v2.2 §3.7). Everything
// here is DESIGN data only: Installed length, link test results, serial /
// MAC and installation status are Deployment data and are never produced
// by this module — callers show DEPLOYMENT_PLACEHOLDER instead.
import { computeSuggestedLength, determineSituation } from './cableLength.js'
import { findRoute } from './pathway.js'
import { portKindFor } from './validation.js'

export const DEPLOYMENT_PLACEHOLDER = 'To be populated at deployment'

export const MEDIA_LABEL = { cat6a: 'Cat6A', om4: 'OM4 MM', os2: 'OS2 SM', dac: 'DAC', stack: 'Stack' }

// Walking "upstream" means heading towards the WAN circuit.
const ROLE_RANK = { 'wan-circuit': 0, fusion: 1, border: 2, distribution: 3, edge: 4, ap: 5 }
const rankOf = (entity) => ROLE_RANK[entity?.role] ?? 99

const FIXED_LABEL = { border: 'Border', fusion: 'Fusion', 'wan-circuit': 'SD-WAN CPE' }
const NUMBERED_LABEL = { edge: 'Edge', distribution: 'Distribution', ap: 'AP' }

// "Edge 01" style names as shown in the renders; the hostname stays the
// identifier. Numbering follows the order devices were created in.
export function deviceDisplayLabel(device, devices) {
  const sameRole = devices.filter((d) => d.role === device.role)
  const fixed = FIXED_LABEL[device.role]
  if (fixed && sameRole.length === 1) return fixed
  const base = fixed ?? NUMBERED_LABEL[device.role] ?? device.role
  return `${base} ${String(sameRole.findIndex((d) => d.id === device.id) + 1).padStart(2, '0')}`
}

export function endLabel(entity, port) {
  if (!entity) return '—'
  return entity.type === 'patchpanel' ? `${entity.label} / Port ${port}` : `${entity.label} ${port}`
}

export function paginate(items, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * pageSize
  const slice = items.slice(start, start + pageSize)
  return {
    items: slice,
    page: current,
    pageCount,
    total: items.length,
    from: items.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  }
}

// --- Cable length & pathway (§6.3) ---------------------------------------

// Cross-room links ride a surveyed pathway. Anything else — no route
// recorded, a route still marked Estimated, or a surveyed route without a
// distance — is an Estimated pathway and raises "Cable pathway not
// surveyed" (§6.3).
export function resolvePathway(source, dest, routes) {
  const situation = determineSituation({
    sourceRackId: source.rackId,
    destRackId: dest.rackId,
    sourceRoomId: source.roomId,
    destRoomId: dest.roomId,
  })
  if (situation !== 'cross-room') return { situation, route: null, estimated: false, reason: null }

  const route = source.roomId && dest.roomId ? findRoute(source.roomId, dest.roomId, routes) : null
  if (!route) return { situation, route: null, estimated: true, reason: 'No pathway recorded between these rooms' }
  if (route.routeStatus !== 'surveyed') return { situation, route, estimated: true, reason: 'Pathway route is marked Estimated' }
  if (route.distanceM == null) return { situation, route, estimated: true, reason: 'Surveyed pathway has no distance' }
  return { situation, route, estimated: false, reason: null }
}

export function cableLengthInfo({ connection, source, dest, routes }) {
  const pathway = resolvePathway(source, dest, routes)
  const { situation } = pathway

  const placementPending =
    (situation === 'same-rack' && (source.ru == null || dest.ru == null)) ||
    (situation === 'same-room' && (source.rackPosition == null || dest.rackPosition == null))

  let suggested = null
  let rawMeters = null
  let customLengthRequired = false
  if (!placementPending) {
    // An Estimated route that still carries a distance is the architect's
    // estimate, and feeds the formula the same way a surveyed one does.
    const distance = situation === 'cross-room' ? (pathway.route?.distanceM ?? null) : undefined
    const result = computeSuggestedLength({
      source: { rackId: source.rackId, roomId: source.roomId, ru: source.ru, rackPosition: source.rackPosition },
      dest: { rackId: dest.rackId, roomId: dest.roomId, ru: dest.ru, rackPosition: dest.rackPosition, surveyedPathwayLength: distance },
      media: connection.media,
    })
    suggested = result.suggested
    rawMeters = result.rawMeters
    customLengthRequired = result.customLengthRequired
  }

  const engineerSelected = connection.lengths?.engineerSelected ?? null
  return {
    situation,
    estimated: pathway.estimated,
    estimateReason: pathway.reason,
    placementPending,
    rawMeters,
    suggested,
    customLengthRequired,
    engineerSelected,
    // Engineer Selected defaults to Suggested and is what the BOM uses.
    effective: engineerSelected ?? suggested,
    installed: null, // Deployment data
  }
}

// --- Connection rows ------------------------------------------------------

function hopsOf(connection, entityById) {
  return (connection.hops ?? []).map((hop) => ({
    ...hop,
    label: entityById[hop.deviceId]?.label ?? hop.patchPanel ?? hop.deviceId ?? 'Hop',
  }))
}

export function buildConnectionRow(connection, entityById, routes) {
  const source = entityById[connection.source.deviceId]
  const dest = entityById[connection.dest.deviceId]
  if (!source || !dest) return null

  const panelEnd = [
    { entity: source, port: connection.source.port },
    { entity: dest, port: connection.dest.port },
  ].find((end) => end.entity.type === 'patchpanel')

  return {
    id: connection.id,
    cableId: connection.cableId ?? null,
    source: { entityId: source.id, entity: source, port: connection.source.port, label: endLabel(source, connection.source.port) },
    dest: { entityId: dest.id, entity: dest, port: connection.dest.port, label: endLabel(dest, connection.dest.port) },
    hops: hopsOf(connection, entityById),
    // Horizontal runs from a patch panel to outlets / AP drops stay TBD in
    // LLD and are captured at deployment (§5.4).
    horizontalTbd: Boolean(panelEnd),
    patchPanelPort: panelEnd ? `${panelEnd.entity.label} / ${panelEnd.port}` : null,
    media: connection.media,
    mediaLabel: MEDIA_LABEL[connection.media] ?? connection.media,
    speed: connection.speed,
    sourceSfp: connection.sourceSfp ?? null,
    destSfp: connection.destSfp ?? null,
    length: cableLengthInfo({ connection, source, dest, routes }),
    // Connection status is design-phase only here (§4.4: Designed → …).
    statusLabel: connection.cableId ? 'Designed' : 'Cable ID pending',
  }
}

// Same device+port used by more than one connection.
export function findPortConflicts(connections) {
  const seen = new Map()
  const conflicts = []
  for (const conn of connections) {
    for (const end of [conn.source, conn.dest]) {
      if (end.port == null) continue
      const key = `${end.deviceId}|${end.port}`
      if (seen.has(key) && seen.get(key) !== conn.id) conflicts.push({ deviceId: end.deviceId, port: end.port })
      seen.set(key, conn.id)
    }
  }
  return conflicts
}

export function findDuplicateCableIds(cableIds) {
  const seen = new Set()
  const dupes = new Set()
  for (const id of cableIds) {
    if (!id) continue
    const key = id.toLowerCase()
    if (seen.has(key)) dupes.add(key)
    seen.add(key)
  }
  return [...dupes]
}

// --- Upstream / downstream (Connectivity tab) --------------------------

// Follows connections towards the WAN circuit: Edge → Border → Fusion →
// SD-WAN CPE. Each step picks the nearest lower-ranked neighbour.
export function upstreamPath(deviceId, entityById, rows) {
  const steps = []
  const visited = new Set()
  let current = entityById[deviceId]
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    let best = null
    for (const row of rows) {
      let near
      let far
      if (row.source.entityId === current.id) [near, far] = [row.source, row.dest]
      else if (row.dest.entityId === current.id) [near, far] = [row.dest, row.source]
      else continue
      if (far.entity.type !== 'device' || rankOf(far.entity) >= rankOf(current)) continue
      if (!best || rankOf(far.entity) > rankOf(best.far.entity)) best = { row, near, far }
    }
    if (!best) break
    steps.push({ from: current, fromPort: best.near.port, to: best.far.entity, toPort: best.far.port, row: best.row })
    current = best.far.entity
  }
  return steps
}

export function downstreamLinks(deviceId, entityById, rows) {
  const device = entityById[deviceId]
  return rows
    .filter((row) => row.source.entityId === deviceId && row.dest.entity.type === 'device' && rankOf(row.dest.entity) > rankOf(device))
    .sort((a, b) => portNumber(a.source.port) - portNumber(b.source.port))
}

function portNumber(port) {
  const n = String(port).match(/(\d+)\s*$/)
  return n ? Number(n[1]) : 0
}

// --- Port schedule ---------------------------------------------------------

// Mock until the logical topology is linked to ports (the render's VLAN
// and PoE columns); deterministic so it never flickers between renders.
const MOCK_ACCESS_VLAN = '20'
const MOCK_ACCESS_POE = 'PoE+ 30W'

function otherEnd(row, entityId) {
  return row.source.entityId === entityId ? row.dest : row.source
}

function portRow({ portId, group, kind, hit, entity }) {
  const base = { port: portId, group, type: kind === 'sfp' ? 'SFP+' : 'RJ45' }
  if (!hit) {
    return { ...base, status: 'Available', destination: '—', patchPanelPort: '—', cableId: null, media: '—', speed: '—', vlan: '—', poe: '—', connectionId: null }
  }
  const far = otherEnd(hit, entity.id)
  const toPanel = far.entity.type === 'patchpanel'
  const hopsText = hit.hops.length > 0 ? hit.hops.map((h) => h.label).join(' → ') : null
  return {
    ...base,
    status: 'Designed',
    destination: toPanel ? 'Horizontal outlet — TBD at deployment' : far.label,
    patchPanelPort: toPanel ? hit.patchPanelPort : (hopsText ?? 'Direct'),
    cableId: hit.cableId,
    media: hit.mediaLabel,
    speed: hit.speed,
    vlan: group === 'access' && entity.role === 'edge' ? MOCK_ACCESS_VLAN : 'Trunk',
    poe: group === 'access' && entity.role === 'edge' && hit.media === 'cat6a' ? MOCK_ACCESS_POE : '—',
    connectionId: hit.id,
  }
}

// One entry per port group. Access ports are numbered exactly 1..N and the
// uplink-module ports are a separate group — never merged, never beyond the
// device's real count (§6.5, §7.6). A connected port that the device's
// port map doesn't contain (e.g. a fixed WAN/management port) gets its own
// "Fixed ports" group instead of being dropped from the schedule.
export function buildPortGroups(entity, portMap, rows) {
  const byPort = new Map()
  for (const row of rows) {
    if (row.source.entityId === entity.id) byPort.set(row.source.port, row)
    if (row.dest.entityId === entity.id) byPort.set(row.dest.port, row)
  }

  const isEdge = entity.role === 'edge'
  const access = [...portMap.rows.flat()].sort((a, b) => a.n - b.n)
  const modules = [...portMap.modulePorts].sort((a, b) => a.n - b.n)
  const known = new Set([...access, ...modules].map((p) => p.id))

  const toRows = (ports, group) =>
    ports.map((p) => portRow({ portId: p.id, group, kind: portKindFor(p.id), hit: byPort.get(p.id), entity }))

  const groups = []
  if (access.length > 0) {
    groups.push({
      id: 'access',
      label: isEdge ? `Access ports (1–${access.length})` : `Ports (1–${access.length})`,
      rows: toRows(access, 'access'),
    })
  }
  if (modules.length > 0) groups.push({ id: 'module', label: `Uplink module ports (${modules.length})`, rows: toRows(modules, 'module') })

  const fixed = [...byPort.keys()].filter((p) => p != null && !known.has(p))
  if (fixed.length > 0) {
    groups.push({
      id: 'fixed',
      label: 'Fixed ports',
      rows: fixed.map((portId) => portRow({ portId, group: 'fixed', kind: portKindFor(portId), hit: byPort.get(portId), entity })),
    })
  }
  return groups
}

// One flat row per port across every device in the building, for the Port
// Schedule tab (v2.2 §3.7 Tab 3) — unlike buildPortGroups (one device,
// grouped for the Connectivity side panel), this is the whole-building,
// filterable table.
export function buildPortScheduleRows(portSchedule) {
  const out = []
  for (const { device, groups } of portSchedule) {
    for (const group of groups) {
      for (const row of group.rows) {
        out.push({
          ...row,
          rowKey: `${device.id}:${row.port}`,
          deviceId: device.id,
          deviceLabel: device.label,
          rackCode: device.rackCode,
          roomCode: device.roomCode,
          floorName: device.floorName,
        })
      }
    }
  }
  return out
}

export function filterPortScheduleRows(rows, filters) {
  return rows.filter((r) => {
    if (filters.deviceId && r.deviceId !== filters.deviceId) return false
    if (filters.roomCode && r.roomCode !== filters.roomCode) return false
    if (filters.floorName && r.floorName !== filters.floorName) return false
    if (filters.status && r.status !== filters.status) return false
    if (filters.vlan && r.vlan !== filters.vlan) return false
    return true
  })
}
