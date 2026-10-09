import { describe, it, expect } from 'vitest'
import {
  catalogueItemSchema,
  expandPortMap,
  formatPortId,
  catalogueKey,
  resolveCatalogueLayers,
  filterCatalogue,
  validateCatalogueRows,
  catalogueRowToItem,
  categoryGroupOf,
  CATEGORY_GROUPS,
  CATALOGUE_CATEGORIES,
} from './catalogue.js'
import { SEEDED_CATALOGUE } from './catalogueSeed.js'
import { getDevicePortMap, getPatchPanelPortMap, flattenPortMap } from './portMap.js'

const parse = (item) => catalogueItemSchema.parse(item)
const seed = (model) => parse(SEEDED_CATALOGUE.find((i) => i.model === model))
const ids = (item) => expandPortMap(item.portMap).map((p) => p.id)

describe('port numbering (brief §6.5: exact, no skipped, duplicated or extra ports)', () => {
  it('formats plain and zero-padded patterns', () => {
    expect(formatPortId('Gi1/0/{n}', 7)).toBe('Gi1/0/7')
    expect(formatPortId('{n:2}', 7)).toBe('07')
    expect(formatPortId('{n:2}', 24)).toBe('24')
  })

  it('expands groups sequentially from their start, access before module ports', () => {
    const ports = expandPortMap({
      groups: [
        { role: 'access', type: 'RJ45', count: 3, start: 1, pattern: 'Gi1/0/{n}' },
        { role: 'module', type: 'SFP+', count: 2, start: 1, pattern: 'Te1/1/{n}' },
      ],
    })
    expect(ports.map((p) => p.id)).toEqual(['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Te1/1/1', 'Te1/1/2'])
    expect(ports.map((p) => p.role)).toEqual(['access', 'access', 'access', 'module', 'module'])
  })

  it('rejects a port map whose groups overlap', () => {
    const result = catalogueItemSchema.safeParse({
      kind: 'device_model',
      category: 'switch',
      vendor: 'X',
      model: 'Y',
      heightU: 1,
      rackMounted: true,
      mounting: 'front',
      portMap: {
        groups: [
          { role: 'access', type: 'RJ45', count: 4, start: 1, pattern: 'P{n}' },
          { role: 'uplink', type: 'SFP', count: 2, start: 4, pattern: 'P{n}' },
        ],
      },
    })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].message).toMatch(/unique: P4/)
  })

  it('rejects a pattern without {n}', () => {
    expect(() => parse({ kind: 'device_model', category: 'switch', vendor: 'X', model: 'Y', heightU: 1, rackMounted: true, mounting: 'front', portMap: { groups: [{ role: 'access', type: 'RJ45', count: 2, pattern: 'Gi1/0/1' }] } })).toThrow(
      /must contain \{n\}/
    )
  })

  it("seeded port maps give exactly the prototype's port IDs (shared/portMap.js)", () => {
    expect(ids(seed('C9300-48UX'))).toEqual(flattenPortMap(getDevicePortMap({ role: 'edge' })).map((p) => p.id).sort(byPortOrder))
    expect(ids(seed('C9500'))).toEqual(flattenPortMap(getDevicePortMap({ role: 'fusion' })).map((p) => p.id))
    expect(ids(seed('Cat6A Patch Panel 24-port'))).toEqual(flattenPortMap(getPatchPanelPortMap({ ports: 24 })).map((p) => p.id))
    expect(ids(seed('Cat6A Patch Panel 48-port'))).toEqual(flattenPortMap(getPatchPanelPortMap({ ports: 48 })).map((p) => p.id))
    expect(ids(seed('LC Fibre Patch Panel 24-port'))).toHaveLength(24)
  })
})

// portMap.js lays the edge's access ports out in odd/even rows for the faceplate;
// compare in numeric order.
function byPortOrder(a, b) {
  const [pa, na] = a.split(/(\d+)$/)
  const [pb, nb] = b.split(/(\d+)$/)
  return pa === pb ? Number(na) - Number(nb) : pa.localeCompare(pb)
}

describe('seeded catalogue', () => {
  it('every seeded item validates and is a known category', () => {
    for (const item of SEEDED_CATALOGUE) {
      const parsed = catalogueItemSchema.safeParse(item)
      expect(parsed.success, `${item.model}: ${parsed.error?.issues.map((i) => i.message).join('; ')}`).toBe(true)
      expect(CATALOGUE_CATEGORIES).toContain(item.category)
    }
  })

  it('has every model the prototype uses, keyed as the prototype keys device.model', () => {
    const keys = SEEDED_CATALOGUE.map(catalogueKey)
    for (const key of ['Cisco C9300-48UX', 'Cisco C9500', 'Cisco Catalyst 9130AXI']) expect(keys).toContain(key)
    for (const model of ['Cat6A Patch Panel 24-port', 'Cat6A Patch Panel 48-port', 'LC Fibre Patch Panel 24-port', 'Cable Manager 1U', 'PDU 0U', 'UPS 3U']) {
      expect(SEEDED_CATALOGUE.map((i) => i.model)).toContain(model)
    }
  })

  it('every compatible part a seeded item names is itself in the seed', () => {
    const keys = new Set(SEEDED_CATALOGUE.map(catalogueKey))
    for (const item of SEEDED_CATALOGUE) {
      for (const ref of [...(item.compatibleSfps ?? []), ...(item.compatiblePsus ?? []), ...(item.compatibleModules ?? [])]) {
        expect(keys.has(ref), `${item.model} → ${ref}`).toBe(true)
      }
    }
  })

  it('keys are unique per kind', () => {
    const ids = SEEDED_CATALOGUE.map((i) => `${i.kind}|${catalogueKey(i).toLowerCase()}`)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('item rules', () => {
  const device = { kind: 'device_model', category: 'switch', vendor: 'X', model: 'Y' }
  it('a device model needs an RU height', () => {
    expect(catalogueItemSchema.safeParse(device).success).toBe(false)
  })
  it('0U means RU height 0, and front/rear means at least 1', () => {
    expect(catalogueItemSchema.safeParse({ ...device, heightU: 1, rackMounted: true, mounting: '0U' }).success).toBe(false)
    expect(catalogueItemSchema.safeParse({ ...device, heightU: 0, rackMounted: true, mounting: 'front' }).success).toBe(false)
    expect(catalogueItemSchema.safeParse({ ...device, heightU: 0, rackMounted: true, mounting: '0U' }).success).toBe(true)
  })
  it('an optic needs media, speed and reach', () => {
    expect(catalogueItemSchema.safeParse({ kind: 'optic', category: 'accessory', vendor: 'X', model: 'O' }).success).toBe(false)
  })
  it('a SERVON code needs the SERVON flag; end of life cannot precede end of sale', () => {
    expect(catalogueItemSchema.safeParse({ ...device, heightU: 1, rackMounted: true, mounting: 'front', servonProductCode: 'S-1' }).success).toBe(false)
    expect(catalogueItemSchema.safeParse({ ...device, heightU: 1, rackMounted: true, mounting: 'front', eosDate: '2030-01-01', eolDate: '2029-01-01' }).success).toBe(false)
  })
  it('artwork is a reference, never markup or a javascript: URL', () => {
    const base = { ...device, heightU: 1, rackMounted: true, mounting: 'front' }
    expect(catalogueItemSchema.safeParse({ ...base, artworkFront: 'https://cdn.example.com/c9300-front.svg' }).success).toBe(true)
    expect(catalogueItemSchema.safeParse({ ...base, artworkFront: 'artwork/c9300-front.svg' }).success).toBe(true)
    expect(catalogueItemSchema.safeParse({ ...base, artworkFront: 'javascript:alert(1)' }).success).toBe(false)
    expect(catalogueItemSchema.safeParse({ ...base, artworkFront: '<svg onload=alert(1)>' }).success).toBe(false)
  })
})

describe('layer resolution', () => {
  const at = (layer, extra = {}) => ({ id: layer, layer, kind: 'device_model', key: 'Cisco C9500', unitPriceMinor: 1, ...extra })
  it('the most specific layer wins and records what it overrides', () => {
    const [winner] = resolveCatalogueLayers([at('seeded'), at('organisation', { unitPriceMinor: 2 }), at('servon')])
    expect(winner.layer).toBe('organisation')
    expect(winner.unitPriceMinor).toBe(2)
    expect(winner.overrides.map((o) => o.layer)).toEqual(['servon', 'seeded'])
  })
  it('matches keys case-insensitively and keeps different kinds apart', () => {
    const resolved = resolveCatalogueLayers([at('seeded'), at('project', { key: 'cisco c9500' }), at('seeded', { kind: 'optic' })])
    expect(resolved).toHaveLength(2)
    expect(resolved.find((r) => r.kind === 'device_model').layer).toBe('project')
  })
})

describe('filtering', () => {
  const items = SEEDED_CATALOGUE.map((i) => ({ ...parse(i), key: catalogueKey(i) }))
  it('free text matches every token', () => {
    expect(filterCatalogue(items, { q: '9300 48' }).map((i) => i.model)).toEqual(['C9300-48UX'])
  })
  it('filters by group, category, vendor, ports, PoE and speed', () => {
    expect(filterCatalogue(items, { group: 'infrastructure' }).map((i) => i.model).sort()).toEqual(['Environment Sensor', 'PDU 0U', 'UPS 3U'])
    expect(filterCatalogue(items, { category: 'patch_panel' })).toHaveLength(3)
    expect(filterCatalogue(items, { vendor: 'generic' }).every((i) => i.vendor === 'Generic')).toBe(true)
    expect(filterCatalogue(items, { minPorts: 48 }).map((i) => i.model).sort()).toEqual(['C9300-48UX', 'Cat6A Patch Panel 48-port'])
    expect(filterCatalogue(items, { poe: true }).map((i) => i.model)).toEqual(['C9300-48UX'])
    expect(filterCatalogue(items, { speed: '40g' }).map((i) => i.model)).toEqual(['SFP-40G-SR4'])
  })
  it('every category belongs to exactly one group', () => {
    for (const c of CATALOGUE_CATEGORIES) expect(CATEGORY_GROUPS.filter((g) => g.categories.includes(c))).toHaveLength(1)
    expect(categoryGroupOf('ups')).toBe('infrastructure')
  })
})

describe('CSV rows', () => {
  const row = {
    kind: 'device_model',
    category: 'switch',
    vendor: 'Cisco',
    model: 'C9200-24P',
    heightU: '1',
    rackMounted: 'yes',
    mounting: 'front',
    accessPortCount: '24',
    accessPortType: 'RJ45',
    accessPortSpeed: '1G',
    accessPortPoe: 'yes',
    accessPortPattern: 'Gi1/0/{n}',
    uplinkPortCount: '4',
    uplinkPortType: 'SFP',
    uplinkPortPattern: 'Gi1/1/{n}',
    compatibleSfps: 'Cisco SFP-1G-SX; Cisco SFP-1G-LX',
    price: '1234.50',
    currency: 'eur',
    eosDate: '2030-06-30',
  }

  it('turns a flat row into a full item', () => {
    const { item, errors } = catalogueRowToItem(row)
    expect(errors).toBeUndefined()
    expect(item.unitPriceMinor).toBe(123450)
    expect(item.currency).toBe('EUR')
    expect(item.compatibleSfps).toEqual(['Cisco SFP-1G-SX', 'Cisco SFP-1G-LX'])
    expect(expandPortMap(item.portMap)).toHaveLength(28)
    expect(expandPortMap(item.portMap).at(-1).id).toBe('Gi1/1/4')
  })

  it('reports field-level errors, naming the CSV column', () => {
    const { errors } = catalogueRowToItem({ ...row, heightU: 'one', rackMounted: 'maybe' })
    expect(errors).toHaveLength(2)
    expect(errors).toEqual(
      expect.arrayContaining([
        { field: 'rackMounted', message: 'Use yes or no' },
        { field: 'heightU', message: 'Use a whole number' },
      ])
    )
    expect(catalogueRowToItem({ ...row, uplinkPortPattern: 'Gi1/1/1' }).errors[0].field).toBe('uplinkPortPattern')
    expect(catalogueRowToItem({ ...row, category: 'toaster' }).errors[0].field).toBe('category')
  })

  it('flags the same key twice in one file', () => {
    const result = validateCatalogueRows([row, { ...row, model: 'c9200-24p' }])
    expect(result.ok).toBe(false)
    expect(result.rows.every((r) => r.errors.some((e) => /more than once/.test(e.message)))).toBe(true)
  })
})
