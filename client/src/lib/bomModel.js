// Pure BOM derivation (brief v2.3 §5.6, §6.3, §6.5, §6.7). Every quantity
// here is calculated from real HLD/LLD records — devices, connections,
// SFPs already assigned, and LLD's Engineer Selected cable lengths. The
// four sections follow the brief exactly (Network devices / Optics &
// fibre / Cables / Power & accessories) rather than the render's merged
// "Optics & Fibre" grouping, and there is no Vendor A/B partial-package
// split (brief D37 explicitly rules that out even though the render
// shows it) — each line just carries a single editable Vendor field.
import { DEVICE_CATALOGUE, PROBE_DEVICE, UPLINK_MODULE, REDUNDANT_PSU, CAGE_NUT_SET, cablePrice, CURRENCY } from '../mock/deviceCatalogue.js'
import { getSfp } from '../mock/sfpCatalog.js'
import { selectPowerCord } from '../mock/powerStandards.js'

const ROLE_LABEL = { fusion: 'Fusion switch', border: 'Border switch', distribution: 'Distribution switch', edge: 'Edge switch', ap: 'Wireless access point' }

function line({ key, category, item, spec, basis, qty, unit, status, vendor, unitPrice }) {
  return { key, category, item, spec, basis, qty, unit, status, vendor, unitPrice: unitPrice ?? null, lineTotal: unitPrice != null ? Math.round(unitPrice * qty * 100) / 100 : null }
}

// --- Network devices --------------------------------------------------

export function buildNetworkDeviceLines(devices) {
  const lines = []
  const calc = []
  const byRole = {}
  for (const d of devices) {
    if (d.role === 'wan-circuit') continue // Telekom-provided, not procured
    ;(byRole[d.role] ??= []).push(d)
  }

  for (const role of ['fusion', 'border', 'distribution', 'edge', 'ap']) {
    const list = byRole[role]
    if (!list || list.length === 0) continue
    const model = list[0].model
    const catalogue = DEVICE_CATALOGUE[model]
    const basis =
      role === 'fusion' || role === 'border' || role === 'distribution'
        ? 'HLD device'
        : role === 'edge'
          ? `LLD rooms ${list.map((d) => d.roomCode ?? d.roomId).join(', ')}`
          : 'One per Edge room'
    lines.push(
      line({
        key: `device:${role}`,
        category: 'Network devices',
        item: ROLE_LABEL[role] ?? role,
        spec: model,
        basis,
        qty: list.length,
        unit: 'Each',
        status: catalogue ? 'Suggested' : 'Compatibility check',
        vendor: catalogue?.vendor ?? null,
        unitPrice: catalogue?.unitPrice,
      })
    )
  }

  lines.push(
    line({
      key: 'device:probe',
      category: 'Network devices',
      item: PROBE_DEVICE.label,
      spec: PROBE_DEVICE.spec,
      basis: 'Project requirement',
      qty: PROBE_DEVICE.projectQuantity,
      unit: 'Each',
      status: 'Suggested',
      vendor: PROBE_DEVICE.vendor,
      unitPrice: PROBE_DEVICE.unitPrice,
    })
  )
  calc.push(`Network devices: ${Object.values(byRole).flat().length} HLD devices placed (excl. WAN circuit) + ${PROBE_DEVICE.projectQuantity} project probes`)

  return { lines, calc }
}

// --- Optics & fibre -----------------------------------------------------

// Tallies the SFP codes already assigned on real connections (set during
// HLD/LLD validation) — one per link end, so a link uses 2.
export function buildOpticsLines(connections) {
  const counts = new Map()
  for (const c of connections) {
    for (const code of [c.sourceSfp, c.destSfp]) {
      if (!code) continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }

  const lines = []
  const calc = []
  for (const [code, qty] of counts) {
    const sfp = getSfp(code)
    const linkCount = qty / 2
    lines.push(
      line({
        key: `optic:${code}`,
        category: 'Optics & fibre',
        item: code,
        spec: `${sfp?.speed ?? ''} ${sfp?.media?.toUpperCase() ?? ''} optic`.trim(),
        basis: `${linkCount} link${linkCount === 1 ? '' : 's'} × 2 ends`,
        qty,
        unit: 'Each',
        status: 'Calculated',
        vendor: 'Cisco',
        unitPrice: sfp?.unitPrice,
      })
    )
    calc.push(`${code}: ${linkCount} link${linkCount === 1 ? '' : 's'} × 2 ends = ${qty}`)
  }
  return { lines, calc }
}

// --- Cables ---------------------------------------------------------------

// Groups by (media, stock length) — a BOM procurement line, not a
// per-connection detail (that's what the LLD Cable Schedule already is).
export function buildCableLines(rows) {
  const groups = new Map()
  for (const row of rows) {
    const length = row.length.effective
    const key = `${row.media}:${length ?? 'tbd'}`
    if (!groups.has(key)) groups.set(key, { media: row.media, mediaLabel: row.mediaLabel, length, rows: [] })
    groups.get(key).rows.push(row)
  }

  const lines = []
  const calc = []
  for (const [key, group] of groups) {
    const qty = group.rows.length
    const unitPrice = group.length != null ? cablePrice(group.media, group.length) : null
    lines.push(
      line({
        key: `cable:${key}`,
        category: 'Cables',
        item: `${group.mediaLabel} patch cord`,
        spec: group.length != null ? `${group.length} m` : 'Length pending survey',
        basis: `${qty} link${qty === 1 ? '' : 's'} at ${group.length ?? '—'} m (Engineer Selected)`,
        qty,
        unit: 'Each',
        status: group.length != null ? 'Calculated' : 'Compatibility check',
        vendor: 'SERVON',
        unitPrice,
      })
    )
    calc.push(`${group.mediaLabel} ${group.length ?? '—'}m: ${qty} link${qty === 1 ? '' : 's'}`)
  }
  return { lines, calc }
}

// --- Power & accessories --------------------------------------------------

export function buildPowerAccessoryLines(devices, { countryCode = 'DE' } = {}) {
  const lines = []
  const calc = []
  const rackMounted = devices.filter((d) => d.role !== 'wan-circuit' && DEVICE_CATALOGUE[d.model]?.rackMounted)

  if (rackMounted.length > 0) {
    const psuDevices = rackMounted.filter((d) => DEVICE_CATALOGUE[d.model].psuCount > 0)
    if (psuDevices.length > 0) {
      const psuQty = psuDevices.reduce((sum, d) => sum + DEVICE_CATALOGUE[d.model].psuCount, 0)
      lines.push(
        line({
          key: 'power:psu',
          category: 'Power & accessories',
          item: REDUNDANT_PSU.label,
          spec: REDUNDANT_PSU.spec,
          basis: `${psuDevices.length} wired switches × 2`,
          qty: psuQty,
          unit: 'Each',
          status: 'Compatibility check',
          vendor: REDUNDANT_PSU.vendor,
          unitPrice: REDUNDANT_PSU.unitPrice,
        })
      )
      calc.push(`PSUs: ${psuDevices.length} switches × 2 = ${psuQty}`)

      const cord = selectPowerCord({ countryCode, powerInletType: 'C14', pduSocketType: null })
      lines.push(
        line({
          key: 'power:cord',
          category: 'Power & accessories',
          item: cord.label,
          spec: cord.connectorPair,
          basis: `${psuDevices.length} wired switches × 2`,
          qty: psuQty,
          unit: 'Each',
          status: 'Calculated',
          vendor: 'SERVON',
          unitPrice: 6,
        })
      )
      calc.push(`Power cords: ${psuDevices.length} switches × 2 = ${psuQty} (source: ${cord.source})`)
    }

    const nmDevices = rackMounted.filter((d) => DEVICE_CATALOGUE[d.model].needsUplinkModule)
    if (nmDevices.length > 0) {
      lines.push(
        line({
          key: 'power:nm',
          category: 'Power & accessories',
          item: UPLINK_MODULE.label,
          spec: UPLINK_MODULE.spec,
          basis: `${nmDevices.length} Edge switches`,
          qty: nmDevices.length,
          unit: 'Each',
          status: 'Compatibility check',
          vendor: UPLINK_MODULE.vendor,
          unitPrice: UPLINK_MODULE.unitPrice,
        })
      )
      calc.push(`Network modules: ${nmDevices.length} Edge switches`)
    }

    const cageQty = rackMounted.length * CAGE_NUT_SET.mountingPointsPerDevice
    lines.push(
      line({
        key: 'power:cage-nuts',
        category: 'Power & accessories',
        item: CAGE_NUT_SET.label,
        spec: CAGE_NUT_SET.spec,
        basis: `${rackMounted.length} wired switches × ${CAGE_NUT_SET.mountingPointsPerDevice}`,
        qty: cageQty,
        unit: 'Set',
        status: 'Calculated',
        vendor: CAGE_NUT_SET.vendor,
        unitPrice: CAGE_NUT_SET.unitPrice,
      })
    )
    calc.push(`M6 sets: ${rackMounted.length} switches × ${CAGE_NUT_SET.mountingPointsPerDevice} = ${cageQty}`)
  }

  // Stack cables: genuinely zero when no two Edge devices share a room —
  // B001 has exactly one Edge per comms room, so this is a real 0, not a
  // placeholder (brief Step 7 / render page 10).
  const roomCounts = new Map()
  for (const d of devices.filter((d) => d.role === 'edge')) {
    roomCounts.set(d.roomId, (roomCounts.get(d.roomId) ?? 0) + 1)
  }
  const stackedRooms = [...roomCounts.values()].filter((n) => n > 1).length
  lines.push(
    line({
      key: 'power:stack-cable',
      category: 'Power & accessories',
      item: 'Data stacking cable',
      spec: 'StackWise',
      basis: stackedRooms > 0 ? `${stackedRooms} room(s) with stacked switches` : 'Not applicable — one switch per room',
      qty: stackedRooms,
      unit: 'Each',
      status: stackedRooms > 0 ? 'Calculated' : 'Not required',
      vendor: 'Cisco',
      unitPrice: 40,
    })
  )
  calc.push(`Stack cables: ${stackedRooms}`)

  return { lines, calc }
}

// --- Whole-BOM assembly ----------------------------------------------------

export function buildBom(devices, connections, rows, options = {}) {
  const network = buildNetworkDeviceLines(devices)
  const optics = buildOpticsLines(connections)
  const cables = buildCableLines(rows)
  const power = buildPowerAccessoryLines(devices, options)

  const lines = [...network.lines, ...optics.lines, ...cables.lines, ...power.lines]
  const calc = [...network.calc, ...optics.calc, ...cables.calc, ...power.calc]

  return { lines, calc, currency: CURRENCY }
}

export function bomLineCount(bom) {
  return bom.lines.length
}

// Reconciliation: the sum of procured network-device line quantities
// (everything except the static probe line) must equal the number of real
// HLD/LLD devices placed, excluding the WAN circuit.
export function reconcileDeviceCounts(devices, bom) {
  const realCount = devices.filter((d) => d.role !== 'wan-circuit').length
  const bomCount = bom.lines.filter((l) => l.category === 'Network devices' && l.key !== 'device:probe').reduce((sum, l) => sum + l.qty, 0)
  return { realCount, bomCount, reconciled: realCount === bomCount }
}
