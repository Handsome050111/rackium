// Blueprint presets and rule-based "Generate HLD" (brief v2.3 §5.3: the
// selected blueprint template filled with the verified survey's rooms,
// racks and pathways; v2.2 BPT-001 sizes S/M/L/XL). Plain rules, not
// machine learning. Idempotent: it returns only what is missing, so running
// it again after applying its own result adds nothing.

export const BLUEPRINT_PRESETS = [
  { key: 'S', label: 'Small — collapsed core', description: 'Border in the main room; one Edge and AP per comms room with a rack.', fusion: false, distribution: false, services: false, redundant: false },
  { key: 'M', label: 'Medium — Fusion + Border', description: 'Fusion and Border in the main room; one Edge and AP per comms room with a rack.', fusion: true, distribution: false, services: false, redundant: false },
  { key: 'L', label: 'Large — three tier', description: 'Medium plus a Distribution switch per floor; Edges uplink to their floor’s Distribution.', fusion: true, distribution: true, services: false, redundant: false },
  { key: 'XL', label: 'Extra large — redundant', description: 'Large plus Firewall and WLC in the main room, and two uplinks to every Edge and Distribution.', fusion: true, distribution: true, services: true, redundant: true },
]
export const BLUEPRINT_KEYS = BLUEPRINT_PRESETS.map((p) => p.key)
export const presetOf = (key) => BLUEPRINT_PRESETS.find((p) => p.key === key) ?? null

// Media for a planned link: copper for an AP drop, multimode fibre inside a
// room, single-mode between rooms (brief §6.4 defaults).
export function linkMedia({ sameRoom, apLink }) {
  if (apLink) return { media: 'cat6a', speed: '1G' }
  return sameRoom ? { media: 'om4', speed: '10G' } : { media: 'os2', speed: '10G' }
}

// rooms: [{ id, floorId, isMainRoom, hasRack }] (verified survey); floors:
// [{ id, token, order }]; devices: existing HLD devices [{ id, role, roomId }];
// links: existing [{ sourceId, destId }] (device ids, either direction).
// Returns { devices: [{ key, role, roomId }], links: [{ from, to, media, speed }] }
// where from/to are an existing device id or a new device's key.
export function generateFromBlueprint({ preset: presetKey, rooms, floors, devices, links }) {
  const preset = presetOf(presetKey)
  if (!preset) throw new Error(`Unknown blueprint preset ${presetKey}`)
  const out = { devices: [], links: [] }
  const rackRooms = rooms.filter((r) => r.hasRack)
  const mainRoom = rooms.find((r) => r.isMainRoom) ?? rackRooms[0] ?? rooms[0] ?? null
  if (!mainRoom) return out
  const floorOrder = new Map(floors.map((f) => [f.id, f.order ?? 0]))

  // Existing or planned device for (role, room); creates the plan entry when missing.
  const found = (role, roomId) => devices.find((d) => d.role === role && String(d.roomId) === String(roomId))?.id ?? out.devices.find((d) => d.role === role && d.roomId === roomId)?.key ?? null
  const ensure = (role, roomId) => {
    const existing = found(role, roomId)
    if (existing) return existing
    const key = `new:${role}:${roomId}`
    out.devices.push({ key, role, roomId })
    return key
  }
  const roomOf = (ref) => devices.find((d) => d.id === ref)?.roomId ?? out.devices.find((d) => d.key === ref)?.roomId
  const linkCount = (a, b) =>
    links.filter((l) => (l.sourceId === a && l.destId === b) || (l.sourceId === b && l.destId === a)).length +
    out.links.filter((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)).length
  const link = (from, to, { wanted = 1, apLink = false } = {}) => {
    const sameRoom = String(roomOf(from)) === String(roomOf(to))
    for (let n = linkCount(from, to); n < wanted; n++) out.links.push({ from, to, ...linkMedia({ sameRoom, apLink }) })
  }

  // Core in the main room.
  const border = ensure('border', mainRoom.id)
  if (preset.fusion) link(border, ensure('fusion', mainRoom.id))
  if (preset.services) {
    link(ensure('firewall', mainRoom.id), border)
    link(ensure('wlc', mainRoom.id), preset.fusion ? found('fusion', mainRoom.id) : border)
  }
  const uplinks = preset.redundant ? 2 : 1

  // Distribution: one per floor that has comms rooms with racks (in its first such room).
  const distributionOfFloor = new Map()
  if (preset.distribution) {
    const floorsWithRooms = [...new Set(rackRooms.filter((r) => r.id !== mainRoom.id).map((r) => r.floorId))].sort((a, b) => (floorOrder.get(a) ?? 0) - (floorOrder.get(b) ?? 0))
    for (const floorId of floorsWithRooms) {
      const host = rackRooms.find((r) => r.floorId === floorId && r.id !== mainRoom.id)
      const dist = ensure('distribution', host.id)
      distributionOfFloor.set(floorId, dist)
      link(border, dist, { wanted: uplinks })
    }
  }

  // Access: Edge + AP per comms room with a rack (the main room is core).
  for (const room of rackRooms) {
    if (room.id === mainRoom.id) continue
    const edge = ensure('edge', room.id)
    const parent = distributionOfFloor.get(room.floorId) ?? border
    link(parent, edge, { wanted: uplinks })
    link(edge, ensure('ap', room.id), { apLink: true })
  }
  return out
}
