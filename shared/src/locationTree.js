import { deploymentLabel } from './deploymentModel.js'

// Location tree for the deployment screen: Building -> Floor -> Room -> Rack -> Device.
// Each node carries counts of its devices by deployment state (Pending, Installed,
// Ready) and one status icon for the node as a whole. Floors, rooms and racks with
// no devices are left out, so the tree only shows what has to be installed.

const emptyCounts = () => ({ Pending: 0, Installed: 0, Ready: 0 })

export function countDevices(devices) {
  const counts = emptyCounts()
  for (const device of devices) counts[deploymentLabel(device.status)] += 1
  return counts
}

// Ready when every device is Ready. Installed when any device is Installed or
// Ready but not all are Ready (work in progress). Pending when none has started.
export function statusFromCounts(counts) {
  const total = counts.Pending + counts.Installed + counts.Ready
  if (total > 0 && counts.Ready === total) return 'Ready'
  if (counts.Installed + counts.Ready > 0) return 'Installed'
  return 'Pending'
}

function node(type, id, label, devices, children = []) {
  const counts = countDevices(devices)
  return { type, id, label, counts, total: devices.length, status: statusFromCounts(counts), children }
}

// A rack's devices are placed in it; a room's other devices sit loose in the room.
function roomNode(room, racks, devices) {
  const roomDevices = devices.filter((d) => d.roomId === room.id)
  if (roomDevices.length === 0) return null

  const rackIds = new Set(racks.map((rack) => rack.id))
  const rackNodes = racks
    .filter((rack) => rack.roomId === room.id)
    .map((rack) => {
      const rackDevices = roomDevices.filter((d) => d.rackId === rack.id)
      if (rackDevices.length === 0) return null
      return node('rack', rack.id, `Rack ${rack.code}`, rackDevices, rackDevices.map(deviceNode))
    })
    .filter(Boolean)

  const looseDevices = roomDevices.filter((d) => !d.rackId || !rackIds.has(d.rackId))
  const children = [...rackNodes, ...looseDevices.map(deviceNode)]
  return node('room', room.id, room.code ?? room.name, roomDevices, children)
}

// A device is named by its hostname, as on the canvas; label is the role name.
function deviceNode(device) {
  return { ...node('device', device.id, device.hostname ?? device.label ?? device.id, [device]), awaitingDelivery: !device.deliveryReady }
}

export function buildLocationTree({ building, floors, rooms, racks, devices }) {
  const floorNodes = [...floors]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((floor) => {
      const roomsOnFloor = rooms.filter((room) => room.floorId === floor.id)
      const roomNodes = roomsOnFloor.map((room) => roomNode(room, racks, devices)).filter(Boolean)
      if (roomNodes.length === 0) return null
      const roomIds = new Set(roomsOnFloor.map((room) => room.id))
      const floorDevices = devices.filter((d) => roomIds.has(d.roomId))
      return node('floor', floor.id, floor.name ?? floor.token, floorDevices, roomNodes)
    })
    .filter(Boolean)

  const placedRoomIds = new Set(floorNodes.flatMap((floorNode) => floorNode.children.map((roomItem) => roomItem.id)))
  const placedDevices = devices.filter((d) => placedRoomIds.has(d.roomId))
  return node('building', building?.id ?? 'building', building?.name ?? 'Building', placedDevices, floorNodes)
}
