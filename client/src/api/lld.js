import { floors, rooms, racks, devices, patchPanels, connections as seedConnections } from '../mock/b001-site.js'
import { getDevicePortMap, getPatchPanelPortMap } from '../lib/portMap.js'
import { portKindFor } from '../lib/validation.js'
import { computeSuggestedLength } from '../lib/cableLength.js'
import { suggestNextCableId, isCableIdUnique } from '../lib/cableId.js'

function resolveAfter(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// Per-session mutable store, seeded from the mock dataset. Mapping changes
// made in the Rackium Editor live here (not in mock/), simulating the real
// API layer this will become. One process-lifetime store is enough for a
// prototype — no persistence across reloads.
const store = {
  connections: [...seedConnections],
  revisionByRack: {}, // rackId -> { revision, unsavedChanges, lastSavedAt }
}

function revisionFor(rackId) {
  if (!store.revisionByRack[rackId]) {
    store.revisionByRack[rackId] = { revision: 12, unsavedChanges: 0, lastSavedAt: '2026-09-27T21:58:00Z' }
  }
  return store.revisionByRack[rackId]
}

function findRack(rackId) {
  return racks.find((r) => r.id === rackId)
}

function findRoom(roomId) {
  return rooms.find((r) => r.id === roomId)
}

// Normalizes a device or patch panel into one shape the editor can work
// with regardless of which it is: id, display label, rack/room placement,
// port map, and a way to classify a given port as copper or SFP/fibre.
function resolveEntity(entityId) {
  const device = devices.find((d) => d.id === entityId)
  if (device) {
    const rack = findRack(device.rackId)
    return {
      id: device.id,
      kind: 'device',
      label: device.hostname,
      sublabel: device.model,
      rackId: device.rackId,
      roomId: rack?.roomId ?? null,
      ru: device.ru,
      portMap: getDevicePortMap(device),
      portKind: (portId) => portKindFor(portId),
    }
  }
  const panel = patchPanels.find((p) => p.id === entityId)
  if (panel) {
    const rack = findRack(panel.rackId)
    return {
      id: panel.id,
      kind: 'patchpanel',
      label: panel.code,
      sublabel: panel.type === 'copper' ? 'Cat6A · 24 port' : 'Fibre · 24 port',
      rackId: panel.rackId,
      roomId: rack?.roomId ?? null,
      ru: panel.ru,
      portMap: getPatchPanelPortMap(panel),
      portKind: () => (panel.type === 'copper' ? 'copper' : 'sfp'),
    }
  }
  return null
}

function occupiedPorts(entityId, excludeConnectionId) {
  const used = new Set()
  for (const conn of store.connections) {
    if (conn.id === excludeConnectionId) continue
    if (conn.source.deviceId === entityId) used.add(conn.source.port)
    if (conn.dest.deviceId === entityId) used.add(conn.dest.port)
  }
  return used
}

export async function getBuildingRackTree() {
  const tree = floors
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((floor) => ({
      id: floor.id,
      name: floor.name,
      rooms: rooms
        .filter((r) => r.floorId === floor.id)
        .map((room) => ({
          id: room.id,
          code: room.code,
          racks: racks
            .filter((r) => r.roomId === room.id)
            .map((rack) => ({ id: rack.id, code: rack.code, heightU: rack.heightU })),
        })),
    }))
  return resolveAfter(tree)
}

export async function getRackEditorContext(rackId) {
  const rack = findRack(rackId)
  if (!rack) return Promise.reject(new Error(`Unknown rack: ${rackId}`))
  const room = findRoom(rack.roomId)

  const rackDevices = devices
    .filter((d) => d.rackId === rackId)
    .map((d) => resolveEntity(d.id))
  const rackPatchPanels = patchPanels
    .filter((p) => p.rackId === rackId)
    .map((p) => resolveEntity(p.id))

  const entities = [...rackDevices, ...rackPatchPanels].sort((a, b) => b.ru - a.ru)

  const touchingConnections = store.connections.filter(
    (c) => entities.some((e) => e.id === c.source.deviceId) || entities.some((e) => e.id === c.dest.deviceId)
  )

  return resolveAfter({
    rack: { id: rack.id, code: rack.code, heightU: rack.heightU },
    room: { id: room.id, code: room.code },
    entities,
    connections: touchingConnections,
    revisionMeta: { ...revisionFor(rackId) },
    allCableIds: store.connections.map((c) => c.cableId),
  })
}

export async function getEntityPortAvailability(entityId, excludeConnectionId = null) {
  const used = occupiedPorts(entityId, excludeConnectionId)
  return resolveAfter({ occupiedPorts: [...used] })
}

export async function suggestCableId() {
  return resolveAfter(suggestNextCableId(store.connections.map((c) => c.cableId)))
}

export async function checkCableIdUnique(cableId, excludeConnectionId = null) {
  const excludeCableId = excludeConnectionId
    ? store.connections.find((c) => c.id === excludeConnectionId)?.cableId
    : null
  return resolveAfter(isCableIdUnique(cableId, store.connections.map((c) => c.cableId), excludeCableId))
}

export async function computeLength({ sourceEntityId, destEntityId, media }) {
  const source = resolveEntity(sourceEntityId)
  const dest = resolveEntity(destEntityId)
  return resolveAfter(
    computeSuggestedLength({
      source: { rackId: source.rackId, roomId: source.roomId, ru: source.ru },
      dest: { rackId: dest.rackId, roomId: dest.roomId, ru: dest.ru },
      media,
    })
  )
}

export function getEntityPortKind(entityId, portId) {
  const entity = resolveEntity(entityId)
  return entity.portKind(portId)
}

// Creates or updates (when mapping.connectionId is given) a connection in
// the session store. Does not touch revision bookkeeping — that only
// advances on Save Revision.
export async function applyMapping(rackId, mapping) {
  const {
    connectionId,
    sourceEntityId,
    sourcePort,
    destEntityId,
    destPort,
    media,
    cableId,
    engineerSelectedLength,
    suggestedLength,
  } = mapping

  const record = {
    id: connectionId ?? `conn-${cableId}`,
    source: { deviceId: sourceEntityId, port: sourcePort },
    dest: { deviceId: destEntityId, port: destPort },
    media,
    speed: media === 'cat6a' ? '1G' : '10G',
    sourceSfp: media === 'cat6a' ? null : `10G-${media.toUpperCase()}`,
    destSfp: media === 'cat6a' ? null : `10G-${media.toUpperCase()}`,
    cableId,
    hops: [],
    lengths: { suggested: suggestedLength, engineerSelected: engineerSelectedLength, installed: null },
    status: 'designed',
    testResult: null,
  }

  const existingIndex = store.connections.findIndex((c) => c.id === record.id)
  if (existingIndex >= 0) {
    store.connections[existingIndex] = record
  } else {
    store.connections.push(record)
  }

  const meta = revisionFor(rackId)
  meta.unsavedChanges += 1

  return resolveAfter({ connection: record, revisionMeta: { ...meta } })
}

export async function saveRevision(rackId) {
  const meta = revisionFor(rackId)
  meta.revision += 1
  meta.unsavedChanges = 0
  meta.lastSavedAt = new Date().toISOString()
  return resolveAfter({ ...meta })
}
