import { describe, it, expect } from 'vitest'
import { routeLegs, routeDistance } from './pathway.js'
import { uplinkNeededFindings, validateHld, HLD_RULES } from './hldRules.js'
import { buildBom } from './bomCalc.js'
import { computeHldLayout, deviceNodeHeight, DEVICE_HEIGHT } from './hldLayout.js'
import { hldBreakBody, hldRerouteBody, hldReplaceEndpointBody, hldSplitBody, hldMergeBody } from './contracts.js'
import { SEEDED_CATALOGUE } from './catalogueSeed.js'

// M7b-3: the HLD design tools (addendum v2.3 Q1; DATA-MODEL §5.20).
const ID = (n) => String(n).padStart(24, '0')

describe('Reroute: a route through rooms', () => {
  const pathways = [
    { fromRoomId: 'a', toRoomId: 'b', routeStatus: 'surveyed', distanceM: 42 },
    { fromRoomId: 'a', toRoomId: 'c', routeStatus: 'surveyed', distanceM: 30 },
    { fromRoomId: 'b', toRoomId: 'c', routeStatus: 'surveyed', distanceM: 25 },
    { fromRoomId: 'c', toRoomId: 'd', routeStatus: 'estimated', distanceM: 10 },
  ]
  it('has a leg per pair of rooms, in order; its length is the legs added up', () => {
    expect(routeLegs('a', 'b', ['c'])).toEqual([['a', 'c'], ['c', 'b']])
    expect(routeDistance('a', 'b', pathways)).toEqual({ distanceM: 42, reason: null })
    expect(routeDistance('a', 'b', pathways, ['c'])).toEqual({ distanceM: 55, reason: null })
    // Either direction is the same route.
    expect(routeDistance('b', 'a', pathways, ['c'])).toEqual({ distanceM: 55, reason: null })
  })
  it('a leg without a pathway leaves the route without a length; an Estimated leg says so', () => {
    expect(routeDistance('a', 'b', pathways, ['x'])).toEqual({ distanceM: null, reason: 'No pathway recorded between these rooms' })
    expect(routeDistance('a', 'd', pathways, ['c'])).toEqual({ distanceM: 40, reason: 'Pathway route is marked Estimated' })
  })
})

describe('Break Uplink: W-UPLINK-NEEDED', () => {
  const deviceById = new Map([
    ['b', { id: 'b', label: 'B-1' }],
    ['e', { id: 'e', label: 'E-1' }],
  ])
  const broken = [{ id: 'c1', sourceDeviceId: 'b', destDeviceId: 'e', sourceName: 'B-1', destName: 'E-1', reason: 'Moves', at: '2026-10-28T10:00:00Z' }]
  it('a warning on both devices, never a blocker', () => {
    expect(HLD_RULES['W-UPLINK-NEEDED'].severity).toBe('warning')
    const found = uplinkNeededFindings({ broken, connections: [], deviceById })
    expect(found.map((f) => [f.objectId, f.severity])).toEqual([
      ['b', 'warning'],
      ['e', 'warning'],
    ])
    expect(found[1].message).toBe('E-1: uplink needed — its uplink to B-1 was broken (Moves)')
    expect(validateHld({ devices: [...deviceById.values()], connections: [], broken }, { deviceById, itemOf: () => null, opticOf: () => null }).filter((f) => f.severity === 'critical')).toEqual([])
  })
  it('cleared for a device by a link created after the break, not by an older one; a device gone from the design has none', () => {
    const relinked = [{ source: { deviceId: 'e' }, dest: { deviceId: 'x' }, createdAt: '2026-10-28T11:00:00Z' }]
    const older = [{ source: { deviceId: 'b' }, dest: { deviceId: 'y' }, createdAt: '2026-10-27T11:00:00Z' }]
    expect(uplinkNeededFindings({ broken, connections: [...relinked, ...older], deviceById }).map((f) => f.objectId)).toEqual(['b'])
    expect(uplinkNeededFindings({ broken, connections: [], deviceById: new Map([['b', { id: 'b', label: 'B-1' }]]) }).map((f) => f.objectId)).toEqual(['b'])
  })
})

describe('Reroute via a patch panel: the HLD-stage BOM', () => {
  const design = (panelNeeds) => ({ devices: [], connections: [], panelNeeds })
  const panels = (bom) => bom.lines.filter((l) => /patch panel/i.test(l.item))
  it('adds panels for the links beyond the free surveyed ports, of the right kind; none from the LLD on', () => {
    const fibre = buildBom(design([{ roomCode: 'TR-EG-02', kind: 'fibre', links: 1, freePorts: 0 }]), { stage: 'hld', catalogue: SEEDED_CATALOGUE })
    expect(panels(fibre)).toEqual([expect.objectContaining({ item: 'LC Fibre Patch Panel 24-port', qty: 1, source: 'HLD', basis: '1 uplink(s) via the patch panel in TR-EG-02: 1 × 24-port' })])
    const copper = buildBom(design([{ roomCode: 'TR-EG-02', kind: 'copper', links: 30, freePorts: 2 }]), { stage: 'hld', catalogue: SEEDED_CATALOGUE })
    expect(panels(copper)).toEqual([expect.objectContaining({ item: 'Cat6A Patch Panel 24-port', qty: 2 })])
    expect(panels(buildBom(design([{ roomCode: 'TR-EG-02', kind: 'copper', links: 2, freePorts: 5 }]), { stage: 'hld', catalogue: SEEDED_CATALOGUE }))).toEqual([])
    expect(panels(buildBom(design([{ roomCode: 'TR-EG-02', kind: 'copper', links: 2, freePorts: 0 }]), { stage: 'lld', catalogue: SEEDED_CATALOGUE }))).toEqual([])
  })
})

describe('Long names on the canvas (M7b-3)', () => {
  it('a device node grows with its name instead of cutting it; a short name keeps the old height', () => {
    expect(deviceNodeHeight('E-1', 'C9300')).toBe(DEVICE_HEIGHT)
    expect(deviceNodeHeight('E-DE-ERL-C01-B001-EG-001', 'C9300-48UX')).toBe(DEVICE_HEIGHT + 14)
    expect(deviceNodeHeight('E-DE-ERL-C01-B001-EG-001 → E-DE-ERL-C01-B001-EG-009', 'C9300-48UX')).toBe(DEVICE_HEIGHT + 2 * 14)
    const layout = computeHldLayout({
      floors: [{ id: 'f', name: 'EG', order: 0 }],
      rooms: [{ id: 'r', floorId: 'f', code: 'TR-EG-01' }],
      devicesByRoom: { r: [{ id: 'a', hostname: 'E-DE-ERL-C01-B001-EG-001 → E-DE-ERL-C01-B001-EG-009', model: 'C9300' }, { id: 'b', hostname: 'A-1', model: 'C9130' }] },
    })
    const [a, b] = layout.deviceNodes
    expect(b.y - a.y).toBe(a.height + 10)
    expect(layout.roomNodes[0].height).toBeGreaterThanOrEqual(36 + a.height + b.height + 3 * 10)
  })
})

describe('Tool request contracts', () => {
  it('Break needs a reason; Reroute something to change; Split one device; all strict', () => {
    expect(hldBreakBody.safeParse({ baseRevision: 1 }).success).toBe(false)
    expect(hldBreakBody.safeParse({ reason: '  ', baseRevision: 1 }).success).toBe(false)
    expect(hldBreakBody.safeParse({ reason: 'x', baseRevision: 1 }).success).toBe(true)
    expect(hldRerouteBody.safeParse({ baseRevision: 1 }).success).toBe(false)
    expect(hldRerouteBody.safeParse({ viaRoomIds: [], baseRevision: 1 }).success).toBe(true)
    expect(hldReplaceEndpointBody.safeParse({ end: 'middle', deviceId: ID(1), baseRevision: 1 }).success).toBe(false)
    expect(hldSplitBody.safeParse({ baseRevision: 1 }).success).toBe(false)
    expect(hldSplitBody.safeParse({ deviceId: ID(1), newDevice: { role: 'edge', roomId: ID(2) }, baseRevision: 1 }).success).toBe(false)
    expect(hldSplitBody.safeParse({ newDevice: { role: 'distribution', roomId: ID(2) }, baseRevision: 1 }).success).toBe(true)
    expect(hldMergeBody.safeParse({ baseRevision: 1, extra: true }).success).toBe(false)
  })
})
