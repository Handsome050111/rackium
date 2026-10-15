// Draft BOM from the design records (brief v2.3 §5.6, §6.3, §6.5, §6.7;
// DATA-MODEL §4.10, M5a). Pure: the server hands in the design (the main LLD,
// or the HLD before the LLD starts), the racks, the resolved catalogue and the
// settings; the BOM is recalculated on every read and never typed in.
//
// - Serialised items (switch, router, firewall, AP, WLC, server, UPS, PDU,
//   probe): one line per device.
// - Consumables aggregated: optics (one per link end), uplink modules, PSUs,
//   power cords, cables (one per route segment, each at its own stock
//   length), stack/DAC cables, cage nuts, patch panels, cable managers and
//   accessories.
// Each line carries its source tag (Survey / HLD / LLD) and a reason.
import { selectPowerCord } from './powerCords.js'

export const SERIALISED_CATEGORIES = ['switch', 'router', 'firewall', 'ap', 'wlc', 'server', 'ups', 'pdu', 'probe']
// Provided by the client or a carrier, never procured.
export const NOT_PROCURED_CATEGORIES = ['wan_sp_connection', 'remote_site']
export const BOM_CATEGORIES = ['Network devices', 'Optics & fibre', 'Cables', 'Power & accessories']
const MEDIA_LABEL = { cat6a: 'Cat6A', os2: 'OS2', om4: 'OM4', dac: 'DAC', stack: 'Stack' }
const COPPER_FIBRE = ['cat6a', 'os2', 'om4']

const lower = (s) => String(s ?? '').trim().toLowerCase()
// The procurement line a designed device is bought on (deployment gates
// installation on it, M6a): its own line when serialised, else the
// aggregated line of its catalogue item.
export function procurementLineKeyOf(device, item) {
  const category = item?.category ?? device.category ?? null
  if (NOT_PROCURED_CATEGORIES.includes(category) || ['wan_circuit', 'remote_site'].includes(device.role)) return null
  return SERIALISED_CATEGORIES.includes(category) ? `device:${device.id}` : `item:${lower(item?.key ?? device.catalogueKey ?? device.label)}`
}

// Cage nuts per RU on each face a device is fixed to (organisation setting
// `cageNutsPerRu`; M5a review). A device is fixed on its mounting face, a
// full-depth device on both.
export const DEFAULT_CAGE_NUTS_PER_RU = { front: 4, rear: 4 }
export function cageNutsOf(org) {
  const s = org?.settings?.cageNutsPerRu
  return { front: s?.front ?? DEFAULT_CAGE_NUTS_PER_RU.front, rear: s?.rear ?? DEFAULT_CAGE_NUTS_PER_RU.rear }
}
export function cageNutCount({ heightU, face = 'front', fullDepth = false }, perRu = DEFAULT_CAGE_NUTS_PER_RU) {
  if (!(heightU > 0)) return 0
  const faces = fullDepth ? ['front', 'rear'] : [face === 'rear' ? 'rear' : 'front']
  return faces.reduce((n, f) => n + heightU * (perRu[f] ?? 0), 0)
}

export function catalogueLookup(items) {
  const byKey = new Map(items.map((i) => [lower(i.key), i]))
  return {
    item: (key) => (key ? byKey.get(lower(key)) ?? null : null),
    find: (fn) => items.find(fn) ?? null,
  }
}

// Price of one unit in minor units, or null (not priced). A stock cable is
// priced per metre, never below its minimum.
export function unitPriceOf(item, lengthM = null) {
  if (!item) return null
  if (item.kind === 'stock_cable' && item.stock) {
    if (lengthM == null) return null
    return Math.max(item.stock.minimumMinor ?? 0, Math.round(item.stock.pricePerMetreMinor * lengthM))
  }
  return item.unitPriceMinor ?? null
}

// `design`: { devices, connections } — devices: { id, hostname, label, role,
// catalogueKey, category, roomCode, rackId, ru, heightU, psuConfigured,
// face, fullDepth, hldRef }; connections: { id, hldRef, source, dest, media,
// sourceSfpCode, destSfpCode, hops, segments: [{ index, kind, cableId,
// effectiveM, engineerSelectedM }] (shared/cableSegments.js), lengths }.
// `context`: { stage ('hld' | 'lld'), racks: [{ id, code, cageNutType,
// pduSocketType }], catalogue (items), power: { customerStandard,
// countryCode, cordLengthM }, cageNutsPerRu, currency }.
export function buildBom(design, context) {
  const { stage = 'lld', racks = [], power = {}, currency = 'EUR', cageNutsPerRu = DEFAULT_CAGE_NUTS_PER_RU } = context
  const cat = catalogueLookup(context.catalogue ?? [])
  const rackById = new Map(racks.map((r) => [String(r.id), r]))
  const designTag = (record) => (stage === 'hld' ? 'HLD' : record?.hldRef ? 'HLD' : 'LLD')
  const lines = []
  const calc = []
  const consumables = new Map()

  // One consumable line, aggregated by key.
  function addConsumable({ key, category, item, catalogueKey, spec, unit = 'Each', qty, source, reason, lengthM = null }) {
    const existing = consumables.get(key)
    if (existing) {
      existing.qty += qty
      existing.reasons.push(reason)
      if (existing.source !== source) existing.source = existing.source === 'LLD' || source === 'LLD' ? 'LLD' : existing.source
      return
    }
    consumables.set(key, { key, lineType: 'consumable', category, item, catalogueKey, spec, unit, qty, source, reasons: [reason], lengthM })
  }

  // --- Devices ---
  const devices = design.devices.filter((d) => !NOT_PROCURED_CATEGORIES.includes(cat.item(d.catalogueKey)?.category ?? d.category))
  for (const d of devices) {
    const item = cat.item(d.catalogueKey)
    const category = item?.category ?? d.category ?? null
    const name = d.hostname ?? d.label ?? 'device'
    if (SERIALISED_CATEGORIES.includes(category)) {
      lines.push({
        key: `device:${d.id}`,
        lineType: 'serialised',
        deviceId: String(d.id),
        category: 'Network devices',
        item: item?.model ?? d.model ?? 'Model not chosen',
        catalogueKey: item?.key ?? d.catalogueKey ?? null,
        spec: [name, d.roomCode, d.rackCode && d.ru ? `${d.rackCode} RU${d.ru}` : d.rackCode].filter(Boolean).join(' · '),
        unit: 'Each',
        qty: 1,
        source: designTag(d),
        reasons: [`Planned ${d.role ?? category} in the ${stage === 'hld' ? 'HLD' : 'LLD'}`],
      })
    } else {
      addConsumable({ key: `item:${lower(item?.key ?? d.catalogueKey ?? d.label)}`, category: 'Power & accessories', item: item?.model ?? d.model ?? d.label ?? 'Accessory', catalogueKey: item?.key ?? d.catalogueKey ?? null, spec: item?.description ?? category ?? '', qty: 1, source: designTag(d), reason: `${d.label ?? name}${d.rackCode ? ` in ${d.rackCode}` : ''}` })
    }
    // Uplink module, PSUs and power cords for a powered model.
    if (!item) continue
    if (item.needsUplinkModule && item.compatibleModules?.[0]) {
      const mod = cat.item(item.compatibleModules[0])
      addConsumable({ key: `item:${lower(item.compatibleModules[0])}`, category: 'Network devices', item: mod?.model ?? item.compatibleModules[0], catalogueKey: mod?.key ?? item.compatibleModules[0], spec: mod?.description ?? 'Uplink module', qty: 1, source: designTag(d), reason: `${name} (${item.model}) needs an uplink module` })
    }
    const psus = item.psuCount > 0 ? Math.max(1, d.psuConfigured ?? item.psuCount) : 0
    if (psus > 0) {
      const psuKey = item.compatiblePsus?.[0] ?? null
      const psu = cat.item(psuKey)
      addConsumable({ key: `psu:${lower(psuKey ?? item.key)}`, category: 'Power & accessories', item: psu?.model ?? `PSU for ${item.model}`, catalogueKey: psu?.key ?? psuKey, spec: psu?.description ?? 'Power supply', qty: psus, source: 'HLD', reason: `${name}: ${psus} PSU(s) configured` })
    }
    if (item.rackMounted && item.powerInletType) {
      const rack = rackById.get(String(d.rackId))
      const cord = selectPowerCord({ customerStandard: power.customerStandard, pduSocketType: rack?.pduSocketType, inletType: item.powerInletType, countryCode: power.countryCode, cordLengthM: power.cordLengthM ?? 2 })
      const cordItem = cat.find((i) => i.powerCord && lower(i.powerCord.connectorPair) === lower(cord.connectorPair))
      addConsumable({ key: `cord:${lower(cord.connectorPair)}`, category: 'Power & accessories', item: cordItem?.model ?? cord.label, catalogueKey: cordItem?.key ?? null, spec: `${power.cordLengthM ?? 2} m · ${cord.connectorPair}`, qty: Math.max(1, psus), source: cord.source === 'pdu' ? 'Survey' : 'HLD', reason: `${name}: ${Math.max(1, psus)} × (${cord.reason})` })
    }
    // Cage nuts: per RU on each face the device is fixed to (not 0U).
    const heightU = item.heightU ?? d.heightU ?? 0
    const fullDepth = Boolean(item.fullDepth ?? d.fullDepth)
    const nuts = item.rackMounted && d.rackId ? cageNutCount({ heightU, face: d.face, fullDepth }, cageNutsPerRu) : 0
    if (nuts > 0) {
      const rack = rackById.get(String(d.rackId))
      const type = String(rack?.cageNutType ?? 'M6').trim() || 'M6'
      const nutItem = cat.find((i) => i.category === 'cage_nut' && lower(i.model).includes(lower(type)))
      const faces = fullDepth ? 'front and rear' : d.face === 'rear' ? 'rear' : 'front'
      addConsumable({ key: `cage:${lower(type)}`, category: 'Power & accessories', item: nutItem?.model ?? `${type} cage nut`, catalogueKey: nutItem?.key ?? null, spec: `${type} cage nut, screw and washer`, qty: nuts, source: rack?.cageNutType ? 'Survey' : designTag(d), reason: `${name}: ${heightU} RU × ${faces} in ${rack?.code ?? 'its rack'} = ${nuts}${rack?.cageNutType ? ` (surveyed ${type})` : ''}` })
    }
  }

  // --- Optics: one per link end ---
  for (const c of design.connections) {
    for (const code of [c.sourceSfpCode, c.destSfpCode]) {
      if (!code) continue
      const optic = cat.item(code)
      addConsumable({ key: `optic:${lower(code)}`, category: 'Optics & fibre', item: optic?.model ?? code, catalogueKey: optic?.key ?? code, spec: optic?.mediaSpeed ? `${optic.mediaSpeed.speed} ${MEDIA_LABEL[optic.mediaSpeed.media] ?? optic.mediaSpeed.media} optic` : 'Optic', qty: 1, source: designTag(c), reason: `link end ${c.cableId ?? c.id}` })
    }
  }

  // --- Cables ---
  // Every route segment is its own physical cable (shared/cableSegments.js),
  // counted at its own Engineer Selected (else Suggested) stock length.
  let pendingLength = 0
  for (const c of design.connections) {
    if (COPPER_FIBRE.includes(c.media)) {
      const stock = cat.find((i) => i.kind === 'stock_cable' && i.stock?.media === c.media)
      const label = `${MEDIA_LABEL[c.media]} ${c.media === 'cat6a' ? 'patch cord' : 'fibre patch cord'}`
      const segments = c.segments?.length ? c.segments : [{ index: 0, cableId: c.cableId ?? null, effectiveM: c.lengths?.effectiveM ?? null, engineerSelectedM: c.lengths?.engineerSelectedM ?? null }]
      for (const seg of segments) {
        const effective = seg.effectiveM ?? null
        if (effective == null) pendingLength += 1
        const name = seg.cableId ?? `${c.cableId ?? 'connection'}${segments.length > 1 ? ` cable ${seg.index + 1}/${segments.length}` : ''}`
        addConsumable({
          key: `cable:${c.media}:${effective ?? 'pending'}`,
          category: 'Cables',
          item: stock?.model ?? label,
          catalogueKey: stock?.key ?? null,
          spec: effective != null ? `${effective} m` : 'Length pending (place both ends)',
          qty: 1,
          source: stage === 'hld' ? 'HLD' : 'LLD',
          reason: `${name} at ${effective ?? '—'} m (${seg.engineerSelectedM != null ? 'Engineer Selected' : 'Suggested'})`,
          lengthM: effective,
        })
      }
    } else if (c.media === 'stack' || c.media === 'dac') {
      const item = cat.find((i) => i.kind === 'optic' && i.mediaSpeed?.media === c.media)
      addConsumable({ key: `cable:${c.media}`, category: 'Cables', item: item?.model ?? `${MEDIA_LABEL[c.media]} cable`, catalogueKey: item?.key ?? null, spec: c.media === 'stack' ? 'Stacking cable' : 'Direct-attach copper', qty: 1, source: designTag(c), reason: `${c.cableId ?? 'connection'} (${MEDIA_LABEL[c.media]})` })
    }
  }

  // --- Price and finish the lines ---
  const all = [...lines, ...consumables.values()]
  for (const line of all) {
    const item = cat.item(line.catalogueKey)
    const unit = unitPriceOf(item, line.lengthM)
    const currencyMismatch = unit != null && item?.currency && item.currency !== currency
    line.vendor = item?.vendor ?? null
    line.currency = item?.currency ?? currency
    line.unitPriceMinor = currencyMismatch ? null : unit
    line.lineTotalMinor = line.unitPriceMinor == null ? null : line.unitPriceMinor * line.qty
    line.priced = line.unitPriceMinor != null
    line.priceNote = line.priced ? null : currencyMismatch ? `Priced in ${item.currency}, not ${currency}` : item?.kind === 'stock_cable' && line.lengthM == null ? 'Length pending — priced once both ends are placed' : 'Not priced in the catalogue'
    line.status = line.priced ? (line.lineType === 'serialised' ? 'Suggested' : 'Calculated') : 'Not priced'
    line.basis = line.reasons.length > 3 ? `${line.reasons.slice(0, 3).join('; ')}; +${line.reasons.length - 3} more` : line.reasons.join('; ')
  }
  const order = (l) => BOM_CATEGORIES.indexOf(l.category)
  all.sort((a, b) => order(a) - order(b) || (a.lineType === b.lineType ? 0 : a.lineType === 'serialised' ? -1 : 1) || a.item.localeCompare(b.item) || a.spec.localeCompare(b.spec))

  // --- Calculation log and reconciliation with the design ---
  const serialisedDesign = devices.filter((d) => SERIALISED_CATEGORIES.includes(cat.item(d.catalogueKey)?.category ?? d.category)).length
  const serialisedBom = all.filter((l) => l.lineType === 'serialised').length
  const opticEnds = design.connections.reduce((n, c) => n + (c.sourceSfpCode ? 1 : 0) + (c.destSfpCode ? 1 : 0), 0)
  const opticBom = all.filter((l) => l.key.startsWith('optic:')).reduce((n, l) => n + l.qty, 0)
  const cabled = design.connections.filter((c) => COPPER_FIBRE.includes(c.media))
  const cableSegments = cabled.reduce((n, c) => n + (c.segments?.length || (c.hops ?? []).length + 1), 0)
  const cableBom = all.filter((l) => l.key.startsWith('cable:') && !/^cable:(stack|dac)$/.test(l.key)).reduce((n, l) => n + l.qty, 0)
  const checks = [
    { key: 'devices', label: 'Serialised devices', design: serialisedDesign, bom: serialisedBom },
    { key: 'optics', label: 'Optics (link ends)', design: opticEnds, bom: opticBom },
    { key: 'cables', label: 'Cables (route segments)', design: cableSegments, bom: cableBom },
  ].map((c) => ({ ...c, ok: c.design === c.bom }))
  calc.push(`Serialised devices: ${serialisedBom} line(s), one per device`)
  calc.push(`Optics: ${opticBom} = ${opticEnds} link end(s) with an optic`)
  calc.push(`Cables: ${cableBom} = ${cabled.length} connection(s), ${cableSegments} route segment(s)${pendingLength ? `; ${pendingLength} length(s) pending` : ''}`)
  const unpriced = all.filter((l) => !l.priced)
  if (unpriced.length) calc.push(`Not priced: ${unpriced.length} line(s)`)

  const costMinor = all.reduce((n, l) => n + (l.lineTotalMinor ?? 0), 0)
  return {
    lines: all.map(({ reasons: _reasons, lengthM: _lengthM, ...l }) => l),
    calc,
    currency,
    costMinor,
    unpricedCount: unpriced.length,
    reconciliation: { checks, reconciled: checks.every((c) => c.ok), realCount: serialisedDesign, bomCount: serialisedBom },
  }
}

// Sell price with the PM's margin, in minor units.
export const withMargin = (minor, marginPercent) => Math.round(minor * (1 + (Number(marginPercent) || 0) / 100))

// BOM impact of a change: per line key, the quantity before and after.
export function bomImpact(before, after) {
  const a = new Map(before.lines.map((l) => [l.key, l]))
  const b = new Map(after.lines.map((l) => [l.key, l]))
  const out = []
  for (const [key, l] of b) {
    const prev = a.get(key)
    if (!prev) out.push({ key, item: l.item, spec: l.spec, before: 0, after: l.qty, change: 'added' })
    else if (prev.qty !== l.qty) out.push({ key, item: l.item, spec: l.spec, before: prev.qty, after: l.qty, change: 'changed' })
  }
  for (const [key, l] of a) if (!b.has(key)) out.push({ key, item: l.item, spec: l.spec, before: l.qty, after: 0, change: 'removed' })
  const cost = (bom) => bom.costMinor
  return { lines: out, costBeforeMinor: cost(before), costAfterMinor: cost(after), total: out.length }
}
