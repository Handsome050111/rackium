// Equipment catalogue (DATA-MODEL §4.7/§4.8, brief v2.3 §6.5, v2.2 §2.4).
// Pure: the item schema, exact port numbering, layer resolution, filtering
// and the CSV row validator. Used by the client (preview, browse) and
// re-run by the server before every write.
import { z } from 'zod'

export const CATALOGUE_KINDS = ['device_model', 'optic', 'stock_cable', 'consumable']

// Least to most specific. For any (kind, key) the most specific layer that
// defines it wins; a more specific layer overrides values, never removes a key.
export const CATALOGUE_LAYERS = ['seeded', 'servon', 'organisation', 'project']
export const PLATFORM_LAYERS = ['seeded', 'servon']

// Client-audit grouping (DATA-MODEL §4.8). Probe devices are a normal
// category (brief D36); they sit with servers as rack appliances.
export const CATEGORY_GROUPS = [
  { key: 'passive', label: 'Passive', categories: ['cable', 'patch_panel', 'cabinet', 'cage_nut', 'accessory', 'cable_management'] },
  { key: 'active_networking', label: 'Active networking', categories: ['switch', 'router', 'firewall', 'ap', 'wlc'] },
  { key: 'server', label: 'Server', categories: ['server', 'probe'] },
  { key: 'infrastructure', label: 'Infrastructure', categories: ['ups', 'pdu', 'sensor'] },
  { key: 'external', label: 'External', categories: ['wan_sp_connection', 'remote_site'] },
]
export const CATALOGUE_CATEGORIES = CATEGORY_GROUPS.flatMap((g) => g.categories)

export const CATEGORY_LABELS = {
  cable: 'Cable',
  patch_panel: 'Patch panel',
  cabinet: 'Cabinet',
  cage_nut: 'Cage nut',
  accessory: 'Accessory',
  cable_management: 'Cable management',
  switch: 'Switch',
  router: 'Router',
  firewall: 'Firewall',
  ap: 'Access point',
  wlc: 'Wireless LAN controller',
  server: 'Server',
  probe: 'Probe',
  ups: 'UPS',
  pdu: 'PDU',
  sensor: 'Sensor',
  wan_sp_connection: 'WAN/SP connection',
  remote_site: 'Remote site',
}

export function categoryGroupOf(category) {
  return CATEGORY_GROUPS.find((g) => g.categories.includes(category))?.key ?? null
}

// DATA-MODEL §4.7 [F6]: one procurement line per device for these.
export const SERIALISED_CATEGORIES = ['switch', 'router', 'firewall', 'ap', 'wlc', 'server', 'ups', 'pdu', 'probe']

export const MOUNTINGS = ['front', 'rear', '0U']
export const PORT_ROLES = ['access', 'uplink', 'module']
export const OPTIC_MEDIA = ['os2', 'om4', 'cat6a', 'stack', 'dac']

// ---------- Port numbering (brief §6.5: exact, no skipped/duplicated/extra) ----------

// `{n}` is the port number; `{n:2}` zero-pads it to two digits ("01").
const PATTERN_TOKEN = /\{n(?::(\d))?\}/

export function formatPortId(pattern, n) {
  return pattern.replace(PATTERN_TOKEN, (_m, width) => (width ? String(n).padStart(Number(width), '0') : String(n)))
}

export function expandPortGroup(group) {
  const ports = []
  for (let i = 0; i < group.count; i++) {
    const n = group.start + i
    ports.push({ id: formatPortId(group.pattern, n), n, role: group.role, type: group.type, speed: group.speed ?? null, poe: Boolean(group.poe) })
  }
  return ports
}

// Every port of an item, in display order. A port map is the only source of
// a device's port IDs (DATA-MODEL §4.1, S4).
export function expandPortMap(portMap) {
  return (portMap?.groups ?? []).flatMap((group) => expandPortGroup(group))
}

export function totalPortCount(item) {
  return (item.portMap?.groups ?? []).reduce((sum, g) => sum + g.count, 0)
}

export function duplicatePortIds(portMap) {
  const seen = new Set()
  const dupes = new Set()
  for (const port of expandPortMap(portMap)) {
    const key = port.id.toLowerCase()
    if (seen.has(key)) dupes.add(port.id)
    seen.add(key)
  }
  return [...dupes]
}

// ---------- Item schema ----------

const nullableText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v === '' ? null : v))
const nullableNumber = z.number().min(0).max(1_000_000).nullable().default(null)
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date')
const partKeyList = z.array(z.string().trim().min(1).max(120)).max(50).default([])
// Artwork is a reference (a path in our asset store or an https URL), never markup.
const artworkRef = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https:\/\/[^\s"'<>]+|[a-z0-9][a-z0-9._/-]*)$/i, 'Use an https:// URL or a relative asset path')
  .nullable()
  .default(null)

export const portGroupSchema = z.object({
  role: z.enum(PORT_ROLES),
  type: z.string().trim().min(1).max(30),
  speed: z.string().trim().max(20).nullable().default(null),
  poe: z.boolean().default(false),
  count: z.number().int().min(1).max(512),
  start: z.number().int().min(0).max(9999).default(1),
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((p) => PATTERN_TOKEN.test(p), 'The pattern must contain {n} (or {n:2} for zero-padded numbers)'),
})

export const portMapSchema = z
  .object({ groups: z.array(portGroupSchema).min(1).max(16) })
  .superRefine((portMap, ctx) => {
    const dupes = duplicatePortIds(portMap)
    if (dupes.length) ctx.addIssue({ code: 'custom', message: `Port IDs must be unique: ${dupes.slice(0, 5).join(', ')}` })
  })

export const mediaSpeedSchema = z.object({
  media: z.enum(OPTIC_MEDIA),
  speed: z.string().trim().min(1).max(20),
  reachM: z.number().positive().max(200_000),
})

const itemShape = {
  kind: z.enum(CATALOGUE_KINDS),
  category: z.enum(CATALOGUE_CATEGORIES),
  vendor: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(120),
  description: nullableText(500),
  heightU: z.number().int().min(0).max(60).nullable().default(null),
  fullDepth: z.boolean().default(false),
  mounting: z.enum(MOUNTINGS).nullable().default(null),
  rackMounted: z.boolean().default(false),
  weightKg: nullableNumber,
  powerDrawW: nullableNumber,
  powerInletType: nullableText(20),
  poeBudgetW: nullableNumber,
  psuCount: z.number().int().min(0).max(8).nullable().default(null),
  needsUplinkModule: z.boolean().default(false),
  portMap: portMapSchema.nullable().default(null),
  mediaSpeed: mediaSpeedSchema.nullable().default(null),
  compatibleSfps: partKeyList,
  compatiblePsus: partKeyList,
  compatibleModules: partKeyList,
  // Integer minor units (DATA-MODEL §0). Null = not priced yet, which the BOM
  // already treats as a calculated blocker (DATA-MODEL §5.10).
  unitPriceMinor: z.number().int().min(0).max(100_000_000_00).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use an ISO-4217 code such as EUR').default('EUR'),
  servonAvailable: z.boolean().default(false),
  servonProductCode: nullableText(60),
  eosDate: isoDate.nullable().default(null),
  eolDate: isoDate.nullable().default(null),
  artworkFront: artworkRef,
  artworkRear: artworkRef,
}

function itemRules(item, ctx) {
  if (item.kind === 'device_model') {
    if (item.heightU == null) ctx.addIssue({ code: 'custom', path: ['heightU'], message: 'A device model needs an RU height (0 for 0U)' })
    if (item.rackMounted && !item.mounting) ctx.addIssue({ code: 'custom', path: ['mounting'], message: 'A rack-mounted device needs a mounting (front, rear or 0U)' })
    if (!item.rackMounted && item.mounting) ctx.addIssue({ code: 'custom', path: ['mounting'], message: 'Only a rack-mounted device has a mounting' })
    if (item.mounting === '0U' && item.heightU !== 0) ctx.addIssue({ code: 'custom', path: ['heightU'], message: 'A 0U item has an RU height of 0' })
    if (item.mounting && item.mounting !== '0U' && item.heightU === 0) ctx.addIssue({ code: 'custom', path: ['heightU'], message: 'A front/rear-mounted item needs an RU height of at least 1' })
    if (item.fullDepth && item.mounting === '0U') ctx.addIssue({ code: 'custom', path: ['fullDepth'], message: 'A 0U item cannot be full depth' })
  }
  if (item.kind === 'optic' && !item.mediaSpeed) ctx.addIssue({ code: 'custom', path: ['mediaSpeed'], message: 'An optic needs a media, speed and reach' })
  if (item.servonProductCode && !item.servonAvailable) ctx.addIssue({ code: 'custom', path: ['servonProductCode'], message: 'A SERVON code needs "SERVON available" set' })
  if (item.eosDate && item.eolDate && item.eolDate < item.eosDate) ctx.addIssue({ code: 'custom', path: ['eolDate'], message: 'End of life cannot be before end of sale' })
}

export const catalogueItemSchema = z.object(itemShape).superRefine(itemRules)

// Identity of an item across layers: vendor + model, matching the device
// `model` strings the prototype already uses ("Cisco C9300-48UX").
export function catalogueKey({ vendor, model }) {
  return `${String(vendor).trim()} ${String(model).trim()}`
}

// ---------- Layer resolution ----------

function identity(item) {
  return `${item.kind}|${String(item.key).toLowerCase()}`
}

// `items` from every visible layer; returns one effective item per identity,
// the most specific layer winning, with the layers it overrides listed.
export function resolveCatalogueLayers(items) {
  const byIdentity = new Map()
  for (const item of items) {
    const id = identity(item)
    const list = byIdentity.get(id) ?? []
    list.push(item)
    byIdentity.set(id, list)
  }
  const resolved = []
  for (const list of byIdentity.values()) {
    const sorted = [...list].sort((a, b) => CATALOGUE_LAYERS.indexOf(b.layer) - CATALOGUE_LAYERS.indexOf(a.layer))
    const [winner, ...rest] = sorted
    resolved.push({ ...winner, overrides: rest.map((r) => ({ id: r.id, layer: r.layer })) })
  }
  return resolved.sort((a, b) => a.key.localeCompare(b.key))
}

// ---------- Browse filtering (v2.2 §6.1 progressive search) ----------

function haystack(item) {
  return [item.vendor, item.model, item.key, item.description, CATEGORY_LABELS[item.category], item.servonProductCode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function itemHasPoe(item) {
  return (item.poeBudgetW ?? 0) > 0 || (item.portMap?.groups ?? []).some((g) => g.poe)
}

export function itemSpeeds(item) {
  const speeds = new Set((item.portMap?.groups ?? []).map((g) => g.speed).filter(Boolean))
  if (item.mediaSpeed?.speed) speeds.add(item.mediaSpeed.speed)
  return [...speeds]
}

export function filterCatalogue(items, { q, group, category, vendor, minPorts, poe, speed } = {}) {
  const tokens = String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  return items.filter((item) => {
    if (tokens.length && !tokens.every((t) => haystack(item).includes(t))) return false
    if (group && categoryGroupOf(item.category) !== group) return false
    if (category && item.category !== category) return false
    if (vendor && item.vendor.toLowerCase() !== String(vendor).toLowerCase()) return false
    if (minPorts && totalPortCount(item) < Number(minPorts)) return false
    if (poe && !itemHasPoe(item)) return false
    if (speed && !itemSpeeds(item).some((s) => s.toLowerCase() === String(speed).toLowerCase())) return false
    return true
  })
}

// ---------- CSV import ----------

// One flat row per item. A device can have one access and one uplink port
// group here; richer port maps are edited in the form.
export const CATALOGUE_CSV_COLUMNS = [
  'kind', 'category', 'vendor', 'model', 'description',
  'heightU', 'fullDepth', 'mounting', 'rackMounted', 'weightKg', 'powerDrawW', 'powerInletType', 'poeBudgetW', 'psuCount', 'needsUplinkModule',
  'accessPortCount', 'accessPortType', 'accessPortSpeed', 'accessPortPoe', 'accessPortPattern', 'accessPortStart',
  'uplinkPortCount', 'uplinkPortType', 'uplinkPortSpeed', 'uplinkPortPattern', 'uplinkPortStart',
  'opticMedia', 'opticSpeed', 'opticReachM',
  'compatibleSfps', 'compatiblePsus', 'compatibleModules',
  'price', 'currency', 'servonAvailable', 'servonProductCode', 'eosDate', 'eolDate', 'artworkFront', 'artworkRear',
]

const TRUE = ['true', 'yes', 'y', '1']
const FALSE = ['false', 'no', 'n', '0', '']

function cell(row, column) {
  const value = row[column]
  return value == null ? '' : String(value).trim()
}

// Parses one CSV row into an item, collecting field-level messages. Returns
// { item } when it validates, otherwise { errors: [{ field, message }] }.
export function catalogueRowToItem(row) {
  const errors = []
  const text = (c) => cell(row, c) || null
  const bool = (c) => {
    const v = cell(row, c).toLowerCase()
    if (TRUE.includes(v)) return true
    if (FALSE.includes(v)) return false
    errors.push({ field: c, message: 'Use yes or no' })
    return false
  }
  const num = (c, { integer = false } = {}) => {
    const v = cell(row, c)
    if (v === '') return null
    const n = Number(v.replace(',', '.'))
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      errors.push({ field: c, message: integer ? 'Use a whole number' : 'Use a number' })
      return null
    }
    return n
  }
  const list = (c) =>
    cell(row, c)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  const portGroup = (prefix, role) => {
    const count = num(`${prefix}PortCount`, { integer: true })
    if (!count) return null
    return {
      role,
      type: text(`${prefix}PortType`) ?? '',
      speed: text(`${prefix}PortSpeed`),
      poe: prefix === 'access' ? bool('accessPortPoe') : false,
      count,
      start: num(`${prefix}PortStart`, { integer: true }) ?? 1,
      pattern: text(`${prefix}PortPattern`) ?? '',
    }
  }

  const price = num('price')
  const groups = [portGroup('access', 'access'), portGroup('uplink', 'uplink')].filter(Boolean)
  const opticMedia = text('opticMedia')
  const candidate = {
    kind: text('kind'),
    category: text('category'),
    vendor: text('vendor') ?? '',
    model: text('model') ?? '',
    description: text('description'),
    heightU: num('heightU', { integer: true }),
    fullDepth: bool('fullDepth'),
    mounting: text('mounting'),
    rackMounted: bool('rackMounted'),
    weightKg: num('weightKg'),
    powerDrawW: num('powerDrawW'),
    powerInletType: text('powerInletType'),
    poeBudgetW: num('poeBudgetW'),
    psuCount: num('psuCount', { integer: true }),
    needsUplinkModule: bool('needsUplinkModule'),
    portMap: groups.length ? { groups } : null,
    mediaSpeed: opticMedia ? { media: opticMedia, speed: text('opticSpeed') ?? '', reachM: num('opticReachM') ?? 0 } : null,
    compatibleSfps: list('compatibleSfps'),
    compatiblePsus: list('compatiblePsus'),
    compatibleModules: list('compatibleModules'),
    unitPriceMinor: price == null ? null : Math.round(price * 100),
    currency: (text('currency') ?? 'EUR').toUpperCase(),
    servonAvailable: bool('servonAvailable'),
    servonProductCode: text('servonProductCode'),
    eosDate: text('eosDate'),
    eolDate: text('eolDate'),
    artworkFront: text('artworkFront'),
    artworkRear: text('artworkRear'),
  }
  if (errors.length) return { errors }

  const parsed = catalogueItemSchema.safeParse(candidate)
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((issue) => ({ field: csvFieldForPath(issue.path, groups), message: issue.message })) }
  }
  return { item: parsed.data }
}

function csvFieldForPath(path, groups) {
  const [head, , index, leaf] = path
  if (head === 'portMap') {
    if (leaf == null) return 'accessPortPattern'
    const prefix = groups[index]?.role === 'uplink' ? 'uplink' : 'access'
    return `${prefix}Port${leaf[0].toUpperCase()}${leaf.slice(1)}`
  }
  if (head === 'mediaSpeed') return path[1] === 'reachM' ? 'opticReachM' : path[1] === 'speed' ? 'opticSpeed' : 'opticMedia'
  if (head === 'unitPriceMinor') return 'price'
  return String(head ?? 'row')
}

// Whole-file check: every row, plus the same key twice in one file.
export function validateCatalogueRows(rows) {
  const results = rows.map((row, index) => {
    const { item, errors } = catalogueRowToItem(row)
    return { index, item: item ?? null, key: item ? catalogueKey(item) : null, errors: errors ?? [] }
  })
  const counts = new Map()
  for (const r of results) {
    if (!r.key) continue
    const id = `${r.item.kind}|${r.key.toLowerCase()}`
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  for (const r of results) {
    if (r.key && counts.get(`${r.item.kind}|${r.key.toLowerCase()}`) > 1) {
      r.errors.push({ field: 'model', message: `${r.key} appears more than once in this file` })
    }
  }
  return { ok: results.every((r) => r.errors.length === 0), rows: results }
}
