// Pure layout calculation for the HLD physical topology canvas: floor
// bands stacked top-to-bottom by floor order (Floor 0 at the top, matching
// the render), rooms laid out left-to-right within their floor's band,
// devices stacked within their room. Kept separate from the React Flow
// rendering layer so the positioning logic is unit-testable on its own.
const FLOOR_LABEL_WIDTH = 90
export const ROOM_WIDTH = 190
const ROOM_MIN_HEIGHT = 130
const ROOM_GAP = 28
const FLOOR_GAP = 36
export const DEVICE_WIDTH = 160
export const DEVICE_HEIGHT = 40
const DEVICE_GAP = 10
const DEVICE_TOP_PADDING = 36

export function computeHldLayout({ floors, rooms, devicesByRoom }) {
  const sortedFloors = [...floors].sort((a, b) => a.order - b.order)
  const floorBands = []
  const roomNodes = []
  const deviceNodes = []

  let y = 0
  for (const floor of sortedFloors) {
    const floorRooms = rooms.filter((r) => r.floorId === floor.id)

    const roomHeights = floorRooms.map((room) => {
      const count = (devicesByRoom[room.id] ?? []).length
      return Math.max(ROOM_MIN_HEIGHT, DEVICE_TOP_PADDING + count * (DEVICE_HEIGHT + DEVICE_GAP) + DEVICE_GAP)
    })
    const tallestRoom = roomHeights.length > 0 ? Math.max(...roomHeights) : 0
    const bandHeight = (floorRooms.length > 0 ? tallestRoom : 60) + FLOOR_GAP

    floorBands.push({ id: `band-${floor.id}`, floorId: floor.id, label: floor.name, y, height: bandHeight })

    let x = FLOOR_LABEL_WIDTH
    floorRooms.forEach((room, i) => {
      const height = roomHeights[i]
      const roomY = y + (bandHeight - FLOOR_GAP - height) / 2 + FLOOR_GAP / 2
      const roomNodeId = `room-${room.id}`
      roomNodes.push({ id: roomNodeId, roomId: room.id, label: room.code, x, y: roomY, width: ROOM_WIDTH, height })

      const devices = devicesByRoom[room.id] ?? []
      devices.forEach((device, di) => {
        deviceNodes.push({
          id: `device-${device.id}`,
          deviceId: device.id,
          parentId: roomNodeId,
          label: device.hostname ?? device.label,
          sublabel: device.model,
          role: device.role,
          x: (ROOM_WIDTH - DEVICE_WIDTH) / 2,
          y: DEVICE_TOP_PADDING + di * (DEVICE_HEIGHT + DEVICE_GAP),
        })
      })

      x += ROOM_WIDTH + ROOM_GAP
    })

    y += bandHeight
  }

  return { floorBands, roomNodes, deviceNodes }
}
