import { describe, it, expect } from 'vitest'
import {
  resolvePathway,
  cableLengthInfo,
  upstreamPath,
  downstreamLinks,
  buildPortGroups,
  buildPortScheduleRows,
  filterPortScheduleRows,
  findDuplicateCableIds,
  findPortConflicts,
  paginate,
  deviceDisplayLabel,
} from './lldModel.js'

describe('resolvePathway — the Estimated flag (brief Step 6: "verify this works with a route set to Estimated")', () => {
  const sourceSameRoom = { rackId: 'r1', roomId: 'room-a' }
  const destSameRoom = { rackId: 'r1', roomId: 'room-a' }
  const sourceCross = { rackId: 'r1', roomId: 'room-a' }
  const destCross = { rackId: 'r2', roomId: 'room-b' }

  it('is never Estimated within the same rack/room — only cross-room links use a pathway', () => {
    const result = resolvePathway(sourceSameRoom, destSameRoom, [])
    expect(result.situation).toBe('same-rack')
    expect(result.estimated).toBe(false)
  })

  it('flags Estimated when no building connection exists between the two rooms at all', () => {
    const result = resolvePathway(sourceCross, destCross, [])
    expect(result.estimated).toBe(true)
    expect(result.reason).toMatch(/no pathway recorded/i)
  })

  it('flags Estimated when the route is explicitly set to Estimated in Site Structure', () => {
    const routes = [{ fromRoomId: 'room-a', toRoomId: 'room-b', routeStatus: 'estimated', distanceM: 75 }]
    const result = resolvePathway(sourceCross, destCross, routes)
    expect(result.estimated).toBe(true)
    expect(result.reason).toMatch(/estimated/i)
  })

  it('is NOT Estimated once the route is marked Surveyed with a distance', () => {
    const routes = [{ fromRoomId: 'room-a', toRoomId: 'room-b', routeStatus: 'surveyed', distanceM: 75 }]
    const result = resolvePathway(sourceCross, destCross, routes)
    expect(result.estimated).toBe(false)
  })

  it('flipping the same route back to Estimated in Site Structure flips the flag back', () => {
    const surveyed = resolvePathway(sourceCross, destCross, [{ fromRoomId: 'room-a', toRoomId: 'room-b', routeStatus: 'surveyed', distanceM: 75 }])
    const estimated = resolvePathway(sourceCross, destCross, [{ fromRoomId: 'room-a', toRoomId: 'room-b', routeStatus: 'estimated', distanceM: 75 }])
    expect(surveyed.estimated).toBe(false)
    expect(estimated.estimated).toBe(true)
  })
})

describe('cableLengthInfo', () => {
  it('Installed length is always null — that is Deployment data, never produced here', () => {
    const info = cableLengthInfo({
      connection: { media: 'cat6a', lengths: {} },
      source: { rackId: 'r1', roomId: 'room-a', ru: 40 },
      dest: { rackId: 'r1', roomId: 'room-a', ru: 38 },
      routes: [],
    })
    expect(info.installed).toBeNull()
  })

  it('Engineer Selected defaults to Suggested when no override has been set', () => {
    const info = cableLengthInfo({
      connection: { media: 'cat6a', lengths: {} },
      source: { rackId: 'r1', roomId: 'room-a', ru: 40 },
      dest: { rackId: 'r1', roomId: 'room-a', ru: 38 },
      routes: [],
    })
    expect(info.effective).toBe(info.suggested)
  })

  it('an Engineer Selected override takes precedence over Suggested', () => {
    const info = cableLengthInfo({
      connection: { media: 'cat6a', lengths: { engineerSelected: 99 } },
      source: { rackId: 'r1', roomId: 'room-a', ru: 40 },
      dest: { rackId: 'r1', roomId: 'room-a', ru: 38 },
      routes: [],
    })
    expect(info.engineerSelected).toBe(99)
    expect(info.effective).toBe(99)
  })
})

describe('upstreamPath / downstreamLinks', () => {
  const entityById = {
    ap: { id: 'ap', type: 'device', role: 'ap' },
    edge: { id: 'edge', type: 'device', role: 'edge' },
    border: { id: 'border', type: 'device', role: 'border' },
    fusion: { id: 'fusion', type: 'device', role: 'fusion' },
    wan: { id: 'wan', type: 'device', role: 'wan-circuit' },
  }
  const rows = [
    { id: 'c1', source: { entityId: 'border', entity: entityById.border, port: 'Te1/1/1' }, dest: { entityId: 'fusion', entity: entityById.fusion, port: 'Te1/1/1' } },
    { id: 'c2', source: { entityId: 'fusion', entity: entityById.fusion, port: 'Gi1/1/1' }, dest: { entityId: 'wan', entity: entityById.wan, port: 'WAN1' } },
    { id: 'c3', source: { entityId: 'border', entity: entityById.border, port: 'Te1/1/4' }, dest: { entityId: 'edge', entity: entityById.edge, port: 'Te1/1/1' } },
  ]

  it('walks the Edge all the way up to the WAN circuit', () => {
    const steps = upstreamPath('border', entityById, rows)
    expect(steps.map((s) => s.to.id)).toEqual(['fusion', 'wan'])
  })

  it('stops cleanly when there is nothing further upstream', () => {
    expect(upstreamPath('wan', entityById, rows)).toEqual([])
  })

  it("lists a Border's direct downstream uplinks, not devices further up the chain", () => {
    const links = downstreamLinks('border', entityById, rows)
    expect(links.map((l) => l.id)).toEqual(['c3'])
  })
})

describe('buildPortGroups — never more or fewer ports than the device really has', () => {
  const edge = { id: 'edge-1', role: 'edge' }
  const portMap = {
    rows: [
      Array.from({ length: 24 }, (_, i) => ({ id: `Gi1/0/${2 * i + 1}`, n: 2 * i + 1 })),
      Array.from({ length: 24 }, (_, i) => ({ id: `Gi1/0/${2 * i + 2}`, n: 2 * i + 2 })),
    ],
    modulePorts: Array.from({ length: 8 }, (_, i) => ({ id: `Te1/1/${i + 1}`, n: i + 1 })),
  }

  it('exposes exactly 48 access ports and 8 module ports as separate groups', () => {
    const groups = buildPortGroups(edge, portMap, [])
    const access = groups.find((g) => g.id === 'access')
    const module = groups.find((g) => g.id === 'module')
    expect(access.rows).toHaveLength(48)
    expect(module.rows).toHaveLength(8)
  })

  it('access and module ports are never merged into one list', () => {
    const groups = buildPortGroups(edge, portMap, [])
    expect(groups.map((g) => g.id)).toEqual(['access', 'module'])
  })
})

describe('buildPortScheduleRows / filterPortScheduleRows', () => {
  const portSchedule = [
    {
      device: { id: 'edge-1', label: 'Edge 01', rackCode: 'R01', roomCode: 'TR-EG-01', floorName: 'Ground floor' },
      groups: [{ id: 'access', rows: [{ port: 'Gi1/0/1', status: 'Designed', vlan: '20' }, { port: 'Gi1/0/2', status: 'Available', vlan: '—' }] }],
    },
    {
      device: { id: 'edge-2', label: 'Edge 02', rackCode: 'R01', roomCode: 'TR-EG-02', floorName: 'Ground floor' },
      groups: [{ id: 'access', rows: [{ port: 'Gi1/0/1', status: 'Available', vlan: '—' }] }],
    },
  ]

  it('flattens every device/group/port into one row per port', () => {
    const rows = buildPortScheduleRows(portSchedule)
    expect(rows).toHaveLength(3)
    expect(rows[0].deviceLabel).toBe('Edge 01')
    expect(rows[0].roomCode).toBe('TR-EG-01')
  })

  it('filters by room without touching other rooms', () => {
    const rows = buildPortScheduleRows(portSchedule)
    const filtered = filterPortScheduleRows(rows, { roomCode: 'TR-EG-01' })
    expect(filtered).toHaveLength(2)
  })

  it('filters by status', () => {
    const rows = buildPortScheduleRows(portSchedule)
    const filtered = filterPortScheduleRows(rows, { status: 'Designed' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].deviceId).toBe('edge-1')
  })
})

describe('findDuplicateCableIds / findPortConflicts', () => {
  it('flags a cable ID reused across connections, case-insensitively', () => {
    expect(findDuplicateCableIds(['ABC123', 'abc123', 'XYZ999'])).toEqual(['abc123'])
  })

  it('ignores empty/null cable IDs — HLD connections carry cableId: null until LLD assigns one', () => {
    expect(findDuplicateCableIds([null, null, 'ABC'])).toEqual([])
  })

  it('flags the same device port used by two different connections', () => {
    const conns = [
      { id: 'c1', source: { deviceId: 'd1', port: 'Gi1/0/1' }, dest: { deviceId: 'd2', port: 'Gi1/0/2' } },
      { id: 'c2', source: { deviceId: 'd1', port: 'Gi1/0/1' }, dest: { deviceId: 'd3', port: 'Gi1/0/3' } },
    ]
    expect(findPortConflicts(conns).length).toBeGreaterThan(0)
  })
})

describe('paginate', () => {
  it('never shows more items than the page size, and reports accurate totals', () => {
    const view = paginate(Array.from({ length: 48 }, (_, i) => i), 1, 8)
    expect(view.items).toHaveLength(8)
    expect(view.total).toBe(48)
    expect(view.pageCount).toBe(6)
    expect(view.from).toBe(1)
    expect(view.to).toBe(8)
  })

  it('clamps an out-of-range page to the last valid page', () => {
    const view = paginate(Array.from({ length: 10 }, (_, i) => i), 99, 8)
    expect(view.page).toBe(2)
  })
})

describe('deviceDisplayLabel', () => {
  it('numbers devices of the same role in creation order ("Edge 01", "Edge 02", ...)', () => {
    const devices = [{ id: 'e1', role: 'edge' }, { id: 'e2', role: 'edge' }]
    expect(deviceDisplayLabel(devices[0], devices)).toBe('Edge 01')
    expect(deviceDisplayLabel(devices[1], devices)).toBe('Edge 02')
  })

  it('gives the single Border/Fusion device its fixed name, no number', () => {
    const devices = [{ id: 'b1', role: 'border' }]
    expect(deviceDisplayLabel(devices[0], devices)).toBe('Border')
  })
})
