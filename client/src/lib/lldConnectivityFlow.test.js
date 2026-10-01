import { describe, it, expect } from 'vitest'
import { relevantIdsForSelection, applyConnectivityHighlight } from './lldConnectivityFlow.js'

describe('relevantIdsForSelection', () => {
  it('includes the selected device, its upstream chain and connecting links', () => {
    const steps = [
      { from: { id: 'edge' }, to: { id: 'border' }, row: { id: 'c1' } },
      { from: { id: 'border' }, to: { id: 'fusion' }, row: { id: 'c2' } },
    ]
    const { deviceIds, connectionIds } = relevantIdsForSelection('edge', steps, [])
    expect([...deviceIds].sort()).toEqual(['border', 'edge', 'fusion'])
    expect([...connectionIds].sort()).toEqual(['c1', 'c2'])
  })

  it('includes downstream rows for a Border selection', () => {
    const downstream = [{ source: { entityId: 'border' }, dest: { entityId: 'edge-1' }, id: 'c3' }]
    const { deviceIds, connectionIds } = relevantIdsForSelection('border', [], downstream)
    expect(deviceIds.has('edge-1')).toBe(true)
    expect(connectionIds.has('c3')).toBe(true)
  })
})

describe('applyConnectivityHighlight', () => {
  const flow = {
    nodes: [
      { id: 'n1', type: 'device', data: { deviceId: 'd1' } },
      { id: 'n2', type: 'device', data: { deviceId: 'd2' } },
      { id: 'band', type: 'floorBand', data: {} },
    ],
    edges: [
      { id: 'c1' },
      { id: 'c2' },
    ],
  }

  it('leaves the flow untouched when nothing is selected', () => {
    const result = applyConnectivityHighlight(flow, null, new Set(), new Set())
    expect(result).toBe(flow)
  })

  it('dims devices not in the relevant set and leaves non-device nodes alone', () => {
    const result = applyConnectivityHighlight(flow, 'd1', new Set(['d1']), new Set())
    const n1 = result.nodes.find((n) => n.id === 'n1')
    const n2 = result.nodes.find((n) => n.id === 'n2')
    const band = result.nodes.find((n) => n.id === 'band')
    expect(n1.style.opacity).toBe(1)
    expect(n2.style.opacity).toBeLessThan(1)
    expect(band.style).toBeUndefined()
  })

  it('dims edges not in the relevant connection set', () => {
    const result = applyConnectivityHighlight(flow, 'd1', new Set(['d1']), new Set(['c1']))
    const e1 = result.edges.find((e) => e.id === 'c1')
    const e2 = result.edges.find((e) => e.id === 'c2')
    expect(e1.style.opacity).toBe(1)
    expect(e2.style.opacity).toBeLessThan(1)
  })
})
