// LLD screen data (Step 6). Reads the shared network store and the Step 4
// survey routes; writes only the two things LLD owns on a connection: its
// Cable ID and the Engineer Selected length. Link tests, installed
// serial/MAC and installed length are Deployment data and never touched.
import { getBuildingSiteStructure, getAllConnections } from './siteStructure.js'
import { getDevices, getPatchPanels, getConnections, upsertConnection } from './networkStore.js'
import { getHldContext } from './hld.js'
import { getPhaseCards } from './buildings.js'
import { getHldVersion, getHldChangesSince } from './hldVersion.js'
import { resolveEntity } from './lld.js'
import { resolveAfter } from './site.js'
import { getDevicePortMap } from '../lib/portMap.js'
import { computeFreeRU } from '../lib/rackValidation.js'
import { suggestNextCableId, isCableIdUnique, isCableIdValid } from '../lib/cableId.js'
import { getSiteProfile } from '../mock/siteProfile.js'
import {
  buildConnectionRow,
  buildPortGroups,
  deviceDisplayLabel,
  findDuplicateCableIds,
  findPortConflicts,
} from '../lib/lldModel.js'
import { registerStore, replaceObjectContents } from '../lib/persistentStore.js'

// "LLD starts" the first time it is opened for a building; from then on it
// remembers the HLD version it was designed against (§5.4).
const baselines = {} // buildingId -> { hldVersion, startedAt }

registerStore('lldDesign', {
  getSnapshot: () => baselines,
  restoreSnapshot: (data) => replaceObjectContents(baselines, data),
})

function baselineFor(buildingId) {
  baselines[buildingId] ??= { hldVersion: getHldVersion(), startedAt: new Date().toISOString() }
  return baselines[buildingId]
}

// Project-wide: connection Cable IDs and hop segment IDs share one
// namespace (§6.1).
function allProjectCableIds() {
  return getConnections().flatMap((c) => [c.cableId, ...(c.hops ?? []).map((h) => h.cableId)])
}

function idsExcluding(connectionId) {
  const own = getConnections().find((c) => c.id === connectionId)
  return { ids: allProjectCableIds(), own: own?.cableId ?? null }
}

export async function getLldContext(buildingId) {
  const [{ buildings }, routes, hldContext, phaseCards] = await Promise.all([
    getBuildingSiteStructure(buildingId),
    getAllConnections(),
    getHldContext(buildingId),
    getPhaseCards(buildingId),
  ])
  const group = buildings[0]
  const floors = group.floors.map(({ rooms: _rooms, ...floor }) => floor)
  const rooms = group.floors.flatMap((f) => f.rooms.map(({ racks: _racks, ...room }) => ({ ...room, floorId: f.id })))
  const racks = group.floors.flatMap((f) => f.rooms.flatMap((r) => r.racks.map((rack, i) => ({ ...rack, rackPosition: i + 1 }))))
  const roomById = Object.fromEntries(rooms.map((r) => [r.id, r]))
  const rackById = Object.fromEntries(racks.map((r) => [r.id, r]))
  const floorById = Object.fromEntries(floors.map((f) => [f.id, f]))

  const placeOf = (rackId, roomId) => {
    const rack = rackId ? rackById[rackId] : null
    const room = roomById[rack?.roomId ?? roomId]
    return {
      rackId: rack?.id ?? null,
      rackCode: rack?.code ?? null,
      rackPosition: rack?.rackPosition ?? null,
      roomId: room?.id ?? null,
      roomCode: room?.code ?? null,
      floorName: room ? floorById[room.floorId]?.name : null,
    }
  }

  const buildingDevices = getDevices().filter((d) => placeOf(d.rackId, d.roomId).roomId)
  const devices = buildingDevices.map((d) => ({
    id: d.id,
    type: 'device',
    role: d.role,
    label: deviceDisplayLabel(d, buildingDevices),
    hostname: d.hostname,
    model: d.model,
    status: d.status,
    ru: d.ru ?? null,
    ...placeOf(d.rackId, d.roomId),
  }))
  const panels = getPatchPanels()
    .filter((p) => rackById[p.rackId])
    .map((p) => ({
      id: p.id,
      type: 'patchpanel',
      role: 'patchpanel',
      label: p.code,
      hostname: p.code,
      model: p.type === 'copper' ? 'Cat6A · 24 port' : 'Fibre · 24 port',
      ru: p.ru,
      ...placeOf(p.rackId, null),
    }))
  const entities = [...devices, ...panels]
  const entityById = Object.fromEntries(entities.map((e) => [e.id, e]))

  const rows = getConnections()
    .map((c) => buildConnectionRow(c, entityById, routes))
    .filter(Boolean)

  const portSchedule = buildingDevices
    .filter((d) => d.role !== 'ap')
    .map((d) => ({
      device: entityById[d.id],
      groups: buildPortGroups(entityById[d.id], getDevicePortMap(d), rows),
    }))
    .filter((entry) => entry.groups.length > 0)

  const rackElevations = racks.map((rack) => {
    const room = roomById[rack.roomId]
    const placements = entities.filter((e) => e.rackId === rack.id).map((e) => resolveEntity(e.id))
    return {
      rack: { id: rack.id, code: rack.code, heightU: rack.heightU },
      room: { id: room.id, code: room.code },
      floorName: floorById[room.floorId]?.name,
      placements,
      freeRuByFace: { front: computeFreeRU(placements, rack.heightU, 'front'), rear: computeFreeRU(placements, rack.heightU, 'rear') },
    }
  })

  const baseline = baselineFor(buildingId)
  const currentVersion = getHldVersion()
  const cableIds = allProjectCableIds()
  const buildingConnections = getConnections().filter((c) => entityById[c.source.deviceId] && entityById[c.dest.deviceId])

  return resolveAfter({
    entities,
    entityById,
    topology: hldContext,
    distributionRequired: getSiteProfile(buildingId).size !== 'S',
    siteSize: getSiteProfile(buildingId).size,
    rows,
    portSchedule,
    rackElevations,
    hld: {
      status: phaseCards.find((c) => c.id === 'hld')?.status ?? 'not_started',
      currentVersion,
      basedOnVersion: baseline.hldVersion,
      stale: currentVersion > baseline.hldVersion,
      changesSince: getHldChangesSince(baseline.hldVersion),
    },
    checks: {
      portConflicts: findPortConflicts(buildingConnections).length,
      duplicateCableIds: findDuplicateCableIds(cableIds).length,
      missingCableIds: rows.filter((r) => !r.cableId).length,
    },
  })
}

export async function rebaseLldToCurrentHld(buildingId) {
  baselines[buildingId] = { hldVersion: getHldVersion(), startedAt: new Date().toISOString() }
  return resolveAfter({ ...baselines[buildingId] })
}

export function suggestCableIdNow(extraIds = []) {
  return suggestNextCableId([...allProjectCableIds(), ...extraIds])
}

// Returns { ok: true } or { ok: false, error }.
export async function assignCableId(connectionId, rawId) {
  const conn = getConnections().find((c) => c.id === connectionId)
  if (!conn) return resolveAfter({ ok: false, error: 'Connection no longer exists' })
  const id = rawId.trim()
  if (!isCableIdValid(id)) return resolveAfter({ ok: false, error: 'Cable ID must be 1–32 characters' })
  const { ids, own } = idsExcluding(connectionId)
  if (!isCableIdUnique(id, ids, own)) return resolveAfter({ ok: false, error: `Cable ID "${id}" is already used in this project` })
  upsertConnection({ ...conn, cableId: id })
  return resolveAfter({ ok: true })
}

export async function assignMissingCableIds(buildingId) {
  const { rows } = await getLldContext(buildingId)
  let assigned = 0
  for (const row of rows.filter((r) => !r.cableId)) {
    const conn = getConnections().find((c) => c.id === row.id)
    upsertConnection({ ...conn, cableId: suggestCableIdNow() })
    assigned += 1
  }
  return resolveAfter({ assigned })
}

// meters === null clears the override so Suggested applies again.
export async function setEngineerSelectedLength(connectionId, meters) {
  const conn = getConnections().find((c) => c.id === connectionId)
  if (!conn) return resolveAfter({ ok: false, error: 'Connection no longer exists' })
  if (meters !== null && (!Number.isFinite(meters) || meters <= 0)) {
    return resolveAfter({ ok: false, error: 'Length must be a positive number of metres' })
  }
  upsertConnection({ ...conn, lengths: { ...conn.lengths, engineerSelected: meters } })
  return resolveAfter({ ok: true })
}
