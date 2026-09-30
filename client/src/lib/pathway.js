// Looks up the surveyed distance between two communication rooms from the
// Building Connections captured in Site Structure (brief v2.3 §6.3: "the
// Architect enters an estimated length" only when no pathway is surveyed —
// this is what feeds computeSuggestedLength's cross-room formula instead).
// A connection is undirected: A->B and B->A are the same physical route.
export function findSurveyedDistance(fromRoomId, toRoomId, connections) {
  const match = connections.find(
    (c) =>
      c.routeStatus === 'surveyed' &&
      c.distanceM != null &&
      ((c.fromRoomId === fromRoomId && c.toRoomId === toRoomId) ||
        (c.fromRoomId === toRoomId && c.toRoomId === fromRoomId))
  )
  return match ? match.distanceM : null
}
