import { describe, it, expect } from 'vitest'
import { isCmdbDevice, acceptanceLabel, computeReconciliation, buildPortTrace } from './cmdbModel.js'

describe('isCmdbDevice — brief: "built from deployment records, not design data"', () => {
  it('excludes a merely planned device', () => {
    expect(isCmdbDevice({ role: 'edge', status: 'planned' })).toBe(false)
  })
  it('excludes the WAN circuit regardless of status', () => {
    expect(isCmdbDevice({ role: 'wan-circuit', status: 'installed' })).toBe(false)
  })
  it('includes a device once it has moved past planned/ordered', () => {
    expect(isCmdbDevice({ role: 'edge', status: 'delivered' })).toBe(true)
    expect(isCmdbDevice({ role: 'edge', status: 'installed' })).toBe(true)
    expect(isCmdbDevice({ role: 'edge', status: 'accepted' })).toBe(true)
  })
})

describe('acceptanceLabel', () => {
  it('is Accepted only for accepted/in_service', () => {
    expect(acceptanceLabel('accepted')).toBe('Accepted')
    expect(acceptanceLabel('in_service')).toBe('Accepted')
    expect(acceptanceLabel('installed')).toBe('Awaiting')
    expect(acceptanceLabel('tested')).toBe('Awaiting')
  })
})

describe('computeReconciliation', () => {
  it('reports a genuine inventory variance and missing serials', () => {
    const cmdbDevices = [{ hostname: 'E-01', serial: 'ABC' }, { hostname: 'E-02', serial: null }]
    const result = computeReconciliation({ hldDeviceCount: 3, cmdbDevices, cableIds: ['111', '222'] })
    expect(result.inventoryVariance).toBe(1)
    expect(result.missingSerials).toEqual(['E-02'])
    expect(result.cableIdConflicts).toEqual([])
  })

  it('flags a case-insensitive duplicate cable ID exactly once even if repeated 3x', () => {
    const result = computeReconciliation({ hldDeviceCount: 1, cmdbDevices: [], cableIds: ['ABC123', 'abc123', 'abc123', 'XYZ'] })
    expect(result.cableIdConflicts).toHaveLength(1)
    expect(result.cableIdConflicts[0].toLowerCase()).toBe('abc123')
  })
})

describe('buildPortTrace — brief §5.8 example format', () => {
  const entityById = {
    'dev-edge-4': { label: 'Edge 04' },
    'dev-border': { label: 'Border' },
  }

  it('builds a direct trace (no hops) as source -> cable -> destination', () => {
    const connection = { source: { deviceId: 'dev-edge-4', port: 'Te1/1/1' }, dest: { deviceId: 'dev-border', port: 'Te1/1/4' }, cableId: '26184735', hops: [] }
    const trace = buildPortTrace(connection, entityById)
    expect(trace.map((s) => s.label)).toEqual(['Edge 04 Te1/1/1', 'Cable 26184735', 'Border Te1/1/4'])
  })

  it('walks every hop in order when hops are present', () => {
    entityById['pp-02'] = { label: 'PP-02' }
    const connection = {
      source: { deviceId: 'dev-edge-4', port: 'Te1/1/1' },
      dest: { deviceId: 'dev-border', port: 'Te1/1/4' },
      cableId: '26184737',
      hops: [{ patchPanelId: 'pp-02', port: '08', cableId: '26184735' }],
    }
    const trace = buildPortTrace(connection, entityById)
    expect(trace.map((s) => s.label)).toEqual(['Edge 04 Te1/1/1', 'Cable 26184735', 'PP-02 Port 08', 'Cable 26184737', 'Border Te1/1/4'])
  })
})
