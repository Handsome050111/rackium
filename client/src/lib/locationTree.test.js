import { describe, it, expect } from 'vitest'
import { buildLocationTree, statusFromCounts } from './locationTree.js'

const building = { id: 'b001', name: 'Building B001' }
const floors = [
  { id: 'f-eg', token: 'EG', name: 'Ground floor (EG)', order: 1 },
  { id: 'f-fu1', token: 'FU1', name: 'Basement (FU1)', order: 0 },
  { id: 'f-empty', token: 'OG9', name: 'Empty floor', order: 2 },
]
const rooms = [
  { id: 'r-tr', floorId: 'f-eg', code: 'TR-EG-01' },
  { id: 'r-ug', floorId: 'f-fu1', code: 'UG1705' },
  { id: 'r-empty', floorId: 'f-empty', code: 'EMPTY' },
]
const racks = [{ id: 'rk-01', roomId: 'r-tr', code: 'R01' }]
const devices = [
  { id: 'd1', label: 'E-1', roomId: 'r-tr', rackId: 'rk-01', status: 'accepted', deliveryReady: true },
  { id: 'd2', label: 'E-2', roomId: 'r-tr', rackId: 'rk-01', status: 'installed', deliveryReady: true },
  { id: 'd3', label: 'E-3', roomId: 'r-tr', rackId: null, status: 'planned', deliveryReady: false },
  { id: 'd4', label: 'C-1', roomId: 'r-ug', rackId: null, status: 'planned', deliveryReady: true },
]

const build = (over = {}) => buildLocationTree({ building, floors, rooms, racks, devices, ...over })

describe('statusFromCounts', () => {
  it('is Ready only when every device is Ready', () => {
    expect(statusFromCounts({ Pending: 0, Installed: 0, Ready: 3 })).toBe('Ready')
  })
  it('is Installed while work is in progress', () => {
    expect(statusFromCounts({ Pending: 1, Installed: 1, Ready: 0 })).toBe('Installed')
    expect(statusFromCounts({ Pending: 1, Installed: 0, Ready: 1 })).toBe('Installed')
  })
  it('is Pending when nothing has started, and for a node with no devices', () => {
    expect(statusFromCounts({ Pending: 2, Installed: 0, Ready: 0 })).toBe('Pending')
    expect(statusFromCounts({ Pending: 0, Installed: 0, Ready: 0 })).toBe('Pending')
  })
})

describe('buildLocationTree', () => {
  it('puts the building at the root with counts for every device under it', () => {
    const tree = build()
    expect(tree.type).toBe('building')
    expect(tree.label).toBe('Building B001')
    expect(tree.total).toBe(4)
    expect(tree.counts).toEqual({ Pending: 2, Installed: 1, Ready: 1 })
    expect(tree.status).toBe('Installed')
  })

  it('orders floors by their order and leaves out floors with no devices', () => {
    const tree = build()
    expect(tree.children.map((f) => f.label)).toEqual(['Basement (FU1)', 'Ground floor (EG)'])
  })

  it('places rack devices under their rack and loose devices directly under the room', () => {
    const eg = build().children.find((f) => f.id === 'f-eg')
    const room = eg.children[0]
    expect(room.label).toBe('TR-EG-01')
    const [rack, ...loose] = room.children
    expect(rack.type).toBe('rack')
    expect(rack.label).toBe('Rack R01')
    expect(rack.children.map((d) => d.label)).toEqual(['E-1', 'E-2'])
    expect(loose.map((d) => d.label)).toEqual(['E-3'])
  })

  it('gives each device its own status and marks devices awaiting delivery', () => {
    const eg = build().children.find((f) => f.id === 'f-eg')
    const [rack, loose] = eg.children[0].children
    const [e1, e2] = rack.children
    expect(e1.status).toBe('Ready')
    expect(e2.status).toBe('Installed')
    expect(loose.children).toEqual([])
    expect(loose.awaitingDelivery).toBe(true)
    expect(e1.awaitingDelivery).toBe(false)
  })

  it('names a device by its hostname, the same name the canvas shows, and falls back to its label', () => {
    const tree = build({ devices: [{ id: 'd7', label: 'Edge switch', hostname: 'E-DE-ERL-C01-B001-EG-007', roomId: 'r-tr', rackId: null, status: 'planned', deliveryReady: true }] })
    expect(tree.children[0].children[0].children[0].label).toBe('E-DE-ERL-C01-B001-EG-007')
  })

  it('treats a device whose rack is not in the building as loose in its room', () => {
    const tree = build({ devices: [{ id: 'd9', label: 'X-9', roomId: 'r-tr', rackId: 'missing', status: 'planned', deliveryReady: true }] })
    const room = tree.children[0].children[0]
    expect(room.children.map((d) => d.label)).toEqual(['X-9'])
  })
})
