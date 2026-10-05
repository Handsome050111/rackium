import { getBuildingSiteStructure, getRackLocation, getAllConnections as getAllBuildingConnections } from './siteStructure.js'
import { getDevices, getPatchPanels, getConnections, findDevice, addDevice, upsertConnection, removeConnection } from './networkStore.js'
import { buildHostname } from '@rackium/shared/naming.js'
import { generateBlueprintSuggestions } from '@rackium/shared/blueprintGenerator.js'
import { validateUplink, hasBlockingFailure } from '../lib/hldValidation.js'
import { computeSuggestedLength } from '@rackium/shared/cableLength.js'
import { findSurveyedDistance } from '@rackium/shared/pathway.js'
import { getCompatibleSfps } from '../mock/sfpCatalog.js'
import { updatePhaseStatus } from './buildings.js'
import { computeFreeRU } from '@rackium/shared/rackValidation.js'
import { getCmoForRoom } from './cmoDesign.js'
import { recordHldChange, inHldBatch } from './hldVersion.js'
import { registerStore } from '../lib/persistentStore.js'

const HLD_ROLES = new Set(['fusion', 'border', 'distribution', 'edge', 'ap'])
const ROLE_CODE = { fusion: 'F', border: 'B', distribution: 'D', edge: 'E', ap: 'A' }

function hostnameOf(deviceId) {
  return findDevice(deviceId)?.hostname ?? deviceId
}

function resolveAfter(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

// A device may already be rack-placed (existing B001 devices: rackId only)
// or, if freshly created by Generate HLD / the library, only room-placed
// (roomId, no rack yet — HLD is higher-level than rack placement).
function resolveDeviceRoomId(device) {
  if (device.rackId) return getRackLocation(device.rackId)?.room.id ?? device.roomId ?? null
  return device.roomId ?? null
}

function isHldDevice(device) {
  return HLD_ROLES.has(device.role)
}

// Only connections between two HLD-level devices (not the LLD-detail
// Edge-access-port-to-patch-panel connections, whose far end is a patch
// panel, not a device).
function isHldConnection(conn) {
  return Boolean(findDevice(conn.source.deviceId) && findDevice(conn.dest.deviceId))
}

function buildingFloorRooms(buildingId, buildingsTree) {
  const group = buildingsTree.find((b) => b.buildingId === buildingId)
  if (!group) return { floors: [], rooms: [], racks: [] }
  const floors = group.floors.map(({ rooms: _r, ...f }) => f)
  const rooms = group.floors.flatMap((f) => f.rooms.map(({ racks: _rk, ...r }) => r))
  const racks = group.floors.flatMap((f) => f.rooms.flatMap((r) => r.racks))
  return { floors, rooms, racks }
}

export async function getHldContext(buildingId) {
  const { buildings } = await getBuildingSiteStructure(buildingId)
  const { floors, rooms, racks } = buildingFloorRooms(buildingId, buildings)
  const roomIds = new Set(rooms.map((r) => r.id))

  const devices = getDevices()
    .filter(isHldDevice)
    .filter((d) => roomIds.has(resolveDeviceRoomId(d)))
    .map((d) => ({ ...d, roomId: resolveDeviceRoomId(d) }))

  const deviceIds = new Set(devices.map((d) => d.id))
  const connections = getConnections()
    .filter(isHldConnection)
    .filter((c) => deviceIds.has(c.source.deviceId) || deviceIds.has(c.dest.deviceId))

  const mainRoom = rooms.find((r) => r.isMainRoom) ?? rooms[0] ?? null

  const roomContexts = rooms.map((room) => {
    const roomDevices = devices.filter((d) => d.roomId === room.id)
    return {
      roomId: room.id,
      hasRack: racks.some((rk) => rk.roomId === room.id),
      hasEdge: roomDevices.some((d) => d.role === 'edge'),
      hasAp: roomDevices.some((d) => d.role === 'ap'),
      floorToken: floors.find((f) => f.id === room.floorId)?.token,
    }
  })

  const suggestions = generateBlueprintSuggestions({
    roomContexts,
    hasFusion: devices.some((d) => d.role === 'fusion'),
    hasBorder: devices.some((d) => d.role === 'border'),
    mainRoomId: mainRoom?.id ?? null,
  })

  const revalidated = connections.map((c) => revalidateExistingConnection(c))
  const connectionFindings = Object.fromEntries(revalidated.map((r) => [r.connection.id, r]))
  const blockedLinkCount = revalidated.filter((r) => r.blocked).length
  const openDesignQuestions = suggestions.devices.length + suggestions.uplinks.length

  return resolveAfter({
    floors,
    rooms,
    racks,
    devices,
    connections,
    connectionFindings,
    mainRoomId: mainRoom?.id ?? null,
    suggestions,
    blockedLinkCount,
    openDesignQuestions,
    surveyLinkedObjectCount: devices.length + connections.length,
  })
}

function patchPanelForRoom(roomId, mediaKind) {
  const panels = getPatchPanels().filter((p) => {
    const loc = getRackLocation(p.rackId)
    return loc?.room.id === roomId && p.type === (mediaKind === 'copper' ? 'copper' : 'fibre')
  })
  return panels[0] ?? null
}

export function getPatchPanelFreePorts(roomId, mediaKind) {
  const panel = patchPanelForRoom(roomId, mediaKind)
  if (!panel) return null
  const occupied = new Set(panel.preOccupiedPorts ?? [])
  for (const conn of getConnections()) {
    if (conn.source.deviceId === panel.id) occupied.add(conn.source.port)
    if (conn.dest.deviceId === panel.id) occupied.add(conn.dest.port)
  }
  return (panel.ports ?? 24) - occupied.size
}

function mediaKindFor(media) {
  return media === 'cat6a' ? 'copper' : 'fibre'
}

function revalidateExistingConnection(conn) {
  const destDevice = findDevice(conn.dest.deviceId)
  const destRoomId = destDevice ? resolveDeviceRoomId(destDevice) : null
  const patchPanelFreePorts = destRoomId ? getPatchPanelFreePorts(destRoomId, mediaKindFor(conn.media)) : null
  const findings = validateUplink({
    sourcePortFree: true,
    destPortFree: true,
    media: conn.media,
    speed: conn.speed,
    sourceSfp: conn.sourceSfp,
    destSfp: conn.destSfp,
    estimatedLengthM: conn.lengths?.suggested ?? null,
    patchPanelFreePorts,
  })
  return { connection: conn, findings, blocked: hasBlockingFailure(findings) }
}

export async function validateUplinkDraft(draft) {
  const { sourceDeviceId, sourcePort, destDeviceId, destPort, media, speed, sourceSfp, destSfp, usePatchPanel } = draft

  const sourceDevice = findDevice(sourceDeviceId)
  const destDevice = findDevice(destDeviceId)
  const sourceRoomId = sourceDevice ? resolveDeviceRoomId(sourceDevice) : null
  const destRoomId = destDevice ? resolveDeviceRoomId(destDevice) : null

  const occupied = (deviceId, port) =>
    port != null && getConnections().some((c) => (c.source.deviceId === deviceId && c.source.port === port) || (c.dest.deviceId === deviceId && c.dest.port === port))

  let estimatedLengthM = null
  if (sourceRoomId && destRoomId) {
    const surveyed = findSurveyedDistance(sourceRoomId, destRoomId, await getAllBuildingConnections())
    const result = computeSuggestedLength({
      source: { rackId: sourceDevice?.rackId, roomId: sourceRoomId, ru: sourceDevice?.ru },
      dest: { rackId: destDevice?.rackId, roomId: destRoomId, ru: destDevice?.ru, surveyedPathwayLength: surveyed },
      media,
    })
    estimatedLengthM = result.rawMeters ?? null
  }

  const patchPanelFreePorts = usePatchPanel && destRoomId ? getPatchPanelFreePorts(destRoomId, mediaKindFor(media)) : null

  const findings = validateUplink({
    sourcePortFree: !occupied(sourceDeviceId, sourcePort),
    destPortFree: !occupied(destDeviceId, destPort),
    media,
    speed,
    sourceSfp,
    destSfp,
    estimatedLengthM,
    patchPanelFreePorts,
  })

  return resolveAfter({ findings, blocked: hasBlockingFailure(findings), estimatedLengthM, patchPanelFreePorts })
}

export function getCompatibleSfpOptions(media, speed) {
  return getCompatibleSfps(media, speed).map((s) => s.code)
}

export async function createOrUpdateUplink(connectionId, draft) {
  const record = {
    id: connectionId ?? `hld-conn-${Date.now()}`,
    source: { deviceId: draft.sourceDeviceId, port: draft.sourcePort ?? null },
    dest: { deviceId: draft.destDeviceId, port: draft.destPort ?? null },
    media: draft.media,
    speed: draft.speed,
    sourceSfp: draft.sourceSfp ?? null,
    destSfp: draft.destSfp ?? null,
    cableId: null, // assigned at LLD, brief v2.3 §6.1
    hops: [],
    lengths: { suggested: draft.estimatedLengthM ?? null, engineerSelected: null, installed: null },
    status: 'designed',
    testResult: null,
  }
  upsertConnection(record)
  recordHldChange(`Uplink ${connectionId ? 'changed' : 'added'}: ${hostnameOf(record.source.deviceId)} → ${hostnameOf(record.dest.deviceId)}`)
  return resolveAfter(record)
}

export async function deleteUplink(connectionId) {
  const existing = getConnections().find((c) => c.id === connectionId)
  removeConnection(connectionId)
  if (existing) recordHldChange(`Uplink removed: ${hostnameOf(existing.source.deviceId)} → ${hostnameOf(existing.dest.deviceId)}`)
  return resolveAfter(true, 0)
}

let deviceSeqCounter = {}
registerStore('hldDeviceSeq', {
  getSnapshot: () => deviceSeqCounter,
  restoreSnapshot: (data) => {
    deviceSeqCounter = data ?? {}
  },
})
function nextSeq(role, floorToken) {
  const key = `${role}-${floorToken}`
  deviceSeqCounter[key] = (deviceSeqCounter[key] ?? 0) + 1
  return deviceSeqCounter[key]
}

export async function addDeviceFromLibrary({ role, roomId, floorToken, model }) {
  const seq = nextSeq(role, floorToken ?? 'FU1')
  const device = {
    id: `dev-hld-${role}-${Date.now()}`,
    hostname: buildHostname({ role: ROLE_CODE[role], country: 'DE', sal: 'ERL', campus: 'C01', building: 'B001', floor: floorToken ?? 'FU1', seq }),
    role,
    model: model ?? 'Cisco C9500',
    rackId: null,
    roomId,
    ru: null,
    heightU: 1,
    face: 'front',
    status: 'planned',
  }
  addDevice(device)
  recordHldChange(`Device added: ${device.hostname}`)
  return resolveAfter(device)
}

export async function generateHld(buildingId) {
  return inHldBatch(() => generateHldUnbatched(buildingId))
}

async function generateHldUnbatched(buildingId) {
  const ctx = await getHldContext(buildingId)
  const created = { devices: [], uplinks: [] }

  const deviceByRoomRole = new Map()
  for (const spec of ctx.suggestions.devices) {
    const device = await addDeviceFromLibrary(spec)
    created.devices.push(device)
    deviceByRoomRole.set(`${spec.roomId}:${spec.role}`, device)
  }

  const border = getDevices().find((d) => d.role === 'border') ?? created.devices.find((d) => d.role === 'border')
  for (const spec of ctx.suggestions.uplinks) {
    const edgeDevice = deviceByRoomRole.get(`${spec.toRoomId}:edge`) ?? getDevices().find((d) => d.role === 'edge' && resolveDeviceRoomId(d) === spec.toRoomId)
    if (!border || !edgeDevice) continue
    const conn = await createOrUpdateUplink(null, {
      sourceDeviceId: border.id,
      destDeviceId: edgeDevice.id,
      media: 'os2',
      speed: '10G',
      sourceSfp: 'SFP-10G-LR',
      destSfp: 'SFP-10G-LR',
    })
    created.uplinks.push(conn)
  }

  return resolveAfter(created)
}

const HLD_PHASE_ID = 'hld'

export async function submitForApproval(buildingId) {
  return updatePhaseStatus(buildingId, HLD_PHASE_ID, 'awaiting_approval')
}

export async function approveHld(buildingId) {
  return updatePhaseStatus(buildingId, HLD_PHASE_ID, 'approved')
}

export async function requestHldChanges(buildingId) {
  return updatePhaseStatus(buildingId, HLD_PHASE_ID, 'changes_requested')
}

function rackFreeU(rack) {
  const placements = [
    ...getDevices().filter((d) => d.rackId === rack.id).map((d) => ({ ru: d.ru, heightU: d.heightU, face: d.face, kind: 'device' })),
    ...getPatchPanels().filter((p) => p.rackId === rack.id).map((p) => ({ ru: p.ru, heightU: p.heightU, face: p.face, kind: 'device' })),
  ]
  return computeFreeRU(placements, rack.heightU, 'front').availableRU
}

// Left "Survey inputs" panel: verified racks with free U, rooms with a
// patch-panel-capacity issue, and CMO validation — every number here is
// calculated from the shared survey/device data, not typed in.
export async function getSurveyInputsSummary(buildingId) {
  const { buildings } = await getBuildingSiteStructure(buildingId)
  const { rooms, racks } = buildingFloorRooms(buildingId, buildings)

  const rackSummaries = racks.map((rack) => {
    const room = rooms.find((r) => r.id === rack.roomId)
    return { rackId: rack.id, roomId: room?.id, roomCode: room?.code, rackCode: rack.code, freeU: rackFreeU(rack) }
  })

  const roomIssues = []
  for (const room of rooms) {
    for (const kind of ['copper', 'fibre']) {
      const free = getPatchPanelFreePorts(room.id, kind)
      if (free === 0) {
        const panel = patchPanelForRoom(room.id, kind)
        roomIssues.push({ roomId: room.id, roomCode: room.code, panelCode: panel?.code, message: `${panel?.code} · 0 free ports` })
      }
    }
  }

  let cmoValidated = 0
  let cmoTotal = 0
  for (const room of rooms) {
    const cmoList = getCmoForRoom(room.id)
    cmoTotal += cmoList.length
    for (const entry of cmoList) {
      if (getDevices().some((d) => d.hostname === entry.expectedHostname)) cmoValidated += 1
    }
  }

  return resolveAfter({ racks: rackSummaries, roomIssues, cmo: { validated: cmoValidated, total: cmoTotal, pending: cmoTotal - cmoValidated } })
}
