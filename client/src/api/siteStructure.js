import { buildings, sal, campus } from '../mock/hierarchy.js'
import * as b001 from '../mock/b001-site.js'
import * as b002 from '../mock/b002-site.js'
import * as b003 from '../mock/b003-site.js'
import { getRoomSurveyMeta, hasRoomSurveyMeta } from '../mock/roomSurveyMeta.js'
import { validateStructure } from '../lib/siteValidation.js'
import { resolveAfter } from './site.js'

const SITE_BY_BUILDING = { b001, b002, b003 }
export const BUILDING_IDS = ['b001', 'b002', 'b003']

// Session-mutable store: seed floors/rooms/racks come from the per-building
// mock files; anything created this session (new rooms, racks,
// connections, room-detail edits) lives here instead, same pattern as
// api/lld.js and api/survey.js.
const store = {
  extraRooms: [],
  extraRacks: [],
  // Seeded with the one connection the render shows already surveyed, plus
  // two B001-internal backbone pathways (UG1705 to the two Ground Floor
  // Edge rooms) so the LLD Cable Schedule has a real Surveyed/Estimated
  // contrast to show, and conn-03 is the concrete, flippable example for
  // Step 6's "verify this works with a route set to Estimated" check.
  connections: [
    { id: 'conn-01', fromRoomId: 'room-tr-eg-02', toRoomId: 'room-b002-eg-01', routeStatus: 'surveyed', distanceM: 68, evidenceCount: 4 },
    { id: 'conn-02', fromRoomId: 'room-ug1705', toRoomId: 'room-tr-eg-01', routeStatus: 'surveyed', distanceM: 45, evidenceCount: 2 },
    { id: 'conn-03', fromRoomId: 'room-ug1705', toRoomId: 'room-tr-eg-02', routeStatus: 'estimated', distanceM: 75, evidenceCount: 0 },
  ],
  roomMetaOverrides: {},
}

let idCounter = 1
function newId(prefix) {
  return `${prefix}-${Date.now()}-${idCounter++}`
}

function seedFloors(buildingId) {
  return SITE_BY_BUILDING[buildingId].floors
}
function seedRooms(buildingId) {
  return SITE_BY_BUILDING[buildingId].rooms
}
function seedRacks(buildingId) {
  return SITE_BY_BUILDING[buildingId].racks
}

function allFloors() {
  return BUILDING_IDS.flatMap(seedFloors)
}
function allRooms() {
  return [...BUILDING_IDS.flatMap(seedRooms), ...store.extraRooms]
}
function allRacks() {
  return [...BUILDING_IDS.flatMap(seedRacks), ...store.extraRacks]
}

function findFloor(floorId) {
  return allFloors().find((f) => f.id === floorId)
}
function findRoom(roomId) {
  return allRooms().find((r) => r.id === roomId)
}
function roomBuildingId(roomId) {
  const room = findRoom(roomId)
  return room ? findFloor(room.floorId)?.buildingId : null
}

// Campus-wide rack -> room -> floor resolution, including rooms/racks
// created this session. api/survey.js (Rack Survey, reachable from any
// building via Site Structure) uses this instead of api/site.js's
// B001-only lookups.
export function getRackLocation(rackId) {
  const rack = allRacks().find((r) => r.id === rackId)
  if (!rack) return null
  const room = findRoom(rack.roomId)
  const floor = findFloor(room.floorId)
  return { rack, room, floor }
}

function buildTreeForBuildings(buildingIds) {
  return buildingIds.map((buildingId) => {
    const building = buildings.find((b) => b.id === buildingId)
    const floors = seedFloors(buildingId)
      .slice()
      .sort((a, b) => a.order - b.order)
    return {
      buildingId,
      buildingCode: building.code,
      buildingName: building.name,
      floors: floors.map((floor) => ({
        ...floor,
        rooms: allRooms()
          .filter((r) => r.floorId === floor.id)
          .map((room) => ({ ...room, racks: allRacks().filter((rk) => rk.roomId === room.id) })),
      })),
    }
  })
}

export async function getBuildingSiteStructure(buildingId) {
  return resolveAfter({ buildings: buildTreeForBuildings([buildingId]) })
}

export async function getCampusSiteStructure() {
  return resolveAfter({ salCode: sal.code, campusCode: campus.code, buildings: buildTreeForBuildings(BUILDING_IDS) })
}

export async function getRoomContext(roomId) {
  const room = findRoom(roomId)
  if (!room) return Promise.reject(new Error(`Unknown room: ${roomId}`))
  const floor = findFloor(room.floorId)
  const building = buildings.find((b) => b.id === floor.buildingId)
  return resolveAfter({ room, floor, building })
}

export async function createRoom(floorId) {
  const floor = findFloor(floorId)
  const building = buildings.find((b) => b.id === floor.buildingId)
  const existingCount = allRooms().filter((r) => r.floorId === floorId).length
  const floorToken = floor.token.replace(/[.\s]/g, '')
  const code =
    floor.buildingId === 'b001'
      ? `TR-${floorToken}-${String(existingCount + 1).padStart(2, '0')}`
      : `TR-${building.code}-${floorToken}-${String(existingCount + 1).padStart(2, '0')}`
  const room = { id: newId('room'), floorId, code, name: code }
  store.extraRooms.push(room)
  return resolveAfter(room)
}

export async function createRack(roomId) {
  const existingCount = allRacks().filter((r) => r.roomId === roomId).length
  const rack = { id: newId('rack'), roomId, code: `R${String(existingCount + 1).padStart(2, '0')}`, heightU: 42 }
  store.extraRacks.push(rack)
  return resolveAfter(rack)
}

export async function createConnection(fromRoomId, toRoomId) {
  const connection = { id: newId('conn'), fromRoomId, toRoomId, routeStatus: 'estimated', distanceM: null, evidenceCount: 0 }
  store.connections.push(connection)
  return resolveAfter(connection)
}

export async function updateConnection(connectionId, patch) {
  const connection = store.connections.find((c) => c.id === connectionId)
  if (!connection) return Promise.reject(new Error(`Unknown connection: ${connectionId}`))
  Object.assign(connection, patch)
  return resolveAfter({ ...connection })
}

function withRoomCodes(connection) {
  return { ...connection, fromRoomCode: findRoom(connection.fromRoomId)?.code, toRoomCode: findRoom(connection.toRoomId)?.code }
}

export async function getAllConnections() {
  return resolveAfter(store.connections.map(withRoomCodes))
}

export async function getConnectionContext(connectionId) {
  const connection = store.connections.find((c) => c.id === connectionId)
  if (!connection) return Promise.reject(new Error(`Unknown connection: ${connectionId}`))
  return resolveAfter(withRoomCodes(connection))
}

export async function getRoomMeta(roomId) {
  return resolveAfter({ ...getRoomSurveyMeta(roomId), ...store.roomMetaOverrides[roomId] })
}

export async function updateRoomMeta(roomId, patch) {
  store.roomMetaOverrides[roomId] = { ...store.roomMetaOverrides[roomId], ...patch }
  return resolveAfter(true, 0)
}

function hasRoomMeta(roomId) {
  return hasRoomSurveyMeta(roomId) || Boolean(store.roomMetaOverrides[roomId])
}

// scopeBuildingIds: validate just one building, or all of them (campus view).
export async function validateSiteStructure(scopeBuildingIds) {
  const rooms = allRooms().filter((r) => scopeBuildingIds.includes(roomBuildingId(r.id)))
  const roomIds = new Set(rooms.map((r) => r.id))
  const racks = allRacks().filter((rk) => roomIds.has(rk.roomId))
  const connections = store.connections
    .filter((c) => roomIds.has(c.fromRoomId) || roomIds.has(c.toRoomId))
    .map(withRoomCodes)
  return resolveAfter(validateStructure({ rooms, racks, connections, hasRoomMeta }))
}
