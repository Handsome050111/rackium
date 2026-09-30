// Rule-based HLD generation ("Generate HLD" / NexAI-suggested — brief
// v2.3 §5.3: "the selected blueprint template filled with the verified
// survey's rooms, racks and pathways"). Plain rules, not machine learning:
// Fusion+Border in the main room, one Edge+AP per surveyed comms room that
// has a rack, Border->Edge uplinks. Returns only what's MISSING — running
// it again after applying its own suggestions yields nothing more to add.
export function generateBlueprintSuggestions({ roomContexts, hasFusion, hasBorder, mainRoomId }) {
  const suggestions = { devices: [], uplinks: [] }

  if (mainRoomId) {
    if (!hasFusion) suggestions.devices.push({ role: 'fusion', roomId: mainRoomId })
    if (!hasBorder) suggestions.devices.push({ role: 'border', roomId: mainRoomId })
  }

  for (const ctx of roomContexts) {
    if (ctx.roomId === mainRoomId || !ctx.hasRack) continue
    if (!ctx.hasEdge) suggestions.devices.push({ role: 'edge', roomId: ctx.roomId, floorToken: ctx.floorToken })
    if (!ctx.hasAp) suggestions.devices.push({ role: 'ap', roomId: ctx.roomId, floorToken: ctx.floorToken })
    if (!ctx.hasEdge) suggestions.uplinks.push({ toRoomId: ctx.roomId })
  }

  return suggestions
}
