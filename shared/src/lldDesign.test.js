import { describe, it, expect } from 'vitest'
import { portKey, portOptions, suggestPort, portsOf, validateLld, diffDesigns, reconcileWithHld } from './lldDesign.js'
import { connectionFindings, portSuitsMedia } from './hldRules.js'
import { computeSuggestedLength, stockLengthsFor, DEFAULT_STOCK_LENGTHS } from './cableLength.js'

const ITEMS = {
  edge: { vendor: 'Cisco', model: 'C9300', category: 'switch', rackMounted: true, heightU: 1, portMap: { groups: [{ role: 'access', type: 'RJ45', speed: '1G', count: 4, start: 1, pattern: 'Gi1/0/{n}' }, { role: 'module', type: 'SFP+', speed: '10G', count: 2, start: 1, pattern: 'Te1/1/{n}' }] }, compatibleSfps: [] },
  panel: { vendor: 'Generic', model: 'PP', category: 'patch_panel', rackMounted: true, heightU: 1, portMap: { groups: [{ role: 'access', type: 'RJ45', count: 4, start: 1, pattern: '{n:2}' }] } },
  ap: { vendor: 'Cisco', model: 'AP', category: 'ap', rackMounted: false, heightU: 0, portMap: { groups: [{ role: 'uplink', type: 'RJ45', speed: '1G', count: 1, start: 0, pattern: 'Eth{n}' }] } },
}
const ctxFor = (devices) => ({
  deviceById: new Map(devices.map((d) => [String(d.id), d])),
  itemOf: (d) => ITEMS[d.catalogueKey] ?? null,
  opticOf: () => null,
  patchPanelFreePorts: () => null,
})

describe('ports (Rackium Editor)', () => {
  it('patch-panel ports have a rear and a front; device ports one side; keys are case-insensitive', () => {
    expect(portKey('Te1/1/1')).toBe(portKey('TE1/1/1'))
    expect(portKey('01', 'rear')).not.toBe(portKey('01', 'front'))
  })

  it('options mark occupied and incompatible ports; the suggestion is the first free compatible one, never assigned', () => {
    const ports = portsOf(ITEMS.edge)
    const options = portOptions(ports, { media: 'cat6a', occupiedKeys: new Set([portKey('Gi1/0/1')]) })
    expect(options.slice(0, 2).map((o) => [o.id, o.occupied, o.compatible])).toEqual([
      ['Gi1/0/1', true, true],
      ['Gi1/0/2', false, true],
    ])
    expect(options.find((o) => o.id === 'Te1/1/1').compatible).toBe(false)
    expect(suggestPort(options)).toBe('Gi1/0/2')
    expect(suggestPort(portOptions(ports, { media: 'os2' }))).toBe('Te1/1/1')
  })

  it('a surveyed patch panel without a model gets numbered ports from its label', () => {
    expect(portsOf(null, { category: 'Patch panels', label: '48-port patch panel' })).toHaveLength(48)
    expect(portsOf(null, { label: 'Fibre patch panel' })[0]).toMatchObject({ id: '01', type: 'LC' })
  })

  it('VAL-001 covers the port type: Cat6A on an SFP cage, fibre on RJ45', () => {
    expect(portSuitsMedia('RJ45', 'cat6a')).toBe(true)
    expect(portSuitsMedia('SFP+', 'cat6a')).toBe(false)
    expect(portSuitsMedia('RJ45', 'om4')).toBe(false)
    expect(portSuitsMedia('LC', 'os2')).toBe(true)
    const devices = [{ id: 'e', hostname: 'E-1', role: 'edge', catalogueKey: 'edge' }, { id: 'a', hostname: 'A-1', role: 'ap', catalogueKey: 'ap' }]
    const conn = { id: 'c', source: { deviceId: 'e', portId: 'Te1/1/1' }, dest: { deviceId: 'a', portId: 'Eth0' }, media: 'cat6a', speed: '1G', lengthM: 3 }
    expect(connectionFindings(conn, ctxFor(devices)).map((f) => f.rule).filter((r) => r.startsWith('VAL'))).toEqual(['VAL-001'])
  })
})

describe('LLD validation (on top of the HLD rules)', () => {
  const edge = { id: 'e', hostname: 'E-1', role: 'edge', origin: 'planned', catalogueKey: 'edge', rackId: 'k', ru: 10, heightU: 1 }
  const ap = { id: 'a', hostname: 'A-1', role: 'ap', origin: 'planned', catalogueKey: 'ap' }
  const panel = { id: 'p', label: 'PP-01', origin: 'planned', catalogueKey: 'panel', rackId: 'k', ru: 12, heightU: 1 }

  it('ports, cable IDs and RU placement are mandatory; APs need no rack', () => {
    const unplaced = { ...edge, rackId: null, ru: null }
    const conn = { id: 'c', source: { deviceId: 'e', portId: null }, dest: { deviceId: 'a', portId: 'Eth0' }, media: 'cat6a', speed: '1G', cableId: null, hops: [] }
    const findings = validateLld({ devices: [unplaced, ap], connections: [conn] }, ctxFor([unplaced, ap]))
    expect(findings.map((f) => f.rule).sort()).toEqual(['L-CABLE-ID', 'L-PLACEMENT', 'L-PORT'])
    expect(findings.every((f) => f.severity === 'critical')).toBe(true)
    const racked = validateLld({ devices: [{ ...edge, ru: null }], connections: [] }, ctxFor([edge]))
    expect(racked.map((f) => f.message)).toEqual(['E-1 has a rack but no RU'])
  })

  it('a hop must name a panel of the design, its real ports and a panel for the medium', () => {
    const conn = (hops) => ({ id: 'c', source: { deviceId: 'e', portId: 'Gi1/0/1' }, dest: { deviceId: 'a', portId: 'Eth0' }, media: 'cat6a', speed: '1G', cableId: 'X', hops })
    const all = [edge, ap, panel]
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '01' }])] }, ctxFor(all))).toEqual([])
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'p', inPort: '09', outPort: '01' }])] }, ctxFor(all)).map((f) => f.rule)).toEqual(['L-HOP'])
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'zz', inPort: '01', outPort: '01' }])] }, ctxFor(all))[0].message).toMatch(/not in this design/)
    const fibre = { ...conn([{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '01' }]), media: 'om4', source: { deviceId: 'e', portId: 'Te1/1/1' }, dest: { deviceId: 'e', portId: 'Te1/1/2' } }
    expect(validateLld({ devices: all, connections: [fibre] }, ctxFor(all)).find((f) => f.rule === 'L-HOP').message).toMatch(/RJ45 panel, the link is OM4/)
  })
})

describe('version diff and HLD reconciliation', () => {
  it('diffs two snapshots: devices and connections added, removed and changed, with labels', () => {
    const before = {
      devices: [{ id: 'd1', hostname: 'E-1', ru: 10 }, { id: 'd2', hostname: 'A-1' }],
      connections: [{ id: 'c1', source: { deviceId: 'd1', portId: 'Gi1/0/1' }, dest: { deviceId: 'd2', portId: 'Eth0' }, media: 'cat6a', cableId: '26184735', hops: [] }],
    }
    const after = {
      devices: [{ id: 'd1', hostname: 'E-1', ru: 12 }, { id: 'd3', hostname: 'PP-1' }],
      connections: [{ id: 'c1', source: { deviceId: 'd1', portId: 'Gi1/0/2' }, dest: { deviceId: 'd2', portId: 'Eth0' }, media: 'cat6a', cableId: '26184735', hops: [{ seq: 1, patchPanelId: 'd3', inPort: '01', outPort: '01' }] }],
    }
    const diff = diffDesigns(before, after)
    expect(diff.devices.added.map((d) => d.label)).toEqual(['PP-1'])
    expect(diff.devices.removed.map((d) => d.label)).toEqual(['A-1'])
    expect(diff.devices.changed).toEqual([{ id: 'd1', label: 'E-1', fields: [{ field: 'ru', before: 10, after: 12 }] }])
    expect(diff.connections.changed[0].fields.map((f) => f.field)).toEqual(['source', 'hops'])
    expect(diff.connections.changed[0].label).toBe('E-1 Gi1/0/2 → ? Eth0')
    expect(diff.total).toBe(4)
    expect(diffDesigns(after, after).total).toBe(0)
  })

  it('reconciles the LLD with a newer HLD through each item’s hldRef', () => {
    const hld = {
      devices: [{ id: 'h-b', hostname: 'B-1', role: 'border', catalogueKey: 'C9500', roomId: 'r1' }, { id: 'h-e', hostname: 'E-1', role: 'edge', catalogueKey: 'C9300', roomId: 'r2' }, { id: 'h-fw', hostname: 'FW-1', role: 'firewall', roomId: 'r1' }],
      connections: [{ id: 'h-c1', source: { deviceId: 'h-b' }, dest: { deviceId: 'h-e' }, media: 'os2', speed: '10G' }, { id: 'h-c2', source: { deviceId: 'h-fw' }, dest: { deviceId: 'h-b' }, media: 'om4', speed: '10G' }],
    }
    const lld = {
      devices: [
        { id: 'l-b', hldRef: 'h-b', hostname: 'B-1', role: 'border', catalogueKey: 'C9500', roomId: 'r1' },
        { id: 'l-e', hldRef: 'h-e', hostname: 'E-1', role: 'edge', catalogueKey: 'C9300X', roomId: 'r2' },
        { id: 'l-a', hldRef: 'h-a-gone', hostname: 'A-1', role: 'ap', roomId: 'r2' },
        { id: 'l-pp', hldRef: null, label: 'PP-01' },
      ],
      connections: [{ id: 'l-c1', hldRef: 'h-c1', source: { deviceId: 'l-b' }, dest: { deviceId: 'l-e' }, media: 'om4', speed: '10G' }],
    }
    const r = reconcileWithHld(hld, lld)
    expect(r.devices.inHldOnly.map((d) => d.label)).toEqual(['FW-1'])
    expect(r.devices.inLldOnly.map((d) => d.label)).toEqual(['A-1'])
    expect(r.devices.changed).toEqual([{ id: 'h-e', label: 'E-1', fields: [{ field: 'catalogueKey', before: 'C9300', after: 'C9300X' }] }])
    expect(r.connections.inHldOnly.map((c) => c.label)).toEqual(['FW-1 → B-1'])
    expect(r.connections.changed[0].fields).toEqual([{ field: 'media', before: 'os2', after: 'om4' }])
    expect(r.total).toBe(5)
  })
})

describe('stock lengths are an organisation table', () => {
  it('defaults to the brief; an organisation table changes the rounding and the custom-length point', () => {
    expect(DEFAULT_STOCK_LENGTHS.os2).toEqual([5, 10, 15, 30, 50, 100, 200, 500])
    expect(stockLengthsFor('cat6a', 'same-room')).toEqual([3, 5, 7, 10, 15])
    const cross = { source: { roomId: 'a' }, dest: { roomId: 'b', surveyedPathwayLength: 40 }, media: 'os2' }
    expect(computeSuggestedLength(cross)).toMatchObject({ rawMeters: 42, suggested: 50 })
    const table = { ...DEFAULT_STOCK_LENGTHS, os2: [25, 45] }
    expect(computeSuggestedLength({ ...cross, stockLengths: table })).toMatchObject({ suggested: 45, customLengthRequired: false })
    expect(computeSuggestedLength({ ...cross, stockLengths: { ...table, os2: [25] } })).toMatchObject({ suggested: null, customLengthRequired: true })
    expect(stockLengthsFor('os2', 'cross-room', table)).toEqual([25, 45])
  })
})
