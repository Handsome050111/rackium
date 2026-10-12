import { describe, it, expect } from 'vitest'
import { buildBom, bomImpact, withMargin, unitPriceOf } from './bomCalc.js'
import { selectPowerCord, COUNTRY_PLUG_TABLE } from './powerCords.js'
import { procurementProblem, nextStatuses, PROCUREMENT_STATUSES } from './procurement.js'
import { evaluatePackage, groupStatus, REQUIRED_INPUT_GROUPS, SECTIONS } from './solutionPackage.js'
import { buildResourceEstimate } from './billOfResources.js'

const CATALOGUE = [
  { kind: 'device_model', key: 'Cisco C9300', model: 'C9300', vendor: 'Cisco', category: 'switch', rackMounted: true, heightU: 1, psuCount: 2, powerInletType: 'C14', needsUplinkModule: true, compatibleModules: ['Cisco NM-8X'], compatiblePsus: ['Cisco PWR-715'], unitPriceMinor: 420000, currency: 'EUR' },
  { kind: 'device_model', key: 'Cisco C9500', model: 'C9500', vendor: 'Cisco', category: 'switch', rackMounted: true, heightU: 1, psuCount: 2, powerInletType: 'C14', compatiblePsus: ['Cisco PWR-715'], unitPriceMinor: 850000, currency: 'EUR' },
  { kind: 'device_model', key: 'Cisco AP', model: 'AP', vendor: 'Cisco', category: 'ap', rackMounted: false, heightU: 0, unitPriceMinor: null, currency: 'EUR' },
  { kind: 'device_model', key: 'Generic PP24', model: 'PP24', vendor: 'Generic', category: 'patch_panel', rackMounted: true, heightU: 1, unitPriceMinor: 5000, currency: 'EUR' },
  { kind: 'device_model', key: 'Generic WAN', model: 'WAN', vendor: 'Generic', category: 'wan_sp_connection', rackMounted: false, heightU: 0, currency: 'EUR' },
  { kind: 'consumable', key: 'Cisco NM-8X', model: 'NM-8X', vendor: 'Cisco', category: 'accessory', unitPriceMinor: 78000, currency: 'EUR' },
  { kind: 'consumable', key: 'Cisco PWR-715', model: 'PWR-715', vendor: 'Cisco', category: 'accessory', unitPriceMinor: 31000, currency: 'USD' },
  { kind: 'optic', key: 'Cisco SFP-10G-LR', model: 'SFP-10G-LR', vendor: 'Cisco', category: 'accessory', mediaSpeed: { media: 'os2', speed: '10G', reachM: 10000 }, unitPriceMinor: 18000, currency: 'EUR' },
  { kind: 'stock_cable', key: 'Generic Cat6A', model: 'Cat6A patch cord', vendor: 'Generic', category: 'cable', stock: { media: 'cat6a', pricePerMetreMinor: 150, minimumMinor: 500 }, currency: 'EUR' },
  { kind: 'stock_cable', key: 'Generic OS2', model: 'OS2 fibre patch cord', vendor: 'Generic', category: 'cable', stock: { media: 'os2', pricePerMetreMinor: 120, minimumMinor: 900 }, currency: 'EUR' },
  { kind: 'consumable', key: 'Generic Cord C13/C14', model: 'Power cord C13/C14', vendor: 'Generic', category: 'cable', powerCord: { connectorPair: 'C13/C14' }, unitPriceMinor: 600, currency: 'EUR' },
  { kind: 'consumable', key: 'Generic Cord Schuko/C13', model: 'Power cord Schuko/C13', vendor: 'Generic', category: 'cable', powerCord: { connectorPair: 'Schuko/C13' }, unitPriceMinor: 700, currency: 'EUR' },
  { kind: 'consumable', key: 'Generic M6', model: 'M6 cage-nut set', vendor: 'Generic', category: 'cage_nut', unitPriceMinor: 360, currency: 'EUR' },
]

const design = {
  devices: [
    { id: 'b', hostname: 'B-1', role: 'border', catalogueKey: 'Cisco C9500', roomCode: 'MAIN', rackId: 'r1', rackCode: 'R01', ru: 40, psuConfigured: 2, hldRef: 'h-b' },
    { id: 'e1', hostname: 'E-1', role: 'edge', catalogueKey: 'Cisco C9300', roomCode: 'TR1', rackId: 'r2', rackCode: 'R01', ru: 40, psuConfigured: 1, hldRef: 'h-e1' },
    { id: 'e2', hostname: 'E-2', role: 'edge', catalogueKey: 'Cisco C9300', roomCode: 'TR1', rackId: 'r2', rackCode: 'R01', ru: 38, psuConfigured: 2, hldRef: 'h-e2' },
    { id: 'a', hostname: 'A-1', role: 'ap', catalogueKey: 'Cisco AP', roomCode: 'TR1', hldRef: 'h-a' },
    { id: 'p', label: 'PP-TR1-R01-01', catalogueKey: 'Generic PP24', roomCode: 'TR1', rackId: 'r2', rackCode: 'R01', ru: 42 },
    { id: 'w', hostname: null, role: 'wan_circuit', catalogueKey: 'Generic WAN', hldRef: 'h-w' },
  ],
  connections: [
    { id: 'c1', hldRef: 'h-c1', source: { deviceId: 'b' }, dest: { deviceId: 'e1' }, media: 'os2', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-LR', cableId: 'C1', hops: [], lengths: { effectiveM: 50, engineerSelectedM: null } },
    { id: 'c2', hldRef: 'h-c2', source: { deviceId: 'b' }, dest: { deviceId: 'e2' }, media: 'os2', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-LR', cableId: 'C2', hops: [], lengths: { effectiveM: 47, engineerSelectedM: 47 } },
    { id: 'c3', hldRef: 'h-c3', source: { deviceId: 'e1' }, dest: { deviceId: 'a' }, media: 'cat6a', cableId: 'C3', hops: [{ patchPanelId: 'p', inPort: '01', outPort: '02' }], lengths: { effectiveM: 5, engineerSelectedM: null } },
    { id: 'c4', hldRef: null, source: { deviceId: 'e1' }, dest: { deviceId: 'e2' }, media: 'stack', cableId: 'S1', hops: [], lengths: { effectiveM: null } },
  ],
}
const context = (over = {}) => ({ stage: 'lld', racks: [{ id: 'r1', code: 'R01', cageNutType: null, pduSocketType: 'C13' }, { id: 'r2', code: 'R01', cageNutType: 'M6', pduSocketType: null }], catalogue: CATALOGUE, power: { customerStandard: null, countryCode: 'DE', cordLengthM: 2 }, currency: 'EUR', ...over })
const line = (bom, key) => bom.lines.find((l) => l.key === key)

describe('BOM quantities (brief §5.6)', () => {
  const bom = buildBom(design, context())

  it('serialised items: one line per device; the WAN circuit is not procured; a panel is a consumable', () => {
    const serial = bom.lines.filter((l) => l.lineType === 'serialised')
    expect(serial.map((l) => l.deviceId).sort()).toEqual(['a', 'b', 'e1', 'e2'])
    expect(line(bom, 'device:e1')).toMatchObject({ qty: 1, item: 'C9300', spec: 'E-1 · TR1 · R01 RU40', source: 'HLD', category: 'Network devices' })
    expect(line(bom, 'item:generic pp24')).toMatchObject({ lineType: 'consumable', qty: 1, source: 'LLD' })
    expect(bom.lines.some((l) => l.item === 'WAN')).toBe(false)
  })

  it('SFPs per link end, uplink modules per model that needs one, PSUs as configured', () => {
    expect(line(bom, 'optic:cisco sfp-10g-lr')).toMatchObject({ qty: 4, unitPriceMinor: 18000, lineTotalMinor: 72000 })
    expect(line(bom, 'item:cisco nm-8x')).toMatchObject({ qty: 2 })
    expect(line(bom, 'psu:cisco pwr-715')).toMatchObject({ qty: 5 }) // 2 + 1 + 2
  })

  it('cables at the Engineer Selected (else Suggested) length; a hop adds a patch cord at the shortest stock length', () => {
    expect(line(bom, 'cable:os2:50')).toMatchObject({ qty: 1, spec: '50 m', unitPriceMinor: 6000 })
    expect(line(bom, 'cable:os2:47')).toMatchObject({ qty: 1, spec: '47 m', unitPriceMinor: 5640 })
    // Cat6A same-rack stock starts at 0.3 m; the minimum price applies.
    expect(line(bom, 'cable:cat6a:5')).toMatchObject({ qty: 1, unitPriceMinor: 750 })
    expect(line(bom, 'cable:cat6a:0.3')).toMatchObject({ qty: 1, unitPriceMinor: 500 })
    expect(line(bom, 'cable:stack')).toMatchObject({ qty: 1, source: 'LLD' })
  })

  it('power cords: PDU socket in R01 (C13/C14), country table (Schuko) where the rack has no PDU socket; cage nuts per RU with the surveyed type', () => {
    expect(line(bom, 'cord:c13/c14')).toMatchObject({ qty: 2, source: 'Survey', unitPriceMinor: 600 })
    expect(line(bom, 'cord:schuko/c13')).toMatchObject({ qty: 3, source: 'HLD' })
    // Border 1U (R01, no type surveyed) + two Edges 1U and a panel 1U (R01 in TR1, M6).
    expect(line(bom, 'cage:m6').qty).toBe(4)
  })

  it('a customer standard overrides every cord', () => {
    const custom = buildBom(design, context({ power: { customerStandard: { label: '2 m C13/C14 black', connectorPair: 'C13/C14' }, countryCode: 'DE', cordLengthM: 2 } }))
    expect(custom.lines.filter((l) => l.key.startsWith('cord:')).map((l) => [l.key, l.qty])).toEqual([['cord:c13/c14', 5]])
  })

  it('pricing: not priced and other-currency lines are flagged and kept out of the total; margin on the total', () => {
    expect(line(bom, 'device:a')).toMatchObject({ priced: false, status: 'Not priced', priceNote: 'Not priced in the catalogue' })
    expect(line(bom, 'psu:cisco pwr-715')).toMatchObject({ priced: false, priceNote: 'Priced in USD, not EUR' })
    expect(bom.unpricedCount).toBeGreaterThanOrEqual(2)
    expect(bom.costMinor).toBe(bom.lines.reduce((n, l) => n + (l.lineTotalMinor ?? 0), 0))
    expect(withMargin(10000, 15)).toBe(11500)
    expect(unitPriceOf(CATALOGUE[8], 2)).toBe(500)
  })

  it('reconciles with the design: devices, optics (link ends), cables (route segments)', () => {
    expect(bom.reconciliation.checks.map((c) => [c.key, c.design, c.bom, c.ok])).toEqual([
      ['devices', 4, 4, true],
      ['optics', 4, 4, true],
      ['cables', 4, 4, true],
    ])
    expect(bom.reconciliation.reconciled).toBe(true)
  })

  it('the BOM impact of a change (a cable re-lengthened)', () => {
    const changed = buildBom({ ...design, connections: design.connections.map((c) => (c.id === 'c1' ? { ...c, lengths: { effectiveM: 100 } } : c)) }, context())
    const impact = bomImpact(bom, changed)
    expect(impact.lines.map((l) => [l.key, l.before, l.after, l.change]).sort()).toEqual([
      ['cable:os2:100', 0, 1, 'added'],
      ['cable:os2:50', 1, 0, 'removed'],
    ])
    expect(impact.costAfterMinor - impact.costBeforeMinor).toBe(12000 - 6000)
  })
})

describe('power cords (brief §6.7)', () => {
  it('customer standard → PDU socket matched to the inlet → country plug table', () => {
    expect(selectPowerCord({ customerStandard: { label: 'X', connectorPair: 'C13/C14' }, pduSocketType: 'C19', countryCode: 'GB' })).toMatchObject({ connectorPair: 'C13/C14', source: 'customer_standard' })
    expect(selectPowerCord({ pduSocketType: 'C13', inletType: 'C14' })).toMatchObject({ connectorPair: 'C13/C14', source: 'pdu' })
    expect(selectPowerCord({ pduSocketType: 'C19', inletType: 'C20' })).toMatchObject({ connectorPair: 'C19/C20', source: 'pdu' })
    expect(selectPowerCord({ pduSocketType: 'C19', inletType: 'C14' }).connectorPair).toBe('C13/C20')
    expect(selectPowerCord({ countryCode: 'de', inletType: 'C14' })).toMatchObject({ connectorPair: 'Schuko/C13', source: 'country' })
    expect(selectPowerCord({ countryCode: 'GB', inletType: 'C20', cordLengthM: 3 })).toMatchObject({ connectorPair: 'BS 1363/C19', label: '3 m BS 1363/C19 power cord' })
    expect(selectPowerCord({ countryCode: 'ZZ' }).reason).toMatch(/not in the plug table/)
    expect(Object.keys(COUNTRY_PLUG_TABLE)).toHaveLength(15)
  })
})

describe('procurement transitions', () => {
  it('forward, a quotation may be skipped, one step back before ordering, never back after; PO and delivery date required', () => {
    expect(PROCUREMENT_STATUSES).toEqual(['not_ordered', 'quotation_requested', 'quoted', 'ordered', 'shipped', 'delivered'])
    expect(procurementProblem({ status: 'not_ordered' }, { status: 'quotation_requested' })).toBeNull()
    expect(procurementProblem({ status: 'not_ordered' }, { status: 'shipped' })).toBe('Not ordered cannot move to Shipped — next: Quotation requested or Ordered')
    expect(procurementProblem({ status: 'quoted' }, { status: 'ordered' })).toBe('An ordered line needs a PO number')
    expect(procurementProblem({ status: 'quoted' }, { status: 'ordered', poNumber: 'PO-1' })).toBeNull()
    expect(procurementProblem({ status: 'quoted' }, { status: 'quotation_requested' })).toBeNull()
    expect(procurementProblem({ status: 'ordered', poNumber: 'PO-1' }, { status: 'quoted' })).toMatch(/cannot move/)
    expect(procurementProblem({ status: 'shipped', poNumber: 'PO-1' }, { status: 'delivered' })).toBe('A delivered line needs the actual delivery date')
    expect(procurementProblem({ status: 'shipped', poNumber: 'PO-1' }, { status: 'delivered', actualDelivery: '2026-10-20' })).toBeNull()
    expect(nextStatuses('delivered')).toEqual([])
    expect(procurementProblem({ status: 'delivered', poNumber: 'PO-1', actualDelivery: 'x' }, { vendor: 'X' })).toBeNull()
  })
})

describe('Solution Package evaluation (brief §5.5)', () => {
  const complete = REQUIRED_INPUT_GROUPS.map((g) => (g.key === 'addressing' ? { key: g.key, addressingEntries: [{ id: '1', label: 'Users', vlanId: 10, cidr: '10.0.0.0/24', gateway: '10.0.0.1' }] } : { key: g.key, kvPairs: [{ id: '1', key: 'k', value: 'v' }] }))
  const facts = (over = {}) => ({ surveyApproved: true, hldApproved: true, lldApproved: true, hldDeviceCount: 4, rackCount: 2, portScheduleCount: 3, connectionCount: 3, cableIdCount: 3, findings: { critical: 0, warning: 0 }, bom: { reconciled: true, unpricedCount: 0 }, resourceMinutes: 120, groups: complete, acceptedWarnings: [], ...over })

  it('18 sections, 12 groups; group 1 checks CIDR, VLAN range and overlaps', () => {
    expect(SECTIONS).toHaveLength(18)
    expect(REQUIRED_INPUT_GROUPS).toHaveLength(12)
    expect(groupStatus({ key: 'addressing', addressingEntries: [] })).toBe('not_started')
    expect(groupStatus({ key: 'addressing', addressingEntries: [{ id: 'a', vlanId: 10, cidr: '10.0.0.0/24' }, { id: 'b', vlanId: 11, cidr: '10.0.0.128/25' }] })).toBe('in_progress') // overlap
    expect(groupStatus({ key: 'addressing', addressingEntries: [{ id: 'a', vlanId: 5000, cidr: '10.0.0.0/24' }] })).toBe('in_progress')
    expect(groupStatus({ key: 'routing', kvPairs: [{ key: 'AS', value: '' }] })).toBe('in_progress')
  })

  it('ready only when designs are approved, every group complete, no Critical, every warning accepted', () => {
    const ready = evaluatePackage(facts())
    expect(ready).toMatchObject({ readyForSubmission: true, blockers: [], allComplete: true, packageCompleteness: 100 })
    const notReady = evaluatePackage(facts({ lldApproved: false, findings: { critical: 1, warning: 2 }, bom: { reconciled: true, unpricedCount: 3 }, groups: complete.slice(1) }))
    expect(notReady.blockers).toEqual(['The LLD is not approved', '1 required input group(s) are not complete', '1 Critical design finding(s)', '3 warning area(s) not accepted'])
    expect(notReady.validationAreas.find((a) => a.key === 'design-findings')).toMatchObject({ result: 'critical', acceptable: false })
    // Accepting the warnings (who and when recorded on the server) clears them; Critical stays.
    const accepted = evaluatePackage(facts({ bom: { reconciled: true, unpricedCount: 3 }, acceptedWarnings: [{ areaKey: 'pricing', acceptedBy: 'PM' }] }))
    expect(accepted.validationAreas.find((a) => a.key === 'pricing')).toMatchObject({ result: 'accepted' })
    expect(accepted.readyForSubmission).toBe(true)
  })
})

describe('Bill of Resources (brief §5.5)', () => {
  it('task quantities × PM-set minutes = hours per room and in total; passive items are installed, not DGUV-inspected', () => {
    const estimate = buildResourceEstimate(
      {
        devices: [{ role: 'edge', roomCode: 'TR1' }, { role: 'ap', roomCode: 'TR1' }, { passive: true, roomCode: 'TR1' }, { role: 'border', roomCode: 'MAIN' }],
        rows: [{ media: 'cat6a', dest: { entity: { roomCode: 'TR1' } } }, { media: 'os2', dest: { entity: { roomCode: 'MAIN' } } }],
        racks: [{ roomCode: 'TR1' }],
      },
      { 'patch-copper': 20 }
    )
    expect(estimate.byRoom.TR1).toEqual({ 'install-device': 1, 'dguv-inspection': 1, 'mount-ap': 1, 'install-rack-accessory': 2, 'patch-copper': 1, 'label-cable': 1, 'test-link': 1 })
    // TR1: 30 + 20 + 25 + 2×15 + 20 (PM-set) + 5 + 15 = 145; MAIN: 30 + 20 + 20 + 5 + 15 = 90.
    expect(estimate.byRoomMinutes).toEqual({ TR1: 145, MAIN: 90 })
    expect(estimate.totalHours).toBe(3.9)
  })
})
