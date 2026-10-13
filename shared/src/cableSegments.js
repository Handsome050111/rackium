// Route segments (M5a review): every cable of a connection is its own physical
// cable with its own length. A route runs source → hop panels → destination;
// each pair of neighbouring nodes is one segment:
// - segment 0 (source → first panel, or → destination when direct) carries the
//   connection's `cableId` and `lengths`;
// - segment k ≥ 1 (hop k's panel → next node) carries hop k's
//   `segmentCableId` and `lengths`.
// Kinds: device↔panel is a patch cord, panel↔panel a trunk, device↔device
// direct. Suggested lengths use the shared §6.3 formulas: the same-rack
// formula (RU difference) when both ends are in one rack — a device-to-panel
// patch cord usually is — the inter-rack formula within a room and the
// pathway formula across rooms; then rounded up to the stock table.
import { computeSuggestedLength, determineSituation } from './cableLength.js'

export const SEGMENT_KIND_LABEL = { patch_cord: 'Patch cord', trunk: 'Trunk', direct: 'Direct' }

// Suggested length between two placed nodes. `a`/`b`: { roomId, rackId, ru };
// `rackPositionOf(rackId)` → 1-based position in its room; `routeOf(roomA,
// roomB)` → { distanceM, reason } for a cross-room run (reason set when the
// distance is not surveyed).
export function lengthBetween(a, b, media, { rackPositionOf = () => 1, routeOf = () => ({ distanceM: null, reason: 'No pathway recorded between these rooms' }), stockLengths = null } = {}) {
  const empty = { lengthM: null, lengthEstimated: true, customLengthRequired: false, suggestedM: null, situation: null, estimateReason: 'An end has no room yet', placementPending: true }
  if (!a?.roomId || !b?.roomId) return empty
  const situation = determineSituation({ sourceRackId: a.rackId, destRackId: b.rackId, sourceRoomId: a.roomId, destRoomId: b.roomId })
  const placementPending = (situation === 'same-rack' && (a.ru == null || b.ru == null)) || (situation === 'same-room' && (!a.rackId || !b.rackId))
  let estimateReason = null
  let distance
  if (situation === 'cross-room') {
    const route = routeOf(a.roomId, b.roomId)
    estimateReason = route?.reason ?? null
    distance = route?.distanceM ?? null
  }
  if (placementPending) return { ...empty, situation, estimateReason: 'Place both ends to calculate the length', lengthEstimated: false }
  const end = (d, extra = {}) => ({ rackId: d.rackId, roomId: d.roomId, ru: d.ru ?? 1, rackPosition: d.rackId ? rackPositionOf(d.rackId) ?? 1 : 1, ...extra })
  const r = computeSuggestedLength({ source: end(a), dest: end(b, { surveyedPathwayLength: distance }), media, stockLengths })
  return { lengthM: r.rawMeters, lengthEstimated: Boolean(estimateReason) || r.estimated, customLengthRequired: r.customLengthRequired, suggestedM: r.suggested, situation, estimateReason, placementPending: false }
}

// The connection's segments with their lengths. `nodeOf(deviceId)` → the
// device's { roomId, rackId, ru } (or null); `isPanel(deviceId)`.
export function connectionSegments(conn, { nodeOf, isPanel, ...lengthOptions }) {
  const hops = conn.hops ?? []
  const nodes = [
    { deviceId: String(conn.source.deviceId), outPort: conn.source.portId ?? null },
    ...hops.map((h) => ({ deviceId: String(h.patchPanelId), inPort: h.inPort, outPort: h.outPort })),
    { deviceId: String(conn.dest.deviceId), inPort: conn.dest.portId ?? null },
  ]
  return nodes.slice(0, -1).map((from, k) => {
    const to = nodes[k + 1]
    const panels = [from, to].filter((n) => isPanel(n.deviceId)).length
    const own = k === 0 ? { cableId: conn.cableId ?? null, lengths: conn.lengths } : { cableId: hops[k - 1].segmentCableId ?? null, lengths: hops[k - 1].lengths }
    const length = lengthBetween(nodeOf(from.deviceId), nodeOf(to.deviceId), conn.media, lengthOptions)
    const engineerSelectedM = own.lengths?.engineerSelectedM ?? null
    return {
      index: k,
      kind: panels === 2 ? 'trunk' : panels === 1 ? 'patch_cord' : 'direct',
      from: { deviceId: from.deviceId, portId: from.outPort ?? null },
      to: { deviceId: to.deviceId, portId: to.inPort ?? null },
      cableId: own.cableId,
      ...length,
      engineerSelectedM,
      installedM: own.lengths?.installedM ?? null,
      effectiveM: engineerSelectedM ?? length.suggestedM,
    }
  })
}
