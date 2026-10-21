import { describe, it, expect } from 'vitest'
import { rollup, devicesOf, summarise, stateOf, DGUV_CHILD } from './dguvRollup.js'
import { dguvStatus } from './deployment.js'

// Two buildings in one SAL; B001 has two racks (one in another room), B002 one.
const at = (deviceId, rackId, roomId, floorId, buildingId, lastInspectionDate, today = '2026-10-21', settings = undefined) => {
  const s = lastInspectionDate ? dguvStatus({ lastInspectionDate, mainsPowered: true }, today, settings) : null
  return { deviceId, label: deviceId, rackId, roomId, floorId, buildingId, salId: 'ERL', countryId: 'DE', inspected: Boolean(lastInspectionDate), status: s?.status ?? null, dueDate: s?.dueDate ?? null }
}
const items = [
  at('SW-1', 'R1', 'ROOM1', 'F0', 'B001', '2026-01-10'), // valid
  at('SW-2', 'R1', 'ROOM1', 'F0', 'B001', '2022-12-01'), // due 2026-12-01: expiring soon (41 days)
  at('SW-3', 'R2', 'ROOM2', 'F1', 'B001', '2022-11-10'), // due 2026-11-10: expiring (20 days)
  at('SW-4', 'R3', 'ROOM3', 'F0', 'B002', '2022-09-01'), // due 2026-09-01: overdue
  at('SW-5', null, 'ROOM3', 'F0', 'B002', null), // installed, never inspected, no rack
]

describe('DGUV rollup (M7a-2)', () => {
  it('statuses come from the organisation date and thresholds', () => {
    expect(items.map(stateOf)).toEqual(['valid', 'expiring_soon', 'expiring', 'overdue', 'not_inspected'])
    // Stricter thresholds of an organisation: 60/14 days.
    expect(at('X', 'R', 'RO', 'F', 'B', '2022-12-01', '2026-10-21', { expiringSoonDays: 60, expiringDays: 14 }).status).toBe('expiring_soon')
    expect(at('X', 'R', 'RO', 'F', 'B', '2022-12-01', '2026-10-21', { expiringSoonDays: 30, expiringDays: 14 }).status).toBe('valid')
    // The local date decides: due on the 1st of December, overdue on the 2nd.
    expect(at('X', 'R', 'RO', 'F', 'B', '2022-12-01', '2026-12-01').status).toBe('expiring')
    expect(at('X', 'R', 'RO', 'F', 'B', '2022-12-01', '2026-12-02').status).toBe('overdue')
  })

  it('rolls up device → rack → room → floor → building → SAL → country → project, worst first', () => {
    const project = rollup(items, 'project')
    expect(project.counts).toEqual({ total: 5, valid: 1, expiring_soon: 1, expiring: 1, overdue: 1, not_inspected: 1 })
    expect(project.worst).toBe('overdue')
    expect(project.compliantPct).toBe(60)
    expect(project.rows.map((r) => [r.level, r.id])).toEqual([['country', 'DE']])
    expect(rollup(items, 'country', 'DE').rows.map((r) => [r.level, r.id])).toEqual([['sal', 'ERL']])
    const sal = rollup(items, 'sal', 'ERL')
    expect(sal.rows.map((r) => [r.id, r.worst, r.counts.total])).toEqual([['B002', 'overdue', 2], ['B001', 'expiring', 3]])
    const b1 = rollup(items, 'building', 'B001')
    expect(b1.rows.map((r) => [r.id, r.worst])).toEqual([['F1', 'expiring'], ['F0', 'expiring_soon']])
    expect(rollup(items, 'floor', 'F0').rows.map((r) => [r.id, r.counts.total])).toEqual([['ROOM3', 2], ['ROOM1', 2]])
    // A device not in a rack is its own row (no rack).
    expect(rollup(items, 'room', 'ROOM3').rows.map((r) => [r.id, r.worst])).toEqual([['R3', 'overdue'], [null, 'not_inspected']])
    expect(rollup(items, 'rack', 'R1').rows.map((r) => r.id)).toEqual(['SW-2', 'SW-1'])
    expect(rollup(items, 'device', 'SW-1')).toMatchObject({ childLevel: null, rows: [], worst: 'valid' })
    expect(DGUV_CHILD.building).toBe('floor')
  })

  it('drill-down lists devices of a node, optionally of one status, worst and soonest first', () => {
    expect(devicesOf(items, 'project').map((d) => d.deviceId)).toEqual(['SW-4', 'SW-5', 'SW-3', 'SW-2', 'SW-1'])
    expect(devicesOf(items, 'building', 'B001', 'expiring').map((d) => d.deviceId)).toEqual(['SW-3'])
    expect(devicesOf(items, 'building', 'B002', 'not_inspected').map((d) => d.deviceId)).toEqual(['SW-5'])
    expect(summarise([])).toEqual({ counts: { total: 0, valid: 0, expiring_soon: 0, expiring: 0, overdue: 0, not_inspected: 0 }, worst: null, compliantPct: null })
  })
})
