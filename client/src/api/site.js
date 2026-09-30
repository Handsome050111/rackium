import { floors, rooms, racks } from '../mock/b001-site.js'

export function resolveAfter(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export function findRack(rackId) {
  return racks.find((r) => r.id === rackId)
}

export function findRoom(roomId) {
  return rooms.find((r) => r.id === roomId)
}

export function findFloor(floorId) {
  return floors.find((f) => f.id === floorId)
}

// "Pick a rack" tree, shared by LLD (Rackium Editor) and Survey.
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
