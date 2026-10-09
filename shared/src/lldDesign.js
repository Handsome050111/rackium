// LLD design rules (brief v2.3 §5.4, §6.1–6.3, §6.10): port keys and
// suggestions for the Rackium Editor, the LLD-only validation checks, the
// diff between two design versions and the HLD → LLD reconciliation.
// Pure; used by the server (registries, validation, versions) and the client.
import { expandPortMap } from './catalogue.js'
import { validateHld, portSuitsMedia, HLD_RULES } from './hldRules.js'
import { roleInfo } from './hldRoles.js'

// --- Ports ---------------------------------------------------------------------

// A patch-panel port has a rear (where a hop comes in) and a front (where it
// goes out, or where a direct cable lands). Device ports have one side.
export const PANEL_SIDES = ['rear', 'front']
export function portKey(portId, side = null) {
  return side ? `${String(portId).trim().toLowerCase()}#${side}` : String(portId).trim().toLowerCase()
}

export const isPatchPanel = (item, device) => item?.category === 'patch_panel' || /patch panel/i.test(`${device?.category ?? ''} ${device?.label ?? ''}`)

// A patch panel without a catalogue model (surveyed library item): 24 or
// 48 numbered ports, copper unless it says fibre.
export function fallbackPanelPorts(device) {
  const count = Number(String(device?.label ?? '').match(/(\d+)-port/)?.[1] ?? 24)
  const fibre = /fibre|fiber|lc/i.test(`${device?.label ?? ''} ${device?.model ?? ''}`)
  return Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), n: i + 1, role: 'access', type: fibre ? 'LC' : 'RJ45', speed: null, poe: false }))
}

export function portsOf(item, device) {
  if (item?.portMap) return expandPortMap(item.portMap)
  if (isPatchPanel(item, device)) return fallbackPanelPorts(device)
  return []
}

// Every port of a device with its state for one medium: free or occupied
// (`occupiedKeys`, a Set of portKey values), compatible or not. The system
// suggests; it never assigns (brief §5.4).
export function portOptions(ports, { media, occupiedKeys = new Set(), side = null }) {
  return ports.map((p) => ({
    id: p.id,
    n: p.n,
    type: p.type,
    speed: p.speed ?? null,
    role: p.role,
    occupied: occupiedKeys.has(portKey(p.id, side)),
    compatible: media ? portSuitsMedia(p.type, media) : true,
  }))
}
export function suggestPort(options) {
  return options.find((o) => !o.occupied && o.compatible)?.id ?? null
}

// --- LLD-only checks (on top of the HLD rules) -----------------------------------

export const LLD_RULES = {
  'L-PORT': { severity: 'critical', title: 'Port not assigned (ports are mandatory in LLD)' },
  'L-CABLE-ID': { severity: 'critical', title: 'Cable ID missing (mandatory once LLD is approved)' },
  'L-PLACEMENT': { severity: 'critical', title: 'Rack-mounted device not placed in a rack at an RU' },
  'L-HOP': { severity: 'critical', title: 'Patch-panel hop is not valid' },
}
const lldFinding = (rule, objectType, objectId, message, suffix = '') => ({
  id: `${rule}:${objectType}:${objectId}${suffix ? `:${suffix}` : ''}`,
  rule,
  severity: LLD_RULES[rule].severity,
  title: LLD_RULES[rule].title,
  message,
  objectType,
  objectId: String(objectId),
})

// `design` as for validateHld; devices may carry `planned` and placement.
export function validateLld(design, ctx) {
  const findings = validateHld(design, ctx)
  const deviceById = ctx.deviceById ?? new Map(design.devices.map((d) => [String(d.id), d]))
  const name = (d) => d?.hostname ?? d?.label ?? 'device'
  for (const d of design.devices) {
    if (d.origin !== 'planned') continue
    const item = ctx.itemOf(d)
    const racked = item ? Boolean(item.rackMounted) : roleInfo(d.role) && d.role !== 'ap' && !roleInfo(d.role).group.startsWith('external')
    if (!racked) continue
    if (!d.rackId) findings.push(lldFinding('L-PLACEMENT', 'device', d.id, `${name(d)} is not placed in a rack`))
    else if ((item?.heightU ?? d.heightU ?? 1) > 0 && d.ru == null) findings.push(lldFinding('L-PLACEMENT', 'device', d.id, `${name(d)} has a rack but no RU`))
  }
  for (const c of design.connections) {
    const a = deviceById.get(String(c.source.deviceId))
    const b = deviceById.get(String(c.dest.deviceId))
    for (const [side, end, dev] of [['source', c.source, a], ['dest', c.dest, b]]) {
      if (!end.portId) findings.push(lldFinding('L-PORT', 'connection', c.id, `${name(a)} → ${name(b)}: no ${side === 'source' ? 'source' : 'destination'} port on ${name(dev)}`, side))
    }
    if (!c.cableId) findings.push(lldFinding('L-CABLE-ID', 'connection', c.id, `${name(a)} → ${name(b)}: no Cable ID`))
    for (const hop of c.hops ?? []) {
      const panel = deviceById.get(String(hop.patchPanelId))
      const ports = panel ? portsOf(ctx.itemOf(panel), panel) : []
      const bad = !panel
        ? 'the patch panel is not in this design'
        : !ports.some((p) => p.id.toLowerCase() === String(hop.inPort).toLowerCase()) || !ports.some((p) => p.id.toLowerCase() === String(hop.outPort).toLowerCase())
          ? `port ${hop.inPort}/${hop.outPort} is not on ${name(panel)}`
          : !portSuitsMedia(ports[0]?.type, c.media)
            ? `${name(panel)} is a ${ports[0]?.type} panel, the link is ${c.media.toUpperCase()}`
            : null
      if (bad) findings.push(lldFinding('L-HOP', 'connection', c.id, `${name(a)} → ${name(b)}, hop ${hop.seq}: ${bad}`, `hop-${hop.seq}`))
    }
  }
  return findings.sort((x, y) => ['critical', 'warning', 'info'].indexOf(x.severity) - ['critical', 'warning', 'info'].indexOf(y.severity) || x.rule.localeCompare(y.rule))
}
export const ALL_RULES = { ...HLD_RULES, ...LLD_RULES }

// --- Version diff (brief §6.10) ----------------------------------------------------

const DEVICE_FIELDS = ['hostname', 'role', 'catalogueKey', 'roomId', 'rackId', 'ru', 'face']
const CONNECTION_FIELDS = ['source', 'dest', 'media', 'speed', 'sourceSfpCode', 'destSfpCode', 'cableId', 'hops', 'engineerSelectedM']
const show = (v) => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : v)
const flatConn = (c) => ({
  ...c,
  source: `${c.source.deviceId}:${c.source.portId ?? '—'}`,
  dest: `${c.dest.deviceId}:${c.dest.portId ?? '—'}`,
  hops: (c.hops ?? []).map((h) => `${h.patchPanelId}:${h.inPort}>${h.outPort}${h.segmentCableId ? `[${h.segmentCableId}]` : ''}`).join(' | ') || null,
  engineerSelectedM: c.lengths?.engineerSelectedM ?? null,
})

function diffList(before, after, fields, labelOf, keyOf = (x) => String(x.id)) {
  const a = new Map(before.map((x) => [keyOf(x), x]))
  const b = new Map(after.map((x) => [keyOf(x), x]))
  const added = [...b.entries()].filter(([k]) => !a.has(k)).map(([k, x]) => ({ id: k, label: labelOf(x, 'after') }))
  const removed = [...a.entries()].filter(([k]) => !b.has(k)).map(([k, x]) => ({ id: k, label: labelOf(x, 'before') }))
  const changed = []
  for (const [k, x] of b) {
    if (!a.has(k)) continue
    const y = a.get(k)
    const fieldChanges = fields.filter((f) => show(y[f]) !== show(x[f])).map((f) => ({ field: f, before: show(y[f]), after: show(x[f]) }))
    if (fieldChanges.length) changed.push({ id: k, label: labelOf(x, 'after'), fields: fieldChanges })
  }
  return { added, removed, changed }
}

// Two design snapshots ({ devices, connections }) → what was added, removed
// and changed between them.
export function diffDesigns(before, after) {
  const names = (snap) => new Map((snap.devices ?? []).map((d) => [String(d.id), d.hostname ?? d.label ?? d.role ?? 'device']))
  const nb = names(before)
  const na = names(after)
  const label = (n) => (c) => `${n.get(String(c.source.deviceId)) ?? '?'} ${c.source.portId ?? ''} → ${n.get(String(c.dest.deviceId)) ?? '?'} ${c.dest.portId ?? ''}`.replace(/\s+/g, ' ').trim()
  const labels = new Map([...(before.connections ?? []).map((c) => [String(c.id), label(nb)(c)]), ...(after.connections ?? []).map((c) => [String(c.id), label(na)(c)])])
  const devices = diffList(before.devices ?? [], after.devices ?? [], DEVICE_FIELDS, (d) => d.hostname ?? d.label ?? d.role)
  const connections = diffList((before.connections ?? []).map(flatConn), (after.connections ?? []).map(flatConn), CONNECTION_FIELDS, (c) => labels.get(String(c.id)))
  const count = (x) => x.added.length + x.removed.length + x.changed.length
  return { devices, connections, total: count(devices) + count(connections) }
}

// --- HLD → LLD reconciliation (brief §5.4: no automatic re-sync) ---------------

// `hld`: the approved HLD snapshot; `lld`: the LLD's devices and connections,
// each carrying `hldRef` (the HLD item it was copied from; null = LLD-only,
// e.g. a patch panel). Compares what HLD decides: devices (role, model, room)
// and uplinks (endpoints, media, speed, optics).
export function reconcileWithHld(hld, lld) {
  const lldDevices = (lld.devices ?? []).filter((d) => d.hldRef)
  const toHldId = new Map(lldDevices.map((d) => [String(d.id), String(d.hldRef)]))
  const asHld = (c) => ({
    ...c,
    id: String(c.hldRef),
    source: { deviceId: toHldId.get(String(c.source.deviceId)) ?? `lld:${c.source.deviceId}` },
    dest: { deviceId: toHldId.get(String(c.dest.deviceId)) ?? `lld:${c.dest.deviceId}` },
  })
  const hldName = new Map((hld.devices ?? []).map((d) => [String(d.id), d.hostname ?? d.label ?? d.role]))
  const devices = diffList(
    (hld.devices ?? []).map((d) => ({ ...d, id: String(d.id) })),
    lldDevices.map((d) => ({ ...d, id: String(d.hldRef) })),
    ['role', 'catalogueKey', 'roomId'],
    (d) => d.hostname ?? d.label ?? d.role
  )
  const endpoints = (c) => [c.source.deviceId, c.dest.deviceId].map(String).sort().join('|')
  const hldConns = (hld.connections ?? []).map((c) => ({ ...c, id: String(c.id), endpoints: endpoints(c) }))
  const lldConns = (lld.connections ?? []).filter((c) => c.hldRef).map(asHld).map((c) => ({ ...c, endpoints: endpoints(c) }))
  const label = (c) => `${hldName.get(String(c.source.deviceId)) ?? 'LLD device'} → ${hldName.get(String(c.dest.deviceId)) ?? 'LLD device'}`
  const connections = diffList(hldConns, lldConns, ['endpoints', 'media', 'speed', 'sourceSfpCode', 'destSfpCode'], label)
  // diffList(before = HLD, after = LLD): removed = only in the HLD (not in
  // the LLD yet); added = only in the LLD (no longer in the HLD).
  return {
    devices: { inHldOnly: devices.removed, inLldOnly: devices.added, changed: devices.changed },
    connections: { inHldOnly: connections.removed, inLldOnly: connections.added, changed: connections.changed },
    total: devices.added.length + devices.removed.length + devices.changed.length + connections.added.length + connections.removed.length + connections.changed.length,
  }
}
