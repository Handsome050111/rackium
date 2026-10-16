import { describe, it, expect } from 'vitest'
import { portKey, portOptions, suggestPort, portsOf, validateLld, diffDesigns, reconcileWithHld, routeSides, routeBookings, hopProblems, routeTrace, hopText, panelLabel, nextPanelLabel, duplicatePanelLabels, PANEL_LABEL_PATTERN, pairBookings, pairConflicts } from './lldDesign.js'
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
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '02' }])] }, ctxFor(all))).toEqual([])
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'p', inPort: '09', outPort: '01' }])] }, ctxFor(all)).map((f) => f.rule)).toEqual(['L-HOP'])
    expect(validateLld({ devices: all, connections: [conn([{ seq: 1, patchPanelId: 'zz', inPort: '01', outPort: '01' }])] }, ctxFor(all))[0].message).toMatch(/not in this design/)
    const fibre = { ...conn([{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '02' }]), media: 'om4', source: { deviceId: 'e', portId: 'Te1/1/1' }, dest: { deviceId: 'e', portId: 'Te1/1/2' } }
    expect(validateLld({ devices: all, connections: [fibre] }, ctxFor(all)).find((f) => f.rule === 'L-HOP').message).toMatch(/RJ45 panel, the link is OM4/)
  })
})

describe('patch-panel sides by cable type (M4b review)', () => {
  // Patch cord (device↔panel) → panel FRONT; trunk (panel↔panel) → panel REAR.
  const panels = new Set(['pp1', 'pp2'])
  const isPanel = (id) => panels.has(String(id))
  const names = { edge: 'Edge', border: 'Border', ap: 'AP', pp1: 'PP-01', pp2: 'PP-02' }
  const nameOf = (id) => names[id]
  const keys = (conn) => routeBookings(conn, isPanel).map((b) => `${b.deviceId}:${portKey(b.portId, b.side)}`).sort()
  // The same route drawn from the other end.
  const reversed = (conn) => ({ ...conn, source: conn.dest, dest: conn.source, hops: [...conn.hops].reverse().map((h) => ({ ...h, inPort: h.outPort, outPort: h.inPort, inSide: h.outSide, outSide: h.inSide })) })

  const twoPanel = {
    source: { deviceId: 'edge', portId: 'Gi1/0/1' },
    dest: { deviceId: 'border', portId: 'Te1/1/1' },
    hops: [
      { seq: 1, patchPanelId: 'pp2', inPort: '01', outPort: '01' },
      { seq: 2, patchPanelId: 'pp1', inPort: '05', outPort: '05' },
    ],
  }
  const singlePanel = { source: { deviceId: 'edge', portId: 'Gi1/0/2' }, dest: { deviceId: 'ap', portId: 'Eth0' }, hops: [{ seq: 1, patchPanelId: 'pp1', inPort: '01', outPort: '02' }] }

  it('two panels: Edge → PP-02 front | PP-02 rear → PP-01 rear | PP-01 front → Border', () => {
    expect(routeSides(twoPanel, isPanel)).toEqual({ source: null, dest: null, hops: [{ inSide: 'front', outSide: 'rear' }, { inSide: 'rear', outSide: 'front' }] })
    expect(routeTrace(twoPanel, isPanel, nameOf)).toBe('Edge Gi1/0/1 → PP-02 01 front | PP-02 01 rear → PP-01 05 rear | PP-01 05 front → Border Te1/1/1')
    expect(keys(twoPanel)).toEqual(['border:te1/1/1', 'edge:gi1/0/1', 'pp1:05#front', 'pp1:05#rear', 'pp2:01#front', 'pp2:01#rear'])
    expect(hopProblems(twoPanel, isPanel, nameOf)).toEqual([])
  })

  it('two panels drawn from the Border end take exactly the same sides', () => {
    const back = reversed(twoPanel)
    expect(routeSides(back, isPanel).hops).toEqual([{ inSide: 'front', outSide: 'rear' }, { inSide: 'rear', outSide: 'front' }])
    expect(keys(back)).toEqual(keys(twoPanel))
    expect(routeTrace(back, isPanel, nameOf)).toBe('Border Te1/1/1 → PP-01 05 front | PP-01 05 rear → PP-02 01 rear | PP-02 01 front → Edge Gi1/0/1')
  })

  it('one panel between two devices: both patch cords on the front, two ports — from either end', () => {
    expect(routeSides(singlePanel, isPanel).hops).toEqual([{ inSide: 'front', outSide: 'front' }])
    expect(keys(singlePanel)).toEqual(['ap:eth0', 'edge:gi1/0/2', 'pp1:01#front', 'pp1:02#front'])
    expect(keys(reversed(singlePanel))).toEqual(keys(singlePanel))
    expect(hopProblems(singlePanel, isPanel, nameOf)).toEqual([])
    expect(hopText(singlePanel.hops[0], { inSide: 'front', outSide: 'front' }, 'PP-01')).toBe('PP-01 01 front | 02 front')
    expect(hopText(twoPanel.hops[0], { inSide: 'front', outSide: 'rear' }, 'PP-02')).toBe('PP-02 01 front | rear')
  })

  it('a cable ending on a panel: a patch cord lands on the front, a trunk between two panels on both rears', () => {
    const cord = { source: { deviceId: 'edge', portId: 'Gi1/0/3' }, dest: { deviceId: 'pp1', portId: '07' }, hops: [] }
    expect(routeSides(cord, isPanel)).toMatchObject({ source: null, dest: 'front' })
    expect(keys(reversed(cord))).toEqual(keys(cord))
    const trunk = { source: { deviceId: 'pp1', portId: '08' }, dest: { deviceId: 'pp2', portId: '08' }, hops: [] }
    expect(keys(trunk)).toEqual(['pp1:08#rear', 'pp2:08#rear'])
  })

  it('invalid hops: wrong side for the cable type; front and rear of different ports; one port for both cords; a port side twice', () => {
    const wrongSide = { ...singlePanel, hops: [{ ...singlePanel.hops[0], inSide: 'rear' }] }
    expect(hopProblems(wrongSide, isPanel, nameOf).map((p) => p.message)).toEqual(['hop 1 (PP-01): 01 is on the rear, but a patch cord (device to panel) lands on the front'])
    const trunkOnFront = { ...twoPanel, hops: [{ ...twoPanel.hops[0], outSide: 'front' }, twoPanel.hops[1]] }
    expect(hopProblems(trunkOnFront, isPanel, nameOf)[0].message).toMatch(/a trunk \(panel to panel\) lands on the rear/)
    const split = { ...twoPanel, hops: [{ ...twoPanel.hops[0], outPort: '02' }, twoPanel.hops[1]] }
    expect(hopProblems(split, isPanel, nameOf).map((p) => p.message)).toEqual(['hop 1 (PP-02): front and rear must be the same port — 01 front and 02 rear are not connected'])
    const onePort = { ...singlePanel, hops: [{ ...singlePanel.hops[0], outPort: '01' }] }
    expect(hopProblems(onePort, isPanel, nameOf).map((p) => p.message)).toEqual(['hop 1 (PP-01): 01 front cannot take both cables — use two ports'])
    const twice = { ...twoPanel, hops: [...twoPanel.hops, { seq: 3, patchPanelId: 'pp2', inPort: '01', outPort: '01' }] }
    expect(hopProblems(twice, isPanel, nameOf).some((p) => /PP-02 01 rear is used twice/.test(p.message))).toBe(true)
  })

  it('validateLld reports a wrong side as a Critical L-HOP', () => {
    const devices = [
      { id: 'e', hostname: 'E-1', role: 'edge', catalogueKey: 'edge' },
      { id: 'a', hostname: 'A-1', role: 'ap', catalogueKey: 'ap' },
      { id: 'p', label: 'PP-01', catalogueKey: 'panel', isPanel: true },
    ]
    const conn = { id: 'c', source: { deviceId: 'e', portId: 'Gi1/0/1' }, dest: { deviceId: 'a', portId: 'Eth0' }, media: 'cat6a', speed: '1G', cableId: 'X', hops: [{ seq: 1, patchPanelId: 'p', inPort: '01', inSide: 'rear', outPort: '02', outSide: 'front' }] }
    const findings = validateLld({ devices, connections: [conn] }, ctxFor(devices))
    expect(findings.map((f) => [f.rule, f.severity])).toEqual([['L-HOP', 'critical']])
    expect(findings[0].message).toMatch(/01 is on the rear, but a patch cord/)
  })
})

describe('panel labels: room-qualified and unique per building', () => {
  it('PP-<room>-<rack>-NN, hostname-safe; the next free number; duplicates found ignoring case', () => {
    expect(panelLabel({ room: 'TR-EG-01', rack: 'R01', seq: 1 })).toBe('PP-TR-EG-01-R01-01')
    expect(panelLabel({ prefix: 'CM', room: 'tr 2.og/01', rack: 'r02', seq: 12 })).toBe('CM-TR-2-OG-01-R02-12')
    expect(PANEL_LABEL_PATTERN.test(panelLabel({ room: 'Ü-Raum 1', rack: 'R 1', seq: 3 }))).toBe(true)
    // Two rooms with an R01 each no longer collide.
    expect(panelLabel({ room: 'TR-EG-01', rack: 'R01', seq: 1 })).not.toBe(panelLabel({ room: 'TR-EG-02', rack: 'R01', seq: 1 }))
    expect(nextPanelLabel({ room: 'TR-EG-01', rack: 'R01' }, ['pp-tr-eg-01-r01-01', 'PP-TR-EG-01-R01-03'])).toBe('PP-TR-EG-01-R01-02')
    expect(duplicatePanelLabels([{ id: 'a', label: 'PP-X-R01-01' }, { id: 'b', label: 'pp-x-r01-01' }, { id: 'c', label: 'PP-X-R01-02' }])).toEqual([{ label: 'PP-X-R01-01', ids: ['a', 'b'] }])
  })
})

describe('one connection per panel port (front and rear never split)', () => {
  const isPanel = (id) => ['pp1', 'pp2'].includes(String(id))
  const twoPanel = { source: { deviceId: 'edge', portId: 'Gi1/0/1' }, dest: { deviceId: 'border', portId: 'Te1/1/1' }, hops: [{ patchPanelId: 'pp2', inPort: '01', outPort: '01' }, { patchPanelId: 'pp1', inPort: '05', outPort: '05' }] }

  it('a route books one pair key per panel port', () => {
    expect(pairBookings(routeBookings(twoPanel, isPanel)).map((p) => `${p.deviceId}:${p.portKey}`)).toEqual(['pp2:01#pair', 'pp1:05#pair'])
  })

  it('refuses a panel side whose other side another connection uses; its own rows and legacy cabling are fine', () => {
    const cord = { source: { deviceId: 'edge', portId: 'Gi1/0/2' }, dest: { deviceId: 'pp1', portId: '05' }, hops: [] } // front of 05
    const trunkOnRear = [{ deviceId: 'pp1', portKey: '05#rear', connectionId: 'c-trunk', source: 'connection' }]
    const conflicts = pairConflicts(routeBookings(cord, isPanel), trunkOnRear, { connectionId: 'c-cord', nameOf: (id) => id.toUpperCase(), connectionName: (id) => `connection ${id}` })
    expect(conflicts.map((c) => c.message)).toEqual(["PP1 port 05: its rear is already used by connection c-trunk — a panel port's front and rear belong to one connection; add this route to that connection as a hop instead"])
    expect(pairConflicts(routeBookings(cord, isPanel), trunkOnRear, { connectionId: 'c-trunk' })).toEqual([])
    expect(pairConflicts(routeBookings(cord, isPanel), [{ ...trunkOnRear[0], connectionId: null, source: 'pre_occupied' }], { connectionId: 'c-cord' })).toEqual([])
  })

  it('suggestions skip a panel port another connection holds on either side', () => {
    const ports = [1, 2].map((n) => ({ id: `0${n}`, n, type: 'RJ45', role: 'access' }))
    const options = portOptions(ports, { media: 'cat6a', side: 'front', occupiedKeys: new Set(['01#pair']) })
    expect(options.map((o) => o.occupied)).toEqual([true, false])
    expect(suggestPort(options)).toBe('02')
  })

  it('validateLld: L-PANEL-PAIR when front and rear are in two connections; L-PANEL-LABEL for a repeated label', () => {
    const devices = [
      { id: 'e', hostname: 'E-1', role: 'edge', catalogueKey: 'edge' },
      { id: 'a', hostname: 'A-1', role: 'ap', catalogueKey: 'ap' },
      { id: 'p', label: 'PP-X-R01-01', catalogueKey: 'panel', isPanel: true },
      { id: 'q', label: 'PP-X-R01-01', catalogueKey: 'panel', isPanel: true },
    ]
    const cord = { id: 'c1', source: { deviceId: 'e', portId: 'Gi1/0/1' }, dest: { deviceId: 'p', portId: '01' }, media: 'cat6a', speed: '1G', cableId: 'A', hops: [] }
    const trunk = { id: 'c2', source: { deviceId: 'p', portId: '01' }, dest: { deviceId: 'q', portId: '01' }, media: 'cat6a', speed: '1G', cableId: 'B', hops: [] }
    const findings = validateLld({ devices, connections: [cord, trunk] }, ctxFor(devices))
    expect(findings.filter((f) => f.rule.startsWith('L-PANEL')).map((f) => [f.rule, f.message])).toEqual([
      ['L-PANEL-LABEL', 'PP-X-R01-01 is used by 2 patch panels in this building'],
      ['L-PANEL-PAIR', 'PP-X-R01-01 port 01: front and rear are in 2 different connections — make it one connection with a hop'],
    ])
  })
})

describe('panel labels and surveyed gear (fix/cmo-naming-gaps)', () => {
  const panel = (id, fields) => ({ id, catalogueKey: 'panel', isPanel: true, ...fields })
  const panelFindings = (devices) => validateLld({ devices, connections: [] }, ctxFor(devices)).filter((f) => f.rule.startsWith('L-PANEL-LABEL'))

  it("a surveyed panel's library name is not a label: two surveyed panels of the same type raise nothing", () => {
    const devices = [panel('s1', { origin: 'existing', label: '24-port patch panel' }), panel('s2', { origin: 'existing', label: '24-port patch panel' })]
    expect(panelFindings(devices)).toEqual([])
  })

  it('two surveyed panels with the same recorded label raise nothing either — the Architect could not change them', () => {
    const devices = [panel('s1', { origin: 'existing', label: 'VT-A', existingLabel: 'VT-A' }), panel('s2', { origin: 'existing', label: 'VT-A', existingLabel: 'vt-a' })]
    expect(panelFindings(devices)).toEqual([])
  })

  it('planned panels with the same label are still Critical', () => {
    const devices = [panel('p1', { origin: 'planned', label: 'PP-TR-1-R01-01' }), panel('p2', { origin: 'planned', label: 'pp-tr-1-r01-01' })]
    expect(panelFindings(devices).map((f) => [f.rule, f.severity, f.objectId, f.message])).toEqual([['L-PANEL-LABEL', 'critical', 'p1', 'PP-TR-1-R01-01 is used by 2 patch panels in this building']])
  })

  it("a planned panel with an existing panel's recorded label is a Warning on the planned panel, with where the existing one is", () => {
    const devices = [
      panel('s1', { origin: 'existing', label: 'VT-A-01', existingLabel: 'VT-A-01', roomCode: 'TR-EG-01', rackCode: 'R01', ru: 10 }),
      panel('p1', { origin: 'planned', label: 'vt-a-01' }),
      // A surveyed panel without a recorded label never takes part.
      panel('s2', { origin: 'existing', label: 'PP-TR-EG-01-R01-01' }),
      panel('p2', { origin: 'planned', label: 'PP-TR-EG-01-R01-01' }),
    ]
    const findings = panelFindings(devices)
    expect(findings.map((f) => [f.rule, f.severity, f.objectId])).toEqual([['L-PANEL-LABEL-EXISTING', 'warning', 'p1']])
    expect(findings[0].message).toBe('vt-a-01 is also the label recorded on an existing panel (TR-EG-01 rack R01 RU10) — rename the planned panel so the two cannot be confused on site')
    // Warnings do not block a submit.
    expect(findings.every((f) => f.severity !== 'critical')).toBe(true)
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
