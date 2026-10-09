// HLD validation engine (brief v2.3 §6.8, v2.2 §5 and §5.1): VAL-001 to
// VAL-013 plus the brief's listed Critical / Warning / Info checks that apply
// at HLD level. Pure rules over the design's own data — no machine learning.
// The server runs this on every Validate, before Submit (Critical blocks it),
// and the uplink wizard uses the connection rules for its per-step checks.
//
// A rule whose input does not exist yet (e.g. rack weight without a rack
// load limit) is silently not applicable rather than guessed.
import { DEFAULT_MEDIA_LIMITS_M } from './cableLength.js'
import { findConflicts } from './rackValidation.js'
import { expandPortMap } from './catalogue.js'
import { roleInfo } from './hldRoles.js'

export const SEVERITIES = ['critical', 'warning', 'info']
export const SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' }

// Rule catalogue: id, severity, short description (brief v2.2 §5.1 / v2.3 §6.8).
export const HLD_RULES = {
  'VAL-001': { severity: 'critical', title: 'Port media mismatch — SFP type does not match cable media' },
  'VAL-002': { severity: 'critical', title: 'SFP module incompatible with port slot type' },
  'VAL-003': { severity: 'critical', title: 'Device placed in rack with no power connection defined' },
  'VAL-004': { severity: 'critical', title: 'Cable route requires patch panel with 0 free ports' },
  'VAL-005': { severity: 'critical', title: 'Device requires dual PSU but only single configured' },
  'VAL-006': { severity: 'critical', title: 'Rack weight exceeds manufacturer specification' },
  'VAL-007': { severity: 'critical', title: 'RU position overlaps with another device' },
  'VAL-008': { severity: 'warning', title: 'Cable length within 90% of media specification limit' },
  'VAL-009': { severity: 'warning', title: 'PoE budget utilisation exceeds 80% on device' },
  'VAL-010': { severity: 'warning', title: 'Stack member count approaching platform maximum' },
  'VAL-011': { severity: 'critical', title: 'Cable length exceeds the media or optic limit' },
  'VAL-012': { severity: 'warning', title: 'No stock cable length long enough; custom length required' },
  'VAL-013': { severity: 'critical', title: 'Duplicate Cable ID in project' },
  // Listed checks without a VAL number (v2.2 §5).
  'W-SINGLE-PSU': { severity: 'warning', title: 'Single PSU when device supports dual (no power redundancy)' },
  'W-SINGLE-PDU': { severity: 'warning', title: 'Single PDU (no power redundancy)' },
  'W-EMPTY-RU': { severity: 'warning', title: 'Empty RU count exceeds 50% of rack' },
  'I-BELOW-SPEED': { severity: 'info', title: 'Link negotiates below maximum speed' },
  'I-NO-HOSTNAME': { severity: 'info', title: 'Device has no hostname assigned' },
  'I-TBD': { severity: 'info', title: 'TBD fields remaining in connection record' },
  'I-CMO-UNVALIDATED': { severity: 'info', title: 'CMO device not yet validated during survey' },
  'I-ESTIMATED-PATH': { severity: 'info', title: 'Cable pathway not surveyed (length is estimated)' },
}

// Core switches must be built redundant (brief: VAL-005 "requires dual
// PSU"); other dual-capable devices only warn (W-SINGLE-PSU).
export const DUAL_PSU_REQUIRED_ROLES = ['fusion', 'border', 'distribution']
export const DEFAULT_STACK_MAX = 8
const OPTICAL_MEDIA = new Set(['os2', 'om4'])
const POWERED_EXEMPT_CATEGORIES = new Set(['patch_panel', 'cable_management', 'accessory', 'cage_nut', 'cabinet', 'pdu', 'wan_sp_connection', 'remote_site', 'ap'])

const finding = (rule, objectType, objectId, message, extra = {}) => ({
  id: `${rule}:${objectType}:${objectId}${extra.suffix ? `:${extra.suffix}` : ''}`,
  rule,
  severity: HLD_RULES[rule].severity,
  title: HLD_RULES[rule].title,
  message,
  objectType,
  objectId: String(objectId),
})

const isSfpPortType = (type) => /SFP|QSFP/i.test(String(type ?? ''))

// The length limit of a link: the media limit, lowered by either end's optic reach.
export function linkLimitM(conn, opticOf) {
  const limits = [DEFAULT_MEDIA_LIMITS_M[conn.media]]
  for (const code of [conn.sourceSfpCode, conn.destSfpCode]) {
    const reach = code ? opticOf(code)?.mediaSpeed?.reachM : null
    if (reach) limits.push(reach)
  }
  const known = limits.filter((v) => typeof v === 'number')
  return known.length ? Math.min(...known) : null
}

// --- Connection rules (also the uplink wizard's checks) ---------------------

// `ctx`: { deviceById, itemOf(device) → catalogue item | null, opticOf(code) → optic item | null,
//          patchPanelFreePorts(roomId, kind) → number | null }
// `conn` carries its computed length: { lengthM, lengthEstimated, customLengthRequired }.
export function connectionFindings(conn, ctx) {
  const out = []
  const ends = [
    { side: 'source', end: conn.source, sfp: conn.sourceSfpCode },
    { side: 'dest', end: conn.dest, sfp: conn.destSfpCode },
  ]
  const label = () => {
    const a = ctx.deviceById.get(String(conn.source.deviceId))
    const b = ctx.deviceById.get(String(conn.dest.deviceId))
    return `${a?.hostname ?? a?.label ?? 'device'} → ${b?.hostname ?? b?.label ?? 'device'}`
  }

  for (const { side, end, sfp } of ends) {
    const device = ctx.deviceById.get(String(end.deviceId))
    const item = device ? ctx.itemOf(device) : null
    if (sfp) {
      const optic = ctx.opticOf(sfp)
      const ms = optic?.mediaSpeed
      if (!OPTICAL_MEDIA.has(conn.media)) {
        out.push(finding('VAL-001', 'connection', conn.id, `${label()}: ${sfp} on a ${conn.media.toUpperCase()} link — this media takes no SFP`, { suffix: side }))
      } else if (!ms) {
        out.push(finding('VAL-001', 'connection', conn.id, `${label()}: ${sfp} is not a known optic`, { suffix: side }))
      } else if (ms.media !== conn.media || String(ms.speed) !== String(conn.speed)) {
        out.push(finding('VAL-001', 'connection', conn.id, `${label()}: ${sfp} is ${ms.media.toUpperCase()} ${ms.speed}, the link is ${conn.media.toUpperCase()} ${conn.speed}`, { suffix: side }))
      }
      // VAL-002: the optic must suit the device's port slots.
      if (item) {
        const ports = expandPortMap(item.portMap)
        const port = end.portId ? ports.find((p) => p.id.toLowerCase() === String(end.portId).toLowerCase()) : null
        const hasSfpSlot = port ? isSfpPortType(port.type) : ports.some((p) => isSfpPortType(p.type))
        const listed = !item.compatibleSfps?.length || item.compatibleSfps.some((k) => k.toLowerCase() === sfp.toLowerCase() || k.toLowerCase().endsWith(` ${sfp.toLowerCase()}`))
        if (!hasSfpSlot) out.push(finding('VAL-002', 'connection', conn.id, `${label()}: ${port ? `port ${port.id} (${port.type})` : device.hostname ?? 'the device'} has no SFP slot for ${sfp}`, { suffix: side }))
        else if (!listed) out.push(finding('VAL-002', 'connection', conn.id, `${label()}: ${sfp} is not a compatible optic for ${item.vendor} ${item.model}`, { suffix: side }))
      }
    } else if (OPTICAL_MEDIA.has(conn.media)) {
      out.push(finding('I-TBD', 'connection', conn.id, `${label()}: no SFP chosen at the ${side === 'source' ? 'source' : 'destination'} end`, { suffix: `sfp-${side}` }))
    }
    // Info: the link runs below what the port can do.
    if (item && end.portId) {
      const port = expandPortMap(item.portMap).find((p) => p.id.toLowerCase() === String(end.portId).toLowerCase())
      if (port?.speed && speedValue(port.speed) > speedValue(conn.speed)) out.push(finding('I-BELOW-SPEED', 'connection', conn.id, `${label()}: ${port.id} is ${port.speed}, the link runs at ${conn.speed}`, { suffix: side }))
    }
  }

  // VAL-004: the destination room's patch panels for this media have no free port.
  if (conn.viaPatchPanel) {
    const destDevice = ctx.deviceById.get(String(conn.dest.deviceId))
    const free = destDevice?.roomId ? ctx.patchPanelFreePorts?.(destDevice.roomId, conn.media === 'cat6a' ? 'copper' : 'fibre') : null
    if (free === 0) out.push(finding('VAL-004', 'connection', conn.id, `${label()}: the patch panel in the destination room has 0 free ports`))
  }

  // Length rules.
  const limit = linkLimitM(conn, ctx.opticOf)
  if (conn.lengthM != null && limit != null) {
    if (conn.lengthM > limit) out.push(finding('VAL-011', 'connection', conn.id, `${label()}: ${round(conn.lengthM)} m exceeds the ${limit} m limit of ${conn.media.toUpperCase()}${limit < (DEFAULT_MEDIA_LIMITS_M[conn.media] ?? Infinity) ? ' with this optic' : ''}`))
    else if (conn.lengthM >= 0.9 * limit) out.push(finding('VAL-008', 'connection', conn.id, `${label()}: ${round(conn.lengthM)} m is within 90% of the ${limit} m limit`))
  }
  if (conn.lengthM != null && conn.customLengthRequired) out.push(finding('VAL-012', 'connection', conn.id, `${label()}: no stock ${conn.media.toUpperCase()} cable is long enough for ${round(conn.lengthM)} m — custom length required`))
  if (conn.lengthEstimated) out.push(finding('I-ESTIMATED-PATH', 'connection', conn.id, `${label()}: no surveyed pathway between the rooms — the length is an estimate`))
  return out
}

const round = (m) => Math.round(m * 10) / 10
function speedValue(s) {
  const m = String(s ?? '').match(/^([\d.]+)\s*G/i)
  return m ? Number(m[1]) : 0
}

// --- Whole-design rules -----------------------------------------------------

// `design`: { devices, connections, racks: [{ id, code, heightU, maxLoadKg? }], cmoUnplaced: [{ id, label }] }
// Devices: { id, hostname, role, origin, roomId, rackId, ru, heightU, face, fullDepth, label, psuConfigured }
export function validateHld(design, ctx) {
  const out = []
  const { devices = [], connections = [], racks = [], cmoUnplaced = [] } = design
  const deviceById = ctx.deviceById ?? new Map(devices.map((d) => [String(d.id), d]))
  const full = { ...ctx, deviceById }

  for (const conn of connections) out.push(...connectionFindings(conn, full))

  // VAL-013: one cable ID per connection or hop segment, case-insensitive.
  const byCableId = new Map()
  for (const conn of connections) {
    for (const id of [conn.cableId, ...(conn.hops ?? []).map((h) => h.segmentCableId)].filter(Boolean)) {
      const key = String(id).trim().toLowerCase()
      byCableId.set(key, [...(byCableId.get(key) ?? []), { conn, id }])
    }
  }
  for (const uses of byCableId.values()) {
    if (uses.length < 2) continue
    for (const { conn, id } of uses) out.push(finding('VAL-013', 'connection', conn.id, `Cable ID ${id} is used ${uses.length} times in the project`, { suffix: String(id).toLowerCase() }))
  }

  // Device rules.
  for (const d of devices) {
    const info = roleInfo(d.role)
    const item = ctx.itemOf(d)
    if (info?.named && !d.hostname) out.push(finding('I-NO-HOSTNAME', 'device', d.id, `${d.label ?? info.label} has no hostname`))
    if (d.origin === 'planned' && item?.psuCount >= 2 && d.psuConfigured != null && d.psuConfigured < 2) {
      if (DUAL_PSU_REQUIRED_ROLES.includes(d.role)) out.push(finding('VAL-005', 'device', d.id, `${d.hostname ?? d.label}: a ${info?.label ?? d.role} switch needs dual PSUs; ${d.psuConfigured} configured`))
      else out.push(finding('W-SINGLE-PSU', 'device', d.id, `${d.hostname ?? d.label}: ${item.model} supports ${item.psuCount} PSUs; ${d.psuConfigured} configured`))
    }
  }

  // VAL-009: PoE drawn by connected powered devices vs the switch's budget.
  for (const sw of devices) {
    const budget = ctx.itemOf(sw)?.poeBudgetW
    if (!budget) continue
    let drawn = 0
    for (const conn of connections) {
      const otherId = String(conn.source.deviceId) === String(sw.id) ? conn.dest.deviceId : String(conn.dest.deviceId) === String(sw.id) ? conn.source.deviceId : null
      const other = otherId ? deviceById.get(String(otherId)) : null
      if (other?.role === 'ap') drawn += ctx.itemOf(other)?.powerDrawW ?? 0
    }
    if (drawn > 0.8 * budget) out.push(finding('VAL-009', 'device', sw.id, `${sw.hostname ?? sw.label}: PoE ${Math.round(drawn)} W of ${budget} W (${Math.round((drawn / budget) * 100)}%)`))
  }

  // VAL-010: stacks (devices joined by stack cables) approaching the platform maximum.
  const stackEdges = connections.filter((c) => c.media === 'stack')
  if (stackEdges.length) {
    const parent = new Map()
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x)
      while (parent.get(x) !== x) x = parent.get(x)
      return x
    }
    for (const c of stackEdges) {
      const a = find(String(c.source.deviceId))
      const b = find(String(c.dest.deviceId))
      if (a !== b) parent.set(a, b)
    }
    const groups = new Map()
    for (const id of parent.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id])
    for (const members of groups.values()) {
      const first = deviceById.get(members[0])
      const max = ctx.itemOf(first)?.maxStackMembers ?? DEFAULT_STACK_MAX
      if (members.length > 0.8 * max) out.push(finding('VAL-010', 'device', members[0], `Stack of ${members.length} members — the platform maximum is ${max}`))
    }
  }

  // Rack rules.
  for (const rack of racks) {
    const inRack = devices.filter((d) => String(d.rackId) === String(rack.id))
    const placed = inRack.filter((d) => d.ru != null && d.heightU > 0).map((d) => ({ id: String(d.id), ru: d.ru, heightU: d.heightU, face: d.face ?? 'front', fullDepth: Boolean(d.fullDepth), kind: 'device', label: d.hostname ?? d.label ?? 'device' }))
    const reported = new Set()
    for (const p of placed) {
      for (const c of findConflicts(p, placed, rack.heightU, p.id)) {
        const pair = c.withId ? [p.id, c.withId].sort().join('|') : `${p.id}|boundary`
        if (reported.has(pair)) continue
        reported.add(pair)
        out.push(finding('VAL-007', 'rack', rack.id, `Rack ${rack.code}: ${p.label} — ${c.message}`, { suffix: pair }))
      }
    }
    const hasPlanned = inRack.some((d) => d.origin === 'planned')
    if (!hasPlanned) continue
    const pdus = inRack.filter((d) => d.role === 'pdu' || ctx.itemOf(d)?.category === 'pdu' || /pdu/i.test(d.label ?? ''))
    for (const d of inRack) {
      const category = ctx.itemOf(d)?.category
      if (d.origin !== 'planned' || POWERED_EXEMPT_CATEGORIES.has(category) || d.role === 'pdu') continue
      if (pdus.length === 0) out.push(finding('VAL-003', 'device', d.id, `${d.hostname ?? d.label}: rack ${rack.code} has no PDU to power it`))
    }
    if (pdus.length === 1) out.push(finding('W-SINGLE-PDU', 'rack', rack.id, `Rack ${rack.code} has a single PDU (no power redundancy)`))
    if (rack.maxLoadKg) {
      const weight = inRack.reduce((sum, d) => sum + (ctx.itemOf(d)?.weightKg ?? 0), 0)
      if (weight > rack.maxLoadKg) out.push(finding('VAL-006', 'rack', rack.id, `Rack ${rack.code}: ${Math.round(weight)} kg exceeds the ${rack.maxLoadKg} kg limit`))
    }
    const usedRu = placed.reduce((sum, p) => sum + p.heightU, 0)
    if (rack.heightU && rack.heightU - usedRu > rack.heightU / 2) out.push(finding('W-EMPTY-RU', 'rack', rack.id, `Rack ${rack.code}: ${rack.heightU - usedRu} of ${rack.heightU} RU empty`))
  }

  for (const d of cmoUnplaced) out.push(finding('I-CMO-UNVALIDATED', 'device', d.id, `CMO device ${d.label} has not been found in a rack during the survey`))

  return sortFindings(dedupe(out))
}

function dedupe(findings) {
  const seen = new Set()
  return findings.filter((f) => (seen.has(f.id) ? false : seen.add(f.id)))
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message))
}

export function summariseFindings(findings) {
  const counts = { critical: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity] += 1
  return { ...counts, blocksSubmit: counts.critical > 0 }
}

// The uplink wizard's step-4 checks (prototype EditUplinkPanel shape:
// { id, label, status: pass | fail | info, message }) from the same rules.
export function uplinkChecks(conn, ctx, { portsFree = { source: true, dest: true } } = {}) {
  const found = connectionFindings(conn, ctx)
  const has = (...rules) => found.filter((f) => rules.includes(f.rule))
  const checks = []
  const portsOk = portsFree.source && portsFree.dest
  checks.push({ id: 'port-availability', label: 'Port availability', status: portsOk ? 'pass' : 'fail', message: portsOk ? (conn.source.portId || conn.dest.portId ? 'Chosen ports are free' : 'No ports chosen yet — optional in HLD') : 'Source or destination port already in use' })
  const sfp = has('VAL-001', 'VAL-002')
  checks.push({
    id: 'sfp-compatibility',
    label: 'SFP compatibility',
    status: sfp.length ? 'fail' : OPTICAL_MEDIA.has(conn.media) && (!conn.sourceSfpCode || !conn.destSfpCode) ? 'info' : 'pass',
    message: sfp.length ? sfp.map((f) => `${f.rule}: ${f.message.split(': ').slice(1).join(': ')}`).join(' · ') : OPTICAL_MEDIA.has(conn.media) ? (conn.sourceSfpCode && conn.destSfpCode ? `${conn.sourceSfpCode} / ${conn.destSfpCode} match ${conn.media.toUpperCase()} ${conn.speed}` : 'Choose an SFP for both ends') : `${conn.media.toUpperCase()} needs no SFP`,
  })
  const len = has('VAL-011', 'VAL-008', 'VAL-012')
  const limit = linkLimitM(conn, ctx.opticOf)
  checks.push({
    id: 'distance-support',
    label: 'Distance support',
    status: len.some((f) => f.severity === 'critical') ? 'fail' : len.length ? 'info' : 'pass',
    message: len.length ? len.map((f) => `${f.rule}: ${f.message.split(': ').slice(1).join(': ')}`).join(' · ') : conn.lengthM == null ? 'No length estimate yet' : `${round(conn.lengthM)} m within the ${limit} m limit`,
  })
  checks.push({ id: 'surveyed-pathway', label: 'Surveyed pathway', status: conn.lengthEstimated ? 'info' : 'pass', message: conn.lengthEstimated ? 'No surveyed pathway — length is an estimate' : 'Length from the survey' })
  if (conn.viaPatchPanel) {
    const pp = has('VAL-004')
    checks.push({ id: 'patch-panel-capacity', label: 'Patch-panel capacity', status: pp.length ? 'fail' : 'pass', message: pp.length ? 'VAL-004: no free ports on the destination patch panel' : 'Free ports available' })
  }
  return { checks, findings: found, blocked: found.some((f) => f.severity === 'critical') || !portsOk }
}
