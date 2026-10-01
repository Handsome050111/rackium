import { describe, it, expect } from 'vitest'
import { buildNetworkDeviceLines, buildOpticsLines, buildCableLines, buildPowerAccessoryLines, buildBom, reconcileDeviceCounts } from './bomModel.js'

const devices = [
  { id: 'd1', role: 'fusion', model: 'Cisco C9500', roomId: 'r0', roomCode: 'UG1705' },
  { id: 'd2', role: 'border', model: 'Cisco C9500', roomId: 'r0', roomCode: 'UG1705' },
  { id: 'd3', role: 'wan-circuit', model: 'Telekom SD-WAN CPE', roomId: 'r0', roomCode: 'UG1705' },
  { id: 'd4', role: 'edge', model: 'Cisco C9300-48UX', roomId: 'r1', roomCode: 'TR-EG-01' },
  { id: 'd5', role: 'edge', model: 'Cisco C9300-48UX', roomId: 'r2', roomCode: 'TR-EG-02' },
  { id: 'd6', role: 'ap', model: 'Cisco Catalyst 9130AXI', roomId: 'r1', roomCode: 'TR-EG-01' },
  { id: 'd7', role: 'ap', model: 'Cisco Catalyst 9130AXI', roomId: 'r2', roomCode: 'TR-EG-02' },
]

describe('buildNetworkDeviceLines', () => {
  it('excludes the WAN circuit — Telekom-provided, not procured by Technonex', () => {
    const { lines } = buildNetworkDeviceLines(devices)
    expect(lines.some((l) => l.spec === 'Telekom SD-WAN CPE')).toBe(false)
  })

  it('groups devices by role with a real count, not a fabricated one', () => {
    const { lines } = buildNetworkDeviceLines(devices)
    const edge = lines.find((l) => l.key === 'device:edge')
    expect(edge.qty).toBe(2)
    const ap = lines.find((l) => l.key === 'device:ap')
    expect(ap.qty).toBe(2)
  })

  it('always includes the static probe-device line (brief D36: project requirement, not derived)', () => {
    const { lines } = buildNetworkDeviceLines(devices)
    const probe = lines.find((l) => l.key === 'device:probe')
    expect(probe).toBeTruthy()
    expect(probe.basis).toBe('Project requirement')
  })
})

describe('buildOpticsLines', () => {
  it('tallies 2 SFPs per link (one per end)', () => {
    const connections = [
      { sourceSfp: 'SFP-10G-LR', destSfp: 'SFP-10G-LR' },
      { sourceSfp: 'SFP-10G-LR', destSfp: 'SFP-10G-LR' },
    ]
    const { lines } = buildOpticsLines(connections)
    const lr = lines.find((l) => l.item === 'SFP-10G-LR')
    expect(lr.qty).toBe(4)
    expect(lr.basis).toBe('2 links × 2 ends')
  })

  it('ignores Cat6A connections — no SFP applies to RJ45 copper', () => {
    const connections = [{ sourceSfp: null, destSfp: null }]
    const { lines } = buildOpticsLines(connections)
    expect(lines).toHaveLength(0)
  })
})

describe('buildCableLines', () => {
  it('groups connections by media + Engineer Selected length into one procurement line', () => {
    const rows = [
      { media: 'om4', mediaLabel: 'OM4 MM', length: { effective: 2 } },
      { media: 'om4', mediaLabel: 'OM4 MM', length: { effective: 2 } },
      { media: 'os2', mediaLabel: 'OS2 SM', length: { effective: 50 } },
    ]
    const { lines } = buildCableLines(rows)
    expect(lines).toHaveLength(2)
    const om4 = lines.find((l) => l.item.includes('OM4'))
    expect(om4.qty).toBe(2)
    expect(om4.spec).toBe('2 m')
  })

  it('flags a line as pending when the length has not resolved yet', () => {
    const rows = [{ media: 'os2', mediaLabel: 'OS2 SM', length: { effective: null } }]
    const { lines } = buildCableLines(rows)
    expect(lines[0].status).toBe('Compatibility check')
    expect(lines[0].unitPrice).toBeNull()
  })
})

describe('buildPowerAccessoryLines', () => {
  it('computes PSU/cord/cage-nut quantities only from rack-mounted devices, excluding the AP', () => {
    const { lines, calc } = buildPowerAccessoryLines(devices)
    const psu = lines.find((l) => l.key === 'power:psu')
    // fusion + border + 2 edges = 4 wired switches in this fixture x2 PSU = 8
    expect(psu.qty).toBe(8)
    expect(psu.basis).toBe('4 wired switches × 2')
    expect(calc.some((c) => c.startsWith('PSUs:'))).toBe(true)
  })

  it('never counts an AP towards cage-nut sets — it is ceiling-mounted, not rack-mounted', () => {
    const { lines } = buildPowerAccessoryLines(devices)
    const cageNuts = lines.find((l) => l.key === 'power:cage-nuts')
    // fusion + border + 2 edges = 4 rack-mounted devices x4 mounting points = 16
    expect(cageNuts.qty).toBe(16)
  })

  it('reports 0 stack cables when every room has exactly one Edge switch', () => {
    const { lines } = buildPowerAccessoryLines(devices)
    const stack = lines.find((l) => l.key === 'power:stack-cable')
    expect(stack.qty).toBe(0)
    expect(stack.status).toBe('Not required')
    expect(stack.basis).toMatch(/one switch per room/)
  })

  it('computes a genuine non-zero stack-cable count when two Edges do share a room', () => {
    const stackedDevices = [...devices, { id: 'd8', role: 'edge', model: 'Cisco C9300-48UX', roomId: 'r1', roomCode: 'TR-EG-01' }]
    const { lines } = buildPowerAccessoryLines(stackedDevices)
    const stack = lines.find((l) => l.key === 'power:stack-cable')
    expect(stack.qty).toBe(1)
    expect(stack.status).toBe('Calculated')
  })
})

describe('reconcileDeviceCounts', () => {
  it('reconciles when BOM device-line quantities match the real device count (excl. WAN circuit and the static probe)', () => {
    const bom = buildBom(devices, [], [])
    const result = reconcileDeviceCounts(devices, bom)
    expect(result.realCount).toBe(6) // 7 devices minus the 1 WAN circuit
    expect(result.bomCount).toBe(6)
    expect(result.reconciled).toBe(true)
  })
})
