// Blueprint templates and rule-based "Generate HLD" (brief v2.3 §5.3: the
// selected blueprint template filled with the verified survey's rooms,
// racks and pathways; v2.2 §3.6A, BPT-001: sizes S/M/L/XL with topology
// variants). Plain rules, not machine learning. Idempotent: it returns only
// what is missing, so running it again after applying its result adds nothing.
// Devices come with a suggested rack (v2.2 §3.6A "suggested rack
// assignments"); RU positions stay the Architect's (brief §5.4).

export const BLUEPRINT_VARIANTS = [
  { key: 'single_path', label: 'Single path', description: 'No redundancy — a single uplink per layer.' },
  {
    key: 'redundant_distribution',
    label: 'Redundant distribution',
    description: 'Two Distribution switches (one pair per building for M, per floor for L and XL); every Edge dual-homed to both; each Distribution uplinked to Border and Fusion.',
  },
]
export const BLUEPRINT_VARIANT_KEYS = BLUEPRINT_VARIANTS.map((v) => v.key)

// fusion: a Fusion switch next to Border; distribution: 'none' | 'building'
// (M's pair, only with the redundant variant) | 'floor'; services: Firewall
// and WLC in the main room. `variants`: allowed, the first is the default.
export const BLUEPRINT_PRESETS = [
  { key: 'S', label: 'Small', description: 'Border in the main room; one Edge and AP per comms room with a rack. No distribution layer.', fusion: false, distribution: 'none', services: false, variants: ['single_path'] },
  { key: 'M', label: 'Medium', description: 'Fusion and Border in the main room; one Edge and AP per comms room with a rack; a Distribution pair with the redundant variant.', fusion: true, distribution: 'building', services: false, variants: ['single_path', 'redundant_distribution'] },
  { key: 'L', label: 'Large', description: 'Medium plus a Distribution layer per floor; Edges uplink to their floor’s Distribution.', fusion: true, distribution: 'floor', services: false, variants: ['single_path', 'redundant_distribution'] },
  { key: 'XL', label: 'Extra large', description: 'Large plus Firewall and WLC in the main room; redundant distribution by default.', fusion: true, distribution: 'floor', services: true, variants: ['redundant_distribution', 'single_path'] },
]
export const BLUEPRINT_KEYS = BLUEPRINT_PRESETS.map((p) => p.key)
export const presetOf = (key) => BLUEPRINT_PRESETS.find((p) => p.key === key) ?? null
export const defaultVariantOf = (key) => presetOf(key)?.variants[0] ?? null

// Null when the size/variant pair is allowed, else why not.
export function blueprintProblem(size, variant) {
  const preset = presetOf(size)
  if (!preset) return `Unknown blueprint size ${size}`
  if (variant && !preset.variants.includes(variant)) return `Size ${size} has no ${BLUEPRINT_VARIANTS.find((v) => v.key === variant)?.label ?? variant} variant`
  return null
}

// Roles that are not placed in a rack (ceiling APs, provider hand-offs).
const UNRACKED_ROLES = new Set(['ap', 'wan_circuit', 'remote_site'])

// Media for a planned link: copper for an AP drop, multimode fibre inside a
// room, single-mode between rooms (brief §6.4 defaults).
export function linkMedia({ sameRoom, apLink }) {
  if (apLink) return { media: 'cat6a', speed: '1G' }
  return sameRoom ? { media: 'om4', speed: '10G' } : { media: 'os2', speed: '10G' }
}

// rooms: [{ id, floorId, isMainRoom, rackIds: [ordered rack ids] }] (verified
// survey); floors: [{ id, order }]; devices: existing HLD devices
// [{ id, role, roomId }]; links: existing [{ sourceId, destId }].
// Returns { devices: [{ key, role, roomId, rackId }], links: [{ from, to, media, speed }] }
// where from/to are an existing device id or a new device's key.
export function generateFromBlueprint({ preset: size, variant: requested, rooms, floors, devices, links }) {
  const variant = requested ?? defaultVariantOf(size)
  const problem = blueprintProblem(size, variant)
  if (problem) throw new Error(problem)
  const preset = presetOf(size)
  const redundant = variant === 'redundant_distribution'
  const out = { devices: [], links: [] }
  const rackRooms = rooms.filter((r) => r.rackIds?.length)
  const mainRoom = rooms.find((r) => r.isMainRoom) ?? rackRooms[0] ?? rooms[0] ?? null
  if (!mainRoom) return out
  const floorOrder = new Map(floors.map((f) => [f.id, f.order ?? 0]))
  const roomById = new Map(rooms.map((r) => [r.id, r]))

  // The n-th device of a role in a room (existing first, then planned); created when missing.
  const nth = (role, roomId, n) => {
    const existing = devices.filter((d) => d.role === role && String(d.roomId) === String(roomId)).map((d) => d.id)
    const planned = out.devices.filter((d) => d.role === role && d.roomId === roomId).map((d) => d.key)
    const all = [...existing, ...planned]
    if (all[n]) return all[n]
    let ref = null
    for (let i = all.length; i <= n; i++) {
      const rackIds = roomById.get(roomId)?.rackIds ?? []
      // A pair goes into two racks when the room has them (redundancy).
      const rackId = UNRACKED_ROLES.has(role) || !rackIds.length ? null : rackIds[i % rackIds.length]
      ref = `new:${role}:${roomId}:${i}`
      out.devices.push({ key: ref, role, roomId, rackId })
    }
    return ref
  }
  const roomOf = (ref) => devices.find((d) => d.id === ref)?.roomId ?? out.devices.find((d) => d.key === ref)?.roomId
  const linkCount = (a, b) =>
    links.filter((l) => (l.sourceId === a && l.destId === b) || (l.sourceId === b && l.destId === a)).length +
    out.links.filter((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)).length
  const link = (from, to, { apLink = false } = {}) => {
    if (linkCount(from, to) >= 1) return
    out.links.push({ from, to, ...linkMedia({ sameRoom: String(roomOf(from)) === String(roomOf(to)), apLink }) })
  }

  // Core in the main room.
  const border = nth('border', mainRoom.id, 0)
  const fusion = preset.fusion ? nth('fusion', mainRoom.id, 0) : null
  if (fusion) link(border, fusion)
  if (preset.services) {
    link(nth('firewall', mainRoom.id, 0), border)
    link(nth('wlc', mainRoom.id, 0), fusion ?? border)
  }
  const upstream = [border, fusion].filter(Boolean)
  const edgeRooms = rackRooms.filter((r) => r.id !== mainRoom.id)

  // Distribution: per building (M, redundant only) or per floor (L, XL).
  const pairSize = redundant ? 2 : 1
  const distributionsFor = new Map() // floorId | 'building' → [refs]
  const addDistributions = (scopeKey, hostRoomId) => {
    const refs = Array.from({ length: pairSize }, (_, i) => nth('distribution', hostRoomId, i))
    for (const d of refs) for (const up of redundant ? upstream : [border]) link(up, d)
    distributionsFor.set(scopeKey, refs)
  }
  if (edgeRooms.length && preset.distribution === 'building' && redundant) addDistributions('building', mainRoom.id)
  if (preset.distribution === 'floor') {
    const floorIds = [...new Set(edgeRooms.map((r) => r.floorId))].sort((a, b) => (floorOrder.get(a) ?? 0) - (floorOrder.get(b) ?? 0))
    for (const floorId of floorIds) addDistributions(floorId, edgeRooms.find((r) => r.floorId === floorId).id)
  }

  // Access: Edge + AP per comms room with a rack (the main room is core).
  for (const room of edgeRooms) {
    const edge = nth('edge', room.id, 0)
    const parents = distributionsFor.get(room.floorId) ?? distributionsFor.get('building') ?? [border]
    for (const parent of parents) link(parent, edge)
    link(edge, nth('ap', room.id, 0), { apLink: true })
  }
  return out
}
