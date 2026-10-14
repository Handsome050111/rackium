import { describe, it, expect } from 'vitest'
import {
  deviceStepProblem,
  acceptanceBlockers,
  connectionStepProblem,
  installMac,
  macProblem,
  serialProblem,
  lengthBeyondTolerance,
  deviceDeviations,
  connectionDeviations,
  unhandledDeviations,
  exceptionOutcome,
  dguvStatus,
  isMainsPowered,
  pipelineStats,
  deploymentPhaseStatus,
  cmdbPhaseStatus,
} from './deployment.js'

const FE = { roles: ['field_engineer'] }
const ready = { serial: 'SN1', mainsPowered: true, dguvRecorded: true, openDeviations: 0, openExceptions: 0 }

describe('device status flow', () => {
  it('installation needs the procurement line Delivered', () => {
    expect(deviceStepProblem('ordered', 'installed', { ...FE, delivered: false })).toMatch(/Awaiting delivery/)
    expect(deviceStepProblem('delivered', 'installed', { ...FE, delivered: true })).toBeNull()
  })
  it('steps go in order and the Field Engineer records them', () => {
    expect(deviceStepProblem('installed', 'configured', FE)).toBeNull()
    expect(deviceStepProblem('installed', 'tested', FE)).toMatch(/next is Configured/)
    expect(deviceStepProblem('installed', 'configured', { roles: ['pm'] })).toMatch(/Field Engineer/)
  })
  it('Tested needs every connection of the device tested', () => {
    expect(deviceStepProblem('configured', 'tested', { ...FE, connections: [{ status: 'tested' }, { status: 'installed' }] })).toMatch(/1 connection/)
    expect(deviceStepProblem('configured', 'tested', { ...FE, connections: [{ status: 'tested' }, { status: 'accepted' }] })).toBeNull()
  })
  it('Accepted by a PM or Reviewer only, and only when nothing blocks it', () => {
    expect(deviceStepProblem('tested', 'accepted', { ...FE, ...ready })).toMatch(/PM or Reviewer/)
    expect(deviceStepProblem('tested', 'accepted', { roles: ['architect'], ...ready })).toMatch(/PM or Reviewer/)
    expect(deviceStepProblem('tested', 'accepted', { roles: ['reviewer'], ...ready })).toBeNull()
    expect(deviceStepProblem('tested', 'accepted', { roles: ['pm'], ...ready, openExceptions: 1 })).toMatch(/not yet accepted/)
  })
  it('acceptance blockers: serial, DGUV for mains-powered devices, deviations, exceptions', () => {
    expect(acceptanceBlockers({ serial: '', mainsPowered: true, dguvRecorded: false, openDeviations: 2, openExceptions: 1 })).toHaveLength(4)
    expect(acceptanceBlockers({ serial: 'X', mainsPowered: false, dguvRecorded: false, openDeviations: 0, openExceptions: 0 })).toEqual([])
  })
})

describe('connection status flow', () => {
  it('installed → tested (or faulty) → accepted', () => {
    expect(connectionStepProblem('approved', 'installed', { ...FE, segmentsConfirmed: false })).toMatch(/every cable/)
    expect(connectionStepProblem('approved', 'installed', FE)).toBeNull()
    expect(connectionStepProblem('approved', 'tested', FE)).toMatch(/patching/)
    expect(connectionStepProblem('installed', 'faulty', FE)).toBeNull()
    expect(connectionStepProblem('faulty', 'accepted', { roles: ['pm'] })).toMatch(/link test has passed/)
    expect(connectionStepProblem('tested', 'accepted', FE)).toMatch(/PM or Reviewer/)
    expect(connectionStepProblem('tested', 'accepted', { roles: ['reviewer'] })).toBeNull()
  })
})

describe('serial and MAC', () => {
  it('normalises MAC addresses in any common notation', () => {
    expect(installMac('001a.2b3c.4d5e')).toBe('00:1a:2b:3c:4d:5e')
    expect(installMac('00-1A-2B-3C-4D-5E')).toBe('00:1a:2b:3c:4d:5e')
    expect(installMac('')).toBeNull()
    expect(installMac('00:1A:2B')).toBeUndefined()
    expect(installMac('0x001A2B3C4D5E')).toBeUndefined()
    expect(macProblem('zz:zz')).toMatch(/12 hexadecimal/)
    expect(macProblem('001A2B3C4D5E')).toBeNull()
  })
  it('serials: format, and unique against CMO devices and installed devices', () => {
    expect(serialProblem('FOX1234')).toBeNull()
    expect(serialProblem('FOX 12')).toMatch(/letters, digits/)
    expect(serialProblem('FOX1', { kind: 'cmo', name: 'OLD-SW-1' })).toMatch(/CMO-imported device OLD-SW-1/)
    expect(serialProblem('FOX1', { kind: 'device', name: 'B001-SW-02' })).toMatch(/already recorded on B001-SW-02/)
  })
})

describe('deviations against the frozen LLD', () => {
  it('length tolerance is the greater of 0.5 m and 10 %', () => {
    expect(lengthBeyondTolerance(3, 3.5)).toBe(false)
    expect(lengthBeyondTolerance(3, 3.6)).toBe(true)
    expect(lengthBeyondTolerance(20, 22)).toBe(false)
    expect(lengthBeyondTolerance(20, 22.5)).toBe(true)
    expect(lengthBeyondTolerance(20, null)).toBe(false)
  })
  it('device placement: rack, RU, face', () => {
    expect(deviceDeviations({ rackId: 'r1', rackCode: 'R01', ru: 10, face: 'front' }, { rackId: 'r1', ru: 12, face: 'rear' }).map((d) => d.field)).toEqual(['ru', 'face'])
    expect(deviceDeviations({ rackId: 'r1', ru: 10, face: 'front' }, { rackId: 'r1', ru: 10, face: 'front' })).toEqual([])
  })
  it('connection: port, media, SFP, cable ID and length per segment', () => {
    const design = {
      source: { portId: 'Gi1/0/1' },
      dest: { portId: 'P1' },
      media: 'copper_cat6a',
      sourceSfpCode: null,
      destSfpCode: null,
      segments: [
        { index: 0, cableId: 'C-001', effectiveM: 3 },
        { index: 1, cableId: 'C-002', effectiveM: 30 },
      ],
    }
    const found = connectionDeviations(design, {
      sourcePort: 'gi1/0/1',
      destPort: 'P2',
      media: 'copper_cat6a',
      segments: [
        { index: 0, cableId: 'C-001', installedM: 3.4 },
        { index: 1, cableId: 'C-009', installedM: 34 },
      ],
    })
    expect(found.map((d) => d.field)).toEqual(['dest_port', 'cable_id:1', 'length:1'])
    expect(found[2]).toMatchObject({ designedValue: '30 m', installedValue: '34 m', label: 'Length (cable 2)' })
  })
  it('a deviation logged as an exception (open or accepted) is handled; rejected is not', () => {
    const devs = [
      { field: 'ru', installedValue: '12' },
      { field: 'face', installedValue: 'rear' },
      { field: 'rack', installedValue: 'R02' },
    ]
    const ex = [
      { deviceId: 'd1', connectionId: null, field: 'ru', installedValue: '12', status: 'open' },
      { deviceId: 'd1', connectionId: null, field: 'face', installedValue: 'rear', status: 'rejected' },
      // Logged for another value: the installation changed since.
      { deviceId: 'd1', connectionId: null, field: 'rack', installedValue: 'R03', status: 'accepted' },
      { deviceId: 'd1', connectionId: 'c1', field: 'face', installedValue: 'rear', status: 'open' },
    ]
    expect(unhandledDeviations(devs, ex, { deviceId: 'd1' }).map((d) => d.field)).toEqual(['face', 'rack'])
  })
  it('re-saving closes exceptions: corrected when the deviation is gone, superseded when the value changed', () => {
    const ex = { field: 'ru', installedValue: '12' }
    expect(exceptionOutcome(ex, [])).toBe('corrected')
    expect(exceptionOutcome(ex, [{ field: 'ru', installedValue: '14' }])).toBe('superseded')
    expect(exceptionOutcome(ex, [{ field: 'ru', installedValue: '12' }])).toBeNull()
  })
})

describe('DGUV status on the organisation local date', () => {
  const today = '2026-10-14'
  it('only mains-powered devices have one; none recorded is overdue', () => {
    expect(dguvStatus({ lastInspectionDate: null, mainsPowered: false }, today)).toBeNull()
    expect(dguvStatus({ lastInspectionDate: null, mainsPowered: true }, today).status).toBe('overdue')
  })
  it('Valid / Expiring soon (≤90) / Expiring (≤30) / Overdue at the 48-month default', () => {
    expect(dguvStatus({ lastInspectionDate: '2026-01-01', mainsPowered: true }, today)).toMatchObject({ dueDate: '2030-01-01', status: 'valid' })
    expect(dguvStatus({ lastInspectionDate: '2022-12-01', mainsPowered: true }, today)).toMatchObject({ daysRemaining: 48, status: 'expiring_soon' })
    expect(dguvStatus({ lastInspectionDate: '2022-11-13', mainsPowered: true }, today)).toMatchObject({ daysRemaining: 30, status: 'expiring' })
    expect(dguvStatus({ lastInspectionDate: '2022-10-13', mainsPowered: true }, today)).toMatchObject({ daysRemaining: -1, status: 'overdue' })
  })
  it('intervals come from the organisation settings', () => {
    expect(dguvStatus({ lastInspectionDate: '2025-10-14', mainsPowered: true }, today, { intervalMonths: 12, expiringSoonDays: 60, expiringDays: 14 })).toMatchObject({ dueDate: '2026-10-14', daysRemaining: 0, status: 'expiring' })
  })
  it('the end of a short month clamps (31 Jan + 1 month = 28 Feb)', () => {
    expect(dguvStatus({ lastInspectionDate: '2026-01-31', mainsPowered: true }, today, { intervalMonths: 1 }).dueDate).toBe('2026-02-28')
  })
  it('mains power from the catalogue: power inlet or PSUs', () => {
    expect(isMainsPowered({ powerInletType: 'C14' })).toBe(true)
    expect(isMainsPowered({ psuCount: 2 })).toBe(true)
    expect(isMainsPowered({ psuCount: 0 })).toBe(false)
    expect(isMainsPowered(null)).toBe(false)
  })
})

describe('pipeline and phase statuses', () => {
  const devices = [{ status: 'delivered' }, { status: 'installed' }, { status: 'tested' }, { status: 'accepted' }]
  const connections = [{ status: 'approved' }, { status: 'installed' }, { status: 'tested' }, { status: 'faulty' }]
  it('planned → installed → tested → remaining', () => {
    const s = pipelineStats(devices, connections)
    expect(s.devices).toEqual({ planned: 4, installed: 3, tested: 2, accepted: 1, remaining: 1 })
    expect(s.connections).toEqual({ planned: 4, installed: 3, tested: 1, faulty: 1, remaining: 1 })
    expect(s.progress).toBe(25)
  })
  it('deployment and CMDB phase statuses', () => {
    expect(deploymentPhaseStatus([{ status: 'delivered' }])).toBe('not_started')
    expect(deploymentPhaseStatus(devices)).toBe('in_progress')
    expect(deploymentPhaseStatus([{ status: 'accepted' }, { status: 'in_service' }])).toBe('completed')
    expect(cmdbPhaseStatus(4, 0)).toBe('not_started')
    expect(cmdbPhaseStatus(4, 1)).toBe('in_progress')
    expect(cmdbPhaseStatus(4, 4)).toBe('completed')
  })
})

describe('delivery gating line', () => {
  it('serialised devices on their own line; passive items on the aggregated item line; carrier gear never', async () => {
    const { procurementLineKeyOf } = await import('./bomCalc.js')
    expect(procurementLineKeyOf({ id: 'd1', category: 'switch' }, { key: 'C9300-48P', category: 'switch' })).toBe('device:d1')
    expect(procurementLineKeyOf({ id: 'd2', catalogueKey: 'PP-24-C6A' }, { key: 'PP-24-C6A', category: 'patch_panel' })).toBe('item:pp-24-c6a')
    expect(procurementLineKeyOf({ id: 'd3', category: 'wan_sp_connection' }, null)).toBeNull()
    // A WAN circuit with no category stored is still the carrier's, never installed.
    expect(procurementLineKeyOf({ id: 'd4', role: 'wan_circuit', category: null, label: 'WAN 1' }, null)).toBeNull()
    expect(acceptanceBlockers({ serialised: false, serial: null, mainsPowered: false, openDeviations: 0, openExceptions: 0 })).toEqual([])
  })
})

describe('room checklist from the Bill of Resources tasks', () => {
  it('counts totals and done per room', async () => {
    const { roomChecklists } = await import('./deployment.js')
    const out = roomChecklists({
      devices: [
        { roomCode: 'R01', role: 'access', mainsPowered: true, dguvRecorded: true, rackId: 'k1', status: 'installed' },
        { roomCode: 'R01', role: 'access', mainsPowered: true, dguvRecorded: false, rackId: 'k1', status: 'delivered' },
        { roomCode: 'R01', passive: true, rackId: 'k1', status: 'installed' },
        { roomCode: 'R02', role: 'ap', mainsPowered: false, status: 'planned' },
      ],
      connections: [{ roomCode: 'R01', media: 'cat6a', status: 'tested' }, { roomCode: 'R01', media: 'om4', status: 'approved' }],
      racks: [{ id: 'k1', roomCode: 'R01' }],
    })
    expect(out.map((r) => r.room)).toEqual(['R01', 'R02'])
    const r1 = Object.fromEntries(out[0].tasks.map((t) => [t.id, [t.done, t.total]]))
    expect(r1).toEqual({ 'install-device': [1, 2], 'install-rack-accessory': [1, 2], 'patch-copper': [1, 1], 'patch-fibre': [0, 1], 'label-cable': [1, 2], 'test-link': [1, 2], 'dguv-inspection': [1, 2] })
    expect(out[1].tasks).toEqual([{ id: 'mount-ap', label: 'Mount AP', total: 1, done: 0 }])
  })
})
