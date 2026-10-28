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

// The Building Connection between two rooms in either direction, whatever
// its route status — LLD needs the Estimated ones too, to flag them.
export function findRoute(fromRoomId, toRoomId, connections) {
  return (
    connections.find(
      (c) =>
        (c.fromRoomId === fromRoomId && c.toRoomId === toRoomId) ||
        (c.fromRoomId === toRoomId && c.toRoomId === fromRoomId)
    ) ?? null
  )
}

// A cable's route through rooms (Reroute, DATA-MODEL §5.20): from its source
// room through `viaRoomIds`, in order, to its destination room — the legs.
export function routeLegs(fromRoomId, toRoomId, viaRoomIds = []) {
  const rooms = [fromRoomId, ...viaRoomIds, toRoomId].map(String)
  return rooms.slice(0, -1).map((room, i) => [room, rooms[i + 1]])
}

// The length of a route: the pathways of its legs added up. Each leg as the
// LLD has always read one pathway — none recorded, Estimated, or surveyed
// without a distance gives its reason (the first one is kept); any leg
// without a distance leaves the route without one. No via rooms: exactly the
// one pathway between the two rooms.
export function routeDistance(fromRoomId, toRoomId, pathways, viaRoomIds = []) {
  let distanceM = 0
  let reason = null
  for (const [a, b] of routeLegs(fromRoomId, toRoomId, viaRoomIds)) {
    const route = findRoute(a, b, pathways)
    const leg = !route
      ? { distanceM: null, reason: 'No pathway recorded between these rooms' }
      : route.routeStatus !== 'surveyed'
        ? { distanceM: route.distanceM ?? null, reason: 'Pathway route is marked Estimated' }
        : route.distanceM == null
          ? { distanceM: null, reason: 'Surveyed pathway has no distance' }
          : { distanceM: route.distanceM, reason: null }
    reason ??= leg.reason
    distanceM = distanceM == null || leg.distanceM == null ? null : distanceM + leg.distanceM
  }
  return { distanceM, reason }
}
