import { describe, it, expect } from 'vitest'
import { validateHld, connectionFindings, summariseFindings, uplinkChecks, linkLimitM, HLD_RULES } from './hldRules.js'
import { DEFAULT_ROLE_CODES, resolveRoleCodes, duplicateRoleCodes, nextHostname, bomDeviceLines, HLD_ROLES } from './hldRoles.js'
import { generateFromBlueprint, BLUEPRINT_KEYS } from './hldBlueprints.js'

// Catalogue fragments in the shape of shared/catalogue.js items.
const ITEMS = {
  'Cisco C9500': { vendor: 'Cisco', model: 'C9500', category: 'switch', psuCount: 2, weightKg: 20, portMap: { groups: [{ role: 'access', type: 'SFP+', speed: '10G', count: 24, start: 1, pattern: 'Te1/1/{n}' }] }, compatibleSfps: ['Cisco SFP-10G-SR', 'Cisco SFP-10G-LR'] },
  'Cisco C9300-48UX': { vendor: 'Cisco', model: 'C9300-48UX', category: 'switch', psuCount: 2, poeBudgetW: 100, portMap: { groups: [{ role: 'access', type: 'RJ45', speed: '1G', poe: true, count: 48, start: 1, pattern: 'Gi1/0/{n}' }, { role: 'module', type: 'SFP+', speed: '10G', count: 8, start: 1, pattern: 'Te1/1/{n}' }] }, compatibleSfps: ['Cisco SFP-10G-SR', 'Cisco SFP-10G-LR'] },
  'Cisco AP': { vendor: 'Cisco', model: 'AP', category: 'ap', powerDrawW: 30, portMap: { groups: [{ role: 'uplink', type: 'RJ45', speed: '2.5G', count: 1, start: 0, pattern: 'Eth{n}' }] } },
  'Generic PDU': { vendor: 'Generic', model: 'PDU', category: 'pdu' },
}
const OPTICS = {
  'Cisco SFP-10G-SR': { mediaSpeed: { media: 'om4', speed: '10G', reachM: 400 } },
  'Cisco SFP-10G-LR': { mediaSpeed: { media: 'os2', speed: '10G', reachM: 10000 } },
  'Cisco SFP-1G-SX': { mediaSpeed: { media: 'om4', speed: '1G', reachM: 550 } },
}
const ctxFor = (devices, extra = {}) => ({
  deviceById: new Map(devices.map((d) => [String(d.id), d])),
  itemOf: (d) => ITEMS[d.catalogueKey] ?? null,
  opticOf: (code) => OPTICS[code] ?? null,
  patchPanelFreePorts: () => null,
  ...extra,
})
const core = { id: 'b', hostname: 'B-1', role: 'border', origin: 'planned', catalogueKey: 'Cisco C9500', roomId: 'r1', psuConfigured: 2 }
const edge = { id: 'e', hostname: 'E-1', role: 'edge', origin: 'planned', catalogueKey: 'Cisco C9300-48UX', roomId: 'r2', psuConfigured: 2 }
const link = (fields) => ({ id: 'c1', source: { deviceId: 'b', portId: null }, dest: { deviceId: 'e', portId: null }, media: 'os2', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-LR', lengthM: 80, lengthEstimated: false, customLengthRequired: false, ...fields })
const rules = (findings) => findings.map((f) => f.rule)

describe('HLD validation rules (VAL-001…013)', () => {
  it('a clean OS2 uplink with matching optics has no findings', () => {
    expect(connectionFindings(link({}), ctxFor([core, edge]))).toEqual([])
  })

  it('VAL-001: an optic for another media or speed, or an optic on copper', () => {
    expect(rules(connectionFindings(link({ destSfpCode: 'Cisco SFP-10G-SR' }), ctxFor([core, edge])))).toEqual(['VAL-001'])
    expect(rules(connectionFindings(link({ media: 'om4', speed: '1G', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-1G-SX' }), ctxFor([core, edge])))).toContain('VAL-001')
    expect(rules(connectionFindings(link({ media: 'cat6a', speed: '1G', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: null }), ctxFor([core, edge])))).toContain('VAL-001')
  })

  it('VAL-002: an optic on an RJ45 port, or one the model does not list', () => {
    const onCopper = connectionFindings(link({ dest: { deviceId: 'e', portId: 'Gi1/0/1' } }), ctxFor([core, edge]))
    expect(onCopper.find((f) => f.rule === 'VAL-002').message).toMatch(/Gi1\/0\/1 \(RJ45\) has no SFP slot/)
    const unlisted = connectionFindings(link({ media: 'om4', speed: '1G', sourceSfpCode: 'Cisco SFP-1G-SX', destSfpCode: 'Cisco SFP-1G-SX' }), ctxFor([core, edge]))
    expect(rules(unlisted).filter((r) => r === 'VAL-002')).toHaveLength(2)
  })

  it('VAL-011 and VAL-008: the limit is the media limit lowered by the optic reach', () => {
    const om4 = link({ media: 'om4', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-10G-SR' })
    expect(linkLimitM(om4, (c) => OPTICS[c])).toBe(400)
    expect(rules(connectionFindings({ ...om4, lengthM: 410 }, ctxFor([core, edge])))).toEqual(['VAL-011'])
    expect(rules(connectionFindings({ ...om4, lengthM: 370 }, ctxFor([core, edge])))).toEqual(['VAL-008'])
    expect(rules(connectionFindings({ ...om4, lengthM: 300 }, ctxFor([core, edge])))).toEqual([])
    expect(rules(connectionFindings(link({ media: 'cat6a', speed: '1G', sourceSfpCode: null, destSfpCode: null, lengthM: 101 }), ctxFor([core, edge])))).toEqual(['VAL-011'])
  })

  it('VAL-012 custom length, VAL-004 full patch panel, and the info checks', () => {
    expect(rules(connectionFindings(link({ customLengthRequired: true }), ctxFor([core, edge])))).toEqual(['VAL-012'])
    expect(rules(connectionFindings(link({ viaPatchPanel: true }), ctxFor([core, edge], { patchPanelFreePorts: () => 0 })))).toEqual(['VAL-004'])
    expect(rules(connectionFindings(link({ viaPatchPanel: true }), ctxFor([core, edge], { patchPanelFreePorts: () => 3 })))).toEqual([])
    expect(rules(connectionFindings(link({ lengthM: null, lengthEstimated: true, destSfpCode: null }), ctxFor([core, edge])))).toEqual(['I-TBD', 'I-ESTIMATED-PATH'])
    expect(rules(connectionFindings(link({ media: 'om4', speed: '1G', sourceSfpCode: null, destSfpCode: null, dest: { deviceId: 'e', portId: 'Te1/1/1' } }), ctxFor([core, edge])))).toContain('I-BELOW-SPEED')
  })

  it('VAL-013: a cable ID used twice in any letter case (connections and hop segments)', () => {
    const findings = validateHld({ devices: [core, edge], connections: [link({ id: 'c1', cableId: 'CBL-1' }), link({ id: 'c2', cableId: 'cbl-1' })] }, ctxFor([core, edge]))
    expect(findings.filter((f) => f.rule === 'VAL-013').map((f) => f.objectId).sort()).toEqual(['c1', 'c2'])
    const hop = validateHld({ devices: [core, edge], connections: [link({ id: 'c1', cableId: 'X-1' }), link({ id: 'c2', hops: [{ seq: 1, segmentCableId: 'x-1' }] })] }, ctxFor([core, edge]))
    expect(rules(hop)).toContain('VAL-013')
  })

  it('VAL-005 core needs dual PSU (Critical); other dual-capable devices only warn', () => {
    const findings = validateHld({ devices: [{ ...core, psuConfigured: 1 }, { ...edge, psuConfigured: 1 }], connections: [] }, ctxFor([core, edge]))
    expect(findings.find((f) => f.rule === 'VAL-005').objectId).toBe('b')
    expect(findings.find((f) => f.rule === 'W-SINGLE-PSU').objectId).toBe('e')
  })

  it('VAL-009 PoE over 80% of budget; VAL-010 stack near the maximum', () => {
    const aps = [1, 2, 3].map((n) => ({ id: `ap${n}`, hostname: `A-${n}`, role: 'ap', origin: 'planned', catalogueKey: 'Cisco AP' }))
    const conns = aps.map((ap, i) => link({ id: `l${i}`, source: { deviceId: 'e' }, dest: { deviceId: ap.id }, media: 'cat6a', speed: '1G', sourceSfpCode: null, destSfpCode: null }))
    const all = [core, edge, ...aps]
    expect(rules(validateHld({ devices: all, connections: conns }, ctxFor(all)))).toContain('VAL-009') // 90 W of 100 W
    expect(rules(validateHld({ devices: all, connections: conns.slice(0, 2) }, ctxFor(all)))).not.toContain('VAL-009')

    const members = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, hostname: `E-${i}`, role: 'edge', origin: 'planned', catalogueKey: 'Cisco C9300-48UX' }))
    const stack = members.slice(1).map((m, i) => link({ id: `st${i}`, source: { deviceId: members[i].id }, dest: { deviceId: m.id }, media: 'stack', speed: '10G', sourceSfpCode: null, destSfpCode: null }))
    expect(validateHld({ devices: members, connections: stack }, ctxFor(members)).filter((f) => f.rule === 'VAL-010')).toHaveLength(1)
    expect(rules(validateHld({ devices: members, connections: stack.slice(0, 3) }, ctxFor(members)))).not.toContain('VAL-010')
  })

  it('rack rules: VAL-007 overlap, VAL-003 no PDU, single PDU, VAL-006 weight, empty RU', () => {
    const rack = { id: 'k1', code: 'R01', heightU: 4, maxLoadKg: 30 }
    const a = { ...core, id: 'x1', rackId: 'k1', ru: 1, heightU: 2, face: 'front' }
    const b = { ...core, id: 'x2', hostname: 'B-2', rackId: 'k1', ru: 2, heightU: 1, face: 'front' }
    const noPdu = validateHld({ devices: [a, b], connections: [], racks: [rack] }, ctxFor([a, b]))
    expect(noPdu.filter((f) => f.rule === 'VAL-007')).toHaveLength(1)
    expect(noPdu.filter((f) => f.rule === 'VAL-003')).toHaveLength(2)
    expect(rules(noPdu)).toContain('VAL-006') // 40 kg > 30 kg
    const pdu = { id: 'p1', role: 'pdu', origin: 'existing', catalogueKey: 'Generic PDU', rackId: 'k1', ru: null, heightU: 0, label: 'PDU-A' }
    const withPdu = validateHld({ devices: [{ ...a, ru: 3 }, pdu], connections: [], racks: [{ ...rack, heightU: 42 }] }, ctxFor([a, pdu]))
    expect(rules(withPdu)).toEqual(expect.arrayContaining(['W-SINGLE-PDU', 'W-EMPTY-RU']))
    expect(rules(withPdu)).not.toContain('VAL-003')
  })

  it('summary: Critical blocks submit; every rule has a severity', () => {
    expect(summariseFindings([{ severity: 'warning' }, { severity: 'info' }])).toEqual({ critical: 0, warning: 1, info: 1, blocksSubmit: false })
    expect(summariseFindings([{ severity: 'critical' }]).blocksSubmit).toBe(true)
    for (let n = 1; n <= 13; n++) expect(HLD_RULES[`VAL-${String(n).padStart(3, '0')}`].severity).toMatch(/critical|warning/)
  })

  it('uplink wizard checks come from the same rules', () => {
    const { checks, blocked } = uplinkChecks(link({ destSfpCode: 'Cisco SFP-10G-SR' }), ctxFor([core, edge]))
    expect(checks.find((c) => c.id === 'sfp-compatibility')).toMatchObject({ status: 'fail' })
    expect(blocked).toBe(true)
    expect(uplinkChecks(link({}), ctxFor([core, edge])).blocked).toBe(false)
    expect(uplinkChecks(link({}), ctxFor([core, edge]), { portsFree: { source: false, dest: true } }).blocked).toBe(true)
  })
})

describe('HLD roles, hostnames and BOM rules', () => {
  it('default codes are the brief’s plus the proposed ones; WAN and remote site carry no hostname', () => {
    expect(DEFAULT_ROLE_CODES).toMatchObject({ fusion: 'F', border: 'B', distribution: 'D', edge: 'E', ap: 'A', firewall: 'FW', router: 'R', wlc: 'WC', server: 'SV', ups: 'UP', pdu: 'PD', sensor: 'SN' })
    expect(HLD_ROLES.filter((r) => !r.named).map((r) => r.role)).toEqual(['wan_circuit', 'remote_site'])
    expect(resolveRoleCodes({ firewall: 'FWL', edge: 'bad code' })).toMatchObject({ firewall: 'FWL', edge: 'E' })
    expect(duplicateRoleCodes({ ...DEFAULT_ROLE_CODES, router: 'F' })).toEqual(['fusion and router both use F'])
  })

  it('hostnames: next free 3-digit sequence per role and floor, floor tokens cleaned', () => {
    const where = { codes: {}, country: 'DE', sal: 'ERL', campus: 'C01', building: 'B001', floor: '1.OG' }
    expect(nextHostname('edge', where, [])).toBe('E-DE-ERL-C01-B001-1OG-001')
    expect(nextHostname('edge', where, ['e-de-erl-c01-b001-1og-001'])).toBe('E-DE-ERL-C01-B001-1OG-002')
    expect(nextHostname('firewall', { ...where, codes: { firewall: 'FWL' } }, [])).toBe('FWL-DE-ERL-C01-B001-1OG-001')
    expect(nextHostname('wan_circuit', where, [])).toBeNull()
  })

  it('BOM rules: one line per role and model, provider-supplied roles excluded', () => {
    const lines = bomDeviceLines([
      { role: 'edge', catalogueKey: 'Cisco C9300-48UX' },
      { role: 'edge', catalogueKey: 'Cisco C9300-48UX' },
      { role: 'firewall', catalogueKey: 'Generic FW' },
      { role: 'ups', catalogueKey: 'Generic UPS' },
      { role: 'wan_circuit', catalogueKey: null },
      { role: 'remote_site' },
    ])
    expect(lines.map((l) => [l.item, l.qty, l.section])).toEqual([
      ['Edge switch', 2, 'Network devices'],
      ['Firewall', 1, 'Network devices'],
      ['UPS', 1, 'Power & accessories'],
    ])
  })
})

describe('blueprint presets (Generate HLD)', () => {
  const floors = [
    { id: 'f0', token: 'EG', order: 0 },
    { id: 'f1', token: '1.OG', order: 1 },
  ]
  const rooms = [
    { id: 'main', floorId: 'f0', isMainRoom: true, hasRack: true },
    { id: 'r1', floorId: 'f0', isMainRoom: false, hasRack: true },
    { id: 'r2', floorId: 'f1', isMainRoom: false, hasRack: true },
    { id: 'r3', floorId: 'f1', isMainRoom: false, hasRack: false },
  ]
  const roles = (plan) => plan.devices.map((d) => `${d.role}@${d.roomId}`).sort()

  it('S/M/L/XL produce their topologies from the surveyed rooms', () => {
    expect(BLUEPRINT_KEYS).toEqual(['S', 'M', 'L', 'XL'])
    const m = generateFromBlueprint({ preset: 'M', rooms, floors, devices: [], links: [] })
    expect(roles(m)).toEqual(['ap@r1', 'ap@r2', 'border@main', 'edge@r1', 'edge@r2', 'fusion@main'])
    expect(m.links.find((l) => l.from === 'new:border:main' && l.to === 'new:edge:r1')).toMatchObject({ media: 'os2', speed: '10G' })
    expect(m.links.find((l) => l.from === 'new:edge:r1' && l.to === 'new:ap:r1')).toMatchObject({ media: 'cat6a', speed: '1G' })
    expect(m.links.find((l) => l.from === 'new:border:main' && l.to === 'new:fusion:main')).toMatchObject({ media: 'om4' })

    expect(roles(generateFromBlueprint({ preset: 'S', rooms, floors, devices: [], links: [] }))).not.toContain('fusion@main')
    const l = generateFromBlueprint({ preset: 'L', rooms, floors, devices: [], links: [] })
    expect(roles(l)).toEqual(expect.arrayContaining(['distribution@r1', 'distribution@r2']))
    expect(l.links.some((x) => x.from === 'new:distribution:r2' && x.to === 'new:edge:r2')).toBe(true)
    const xl = generateFromBlueprint({ preset: 'XL', rooms, floors, devices: [], links: [] })
    expect(roles(xl)).toEqual(expect.arrayContaining(['firewall@main', 'wlc@main']))
    expect(xl.links.filter((x) => x.from === 'new:distribution:r2' && x.to === 'new:edge:r2')).toHaveLength(2)
  })

  it('is idempotent: existing devices and links are reused, nothing twice', () => {
    const first = generateFromBlueprint({ preset: 'M', rooms, floors, devices: [], links: [] })
    const ids = new Map(first.devices.map((d, i) => [d.key, `d${i}`]))
    const devices = first.devices.map((d) => ({ id: ids.get(d.key), role: d.role, roomId: d.roomId }))
    const links = first.links.map((l) => ({ sourceId: ids.get(l.from), destId: ids.get(l.to) }))
    expect(generateFromBlueprint({ preset: 'M', rooms, floors, devices, links })).toEqual({ devices: [], links: [] })
  })
})
