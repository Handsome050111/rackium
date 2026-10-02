// CMDB (brief v2.3 §5.8, Step 8) — the as-built record, built from
// deployment state, never from design intent. Reuses LLD's already-resolved
// location data (room/rack/RU/floor) instead of re-deriving it.
import { getLldContext } from './lldDesign.js'
import { getConnections, findDevice, updateDevice } from './networkStore.js'
import { updatePhaseStatus } from './buildings.js'
import { getDevicePortMap } from '../lib/portMap.js'
import { isCmdbDevice, acceptanceLabel, computeReconciliation, buildCiRows, buildCmdbPortRows, buildPortTrace, computeCmdbPhaseStatus } from '../lib/cmdbModel.js'
import { computeDguvStatus } from '../lib/dguv.js'
import { DEVICE_CATALOGUE } from '../mock/deviceCatalogue.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const changeLogByBuilding = {} // buildingId -> [{id, ciId, field, oldValue, newValue, changedBy, changeType, at}]
let changeIdCounter = 1

function changeLogFor(buildingId) {
  return (changeLogByBuilding[buildingId] ??= [])
}

function isMainsPowered(model) {
  return (DEVICE_CATALOGUE[model]?.psuCount ?? 0) > 0
}

async function placedEntities(buildingId) {
  const lldContext = await getLldContext(buildingId)
  return lldContext.entities.filter((e) => e.type === 'device')
}

export async function getCmdbContext(buildingId) {
  const entities = await placedEntities(buildingId)
  const merged = entities.map((e) => {
    const raw = findDevice(e.id)
    return { ...e, installation: raw?.installation ?? null }
  })

  const cmdbEntities = merged.filter((e) => isCmdbDevice(e))
  const rows = buildCiRows(
    cmdbEntities,
    (d) => ({ building: buildingId.toUpperCase(), floorName: d.floorName, roomCode: d.roomCode, rackCode: d.rackCode, ru: d.ru })
  ).map((row, i) => ({
    ...row,
    dguv: computeDguvStatus({ lastInspectionDate: cmdbEntities[i].installation?.dguvDate, mainsPowered: isMainsPowered(cmdbEntities[i].model) }),
  }))

  const connections = getConnections().filter((c) => entities.some((e) => e.id === c.source.deviceId) || entities.some((e) => e.id === c.dest.deviceId))
  const allDeviceCount = entities.filter((e) => e.role !== 'wan-circuit').length
  const reconciliation = computeReconciliation({
    hldDeviceCount: allDeviceCount,
    cmdbDevices: rows,
    cableIds: connections.map((c) => c.cableId),
  })

  const kpis = {
    totalCis: rows.length,
    networkSwitches: rows.filter((r) => ['fusion', 'border', 'distribution', 'edge'].includes(r.role)).length,
    accessPoints: rows.filter((r) => r.role === 'ap').length,
    accepted: rows.filter((r) => r.acceptance === 'Accepted').length,
    awaitingAcceptance: rows.filter((r) => r.acceptance === 'Awaiting').length,
    complianceActions: rows.filter((r) => r.dguv && (r.dguv.status === 'overdue' || r.dguv.status === 'expiring')).length,
  }

  // Opportunistic push on read, same pattern/reasoning as Deployment's
  // phase-status push in api/deploymentDesign.js.
  updatePhaseStatus(buildingId, 'cmdb', computeCmdbPhaseStatus(rows))

  return resolveAfter({ rows, kpis, reconciliation, changeLog: changeLogFor(buildingId).slice(-10).reverse() })
}

export async function getCiDetail(buildingId, deviceId) {
  const entities = await placedEntities(buildingId)
  const entity = entities.find((e) => e.id === deviceId)
  if (!entity) return null
  const raw = findDevice(deviceId)
  const connections = getConnections().filter((c) => c.source.deviceId === deviceId || c.dest.deviceId === deviceId)
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]))

  return resolveAfter({
    entity: { ...entity, installation: raw?.installation ?? null },
    connections: connections.map((c) => ({ connection: c, trace: buildPortTrace(c, entityById) })),
    dguv: computeDguvStatus({ lastInspectionDate: raw?.installation?.dguvDate, mainsPowered: isMainsPowered(entity.model) }),
    acceptance: acceptanceLabel(entity.status),
    changeLog: changeLogFor(buildingId).filter((c) => c.ciId === deviceId),
  })
}

export async function getPortConnectivity(buildingId, deviceId) {
  const [entities, lldContext] = await Promise.all([placedEntities(buildingId), getLldContext(buildingId)])
  const entity = entities.find((e) => e.id === deviceId)
  if (!entity) return null
  const raw = findDevice(deviceId)
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]))
  const connections = getConnections().filter((c) => c.source.deviceId === deviceId || c.dest.deviceId === deviceId)
  const portRows = buildCmdbPortRows(entity, getDevicePortMap(raw), connections, entityById)
  const rackElevation = lldContext.rackElevations.find((r) => r.rack.id === raw.rackId)

  return resolveAfter({
    entity,
    access: portRows.access,
    modules: portRows.modules,
    entityById,
    rack: rackElevation?.rack ?? null,
    placements: rackElevation?.placements ?? [],
    freeRuByFace: rackElevation?.freeRuByFace ?? null,
  })
}

// Brief D15: Architect/PM operational edits are flagged "operational
// change" in the audit trail (vs "design intent", which Deployment never
// overwrites — see api/deploymentDesign.js).
export async function recordOperationalChange(buildingId, deviceId, field, newValue, role) {
  const device = findDevice(deviceId)
  if (!device) return resolveAfter({ ok: false, error: 'Device not found' })
  const oldValue = device.installation?.[field] ?? null
  updateDevice(deviceId, { installation: { ...device.installation, [field]: newValue } })
  changeLogFor(buildingId).push({
    id: `chg-${changeIdCounter++}`,
    ciId: deviceId,
    field,
    oldValue,
    newValue,
    changeType: 'operational change',
    changedBy: role,
    at: new Date().toISOString(),
  })
  return resolveAfter({ ok: true })
}
