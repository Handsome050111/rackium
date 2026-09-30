import { describe, it, expect } from 'vitest'
import { computeHldLayout } from './hldLayout.js'

const floors = [
  { id: 'f0', order: 0, name: 'Floor 0' },
  { id: 'f1', order: 1, name: 'Floor 1' },
]
const rooms = [
  { id: 'r1', floorId: 'f0' },
  { id: 'r2', floorId: 'f1' },
  { id: 'r3', floorId: 'f1' },
]
const devicesByRoom = {
  r1: [{ id: 'd1', hostname: 'F-...', model: 'C9500', role: 'fusion' }],
  r2: [{ id: 'd2', hostname: 'E-...', model: 'C9300', role: 'edge' }],
  r3: [],
}

describe('computeHldLayout', () => {
  it('stacks floor bands top-to-bottom in floor order (Floor 0 first)', () => {
    const { floorBands } = computeHldLayout({ floors, rooms, devicesByRoom })
    expect(floorBands[0].floorId).toBe('f0')
    expect(floorBands[1].floorId).toBe('f1')
    expect(floorBands[1].y).toBeGreaterThan(floorBands[0].y)
  })

  it('lays out rooms left-to-right within the same floor without overlapping', () => {
    const { roomNodes } = computeHldLayout({ floors, rooms, devicesByRoom })
    const r2 = roomNodes.find((r) => r.roomId === 'r2')
    const r3 = roomNodes.find((r) => r.roomId === 'r3')
    expect(r3.x).toBeGreaterThanOrEqual(r2.x + r2.width)
  })

  it('places devices as children of their room node', () => {
    const { deviceNodes, roomNodes } = computeHldLayout({ floors, rooms, devicesByRoom })
    const device = deviceNodes.find((d) => d.deviceId === 'd1')
    const room = roomNodes.find((r) => r.roomId === 'r1')
    expect(device.parentId).toBe(room.id)
  })

  it('handles a room with no devices without crashing', () => {
    const { roomNodes } = computeHldLayout({ floors, rooms, devicesByRoom })
    expect(roomNodes.find((r) => r.roomId === 'r3')).toBeDefined()
  })
})
