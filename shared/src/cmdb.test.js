import { describe, it, expect } from 'vitest'
import { provenanceEntry, isCmdbRecord, dateState, lifecycleSummary, importDate, matchLifecycleRows, cableMatrix, reconcile, orthogonalPath } from './cmdb.js'

describe('CMDB records and provenance', () => {
  it('only accepted (as-built) devices are CMDB records', () => {
    expect(['accepted', 'in_service', 'maintenance'].every((status) => isCmdbRecord({ status }))).toBe(true)
    expect(['planned', 'delivered', 'installed', 'tested', 'retired'].some((status) => isCmdbRecord({ status }))).toBe(false)
  })
  it('a provenance entry says where a value came from, who set it and when', () => {
    expect(provenanceEntry('import', { userId: 'u1', userName: 'Ana', at: new Date('2026-10-14T08:00:00Z'), importBatchId: 'b1' })).toEqual({ source: 'import', setBy: 'u1', setByName: 'Ana', setAt: '2026-10-14T08:00:00.000Z', importBatchId: 'b1' })
  })
})

describe('lifecycle', () => {
  it('dates are expired, due within 90 days, or ok', () => {
    expect(dateState(null, '2026-10-14')).toBeNull()
    expect(dateState('2026-10-13', '2026-10-14')).toBe('expired')
    expect(dateState('2027-01-12', '2026-10-14')).toBe('soon')
    expect(dateState('2027-01-13', '2026-10-14')).toBe('ok')
    expect(lifecycleSummary({ warrantyEnd: '2030-01-01', eolDate: '2026-01-01' }, '2026-10-14')).toEqual({ warranty: 'ok', refresh: null, eos: null, eol: 'expired' })
  })
  it('import dates in ISO, German and slash notation, Excel serials and Dates', () => {
    expect(importDate('2027-03-01')).toBe('2027-03-01')
    expect(importDate('1.3.2027')).toBe('2027-03-01')
    expect(importDate('01/03/2027')).toBe('2027-03-01')
    expect(importDate(46447)).toBe('2027-03-01')
    expect(importDate(new Date('2027-03-01T00:00:00Z'))).toBe('2027-03-01')
    expect(importDate('31.02.2027')).toBeUndefined()
    expect(importDate('soon')).toBeUndefined()
    expect(importDate('')).toBeNull()
  })
  it('rows match by serial first, then by hostname', () => {
    const devices = [
      { id: 'd1', serial: 'FOX1', hostname: 'B001-SW-01' },
      { id: 'd2', serial: 'FOX2', hostname: 'B001-SW-02' },
    ]
    const out = matchLifecycleRows(
      [
        { Serial: 'fox1', Hostname: 'B001-SW-02', 'Warranty end': '2030-01-01' },
        { Hostname: 'b001-sw-02', 'Refresh date': '01.06.2031' },
        { Serial: 'NOPE', 'Warranty end': '2030-01-01' },
        { Serial: 'FOX2', 'Warranty start': '2026-01-01', 'Warranty end': '2025-01-01' },
        { Serial: 'FOX2', 'Warranty end': 'next year' },
      ],
      devices,
    )
    expect(out[0]).toMatchObject({ row: 2, deviceId: 'd1', match: 'serial', values: { warrantyEnd: '2030-01-01' }, problems: [] })
    expect(out[1]).toMatchObject({ deviceId: 'd2', match: 'hostname', values: { refreshDate: '2031-06-01' }, problems: [] })
    expect(out[2].problems[0]).toMatch(/No CMDB record/)
    expect(out[3].problems).toContain('Warranty end is before warranty start')
    expect(out[4].problems[0]).toMatch(/not a date/)
  })
})

describe('cable matrix and reconciliation', () => {
  const names = { a: 'SW-01', p: 'PP-01', b: 'AP-01' }
  const conn = {
    id: 'c1',
    media: 'copper_cat6a',
    status: 'accepted',
    testResult: 'pass',
    source: { deviceId: 'a', portId: 'Gi1/0/2' },
    dest: { deviceId: 'b', portId: 'eth0' },
    hops: [{ patchPanelId: 'p', inPort: '02', outPort: '02' }],
    segments: [
      { index: 0, cableId: 'C-1', installedM: 2, effectiveM: 3 },
      { index: 1, cableId: 'C-2', installedM: null, effectiveM: 25 },
    ],
  }
  it('every port to its destination, with the hops in its own direction', () => {
    const rows = cableMatrix([conn], (id) => names[id])
    expect(rows.map((r) => `${r.device} ${r.port} → ${r.toDevice} ${r.toPort}`)).toEqual(['AP-01 eth0 → SW-01 Gi1/0/2', 'SW-01 Gi1/0/2 → AP-01 eth0'])
    expect(rows[0]).toMatchObject({ hops: ['PP-01 02/02'], cableIds: ['C-1', 'C-2'], lengthM: 27, testResult: 'pass' })
  })
  it('reconciliation: counts, missing serials, cable ID conflicts, open exceptions', () => {
    const r = reconcile({
      designDevices: [{}, {}, {}],
      devices: [
        { id: 'd1', status: 'accepted', serial: 'X' },
        { id: 'd2', status: 'installed', serial: null, hostname: 'H2' },
        { id: 'd3', status: 'delivered' },
      ],
      connections: [conn, { id: 'c2', segments: [{ cableId: 'c-1' }] }],
      openExceptions: 2,
    })
    expect(r).toMatchObject({ designCount: 3, installedCount: 2, cmdbCount: 1, notInstalled: 1, missingSerials: [{ id: 'd2', hostname: 'H2' }], cableIdConflicts: [{ cableId: 'C-1', connections: 2 }], openExceptions: 2 })
  })
  it('the port route is orthogonal through the waypoints', () => {
    expect(orthogonalPath([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 90 }, { x: 20, y: 120 }])).toBe('M 10 10 H 50 V 90 H 20 V 120')
    expect(orthogonalPath([{ x: 0, y: 0 }])).toBe('')
  })
})
