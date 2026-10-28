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
// A device node grows with its name instead of cutting it (M7b-3): the canvas
// shows the whole hostname — "old → new" for a renamed device — wrapped at
// about 18 characters a line (11 px in the 160 px node), the model at 22.
const NAME_CHARS_PER_LINE = 18
const MODEL_CHARS_PER_LINE = 22
const lineCount = (text, per) => (text ? Math.max(1, Math.ceil(String(text).length / per)) : 1)
export function deviceNodeHeight(label, sublabel) {
  return DEVICE_HEIGHT + (lineCount(label, NAME_CHARS_PER_LINE) - 1) * 14 + (lineCount(sublabel, MODEL_CHARS_PER_LINE) - 1) * 13
}
const heightOf = (device) => deviceNodeHeight(device.hostname ?? device.label, device.model)

export function computeHldLayout({ floors, rooms, devicesByRoom }) {
  const sortedFloors = [...floors].sort((a, b) => a.order - b.order)
  const floorBands = []
  const roomNodes = []
  const deviceNodes = []

  let y = 0
  for (const floor of sortedFloors) {
    const floorRooms = rooms.filter((r) => r.floorId === floor.id)

    const roomHeights = floorRooms.map((room) => {
      const devices = devicesByRoom[room.id] ?? []
      return Math.max(ROOM_MIN_HEIGHT, DEVICE_TOP_PADDING + devices.reduce((sum, d) => sum + heightOf(d) + DEVICE_GAP, 0) + DEVICE_GAP)
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
      let deviceY = DEVICE_TOP_PADDING
      devices.forEach((device) => {
        const deviceHeight = heightOf(device)
        deviceNodes.push({
          id: `device-${device.id}`,
          deviceId: device.id,
          parentId: roomNodeId,
          label: device.hostname ?? device.label,
          sublabel: device.model,
          role: device.role,
          x: (ROOM_WIDTH - DEVICE_WIDTH) / 2,
          y: deviceY,
          height: deviceHeight,
        })
        deviceY += deviceHeight + DEVICE_GAP
      })

      x += ROOM_WIDTH + ROOM_GAP
    })

    y += bandHeight
  }

  return { floorBands, roomNodes, deviceNodes }
}
