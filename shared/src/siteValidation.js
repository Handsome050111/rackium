// Site structure validation (brief v2.3 §5.2 flow item 5, adapted to the
// structure level): room without rack, rack without room details,
// connection without distance, duplicate room IDs. Each finding links back
// to the object it's about so the results panel can select it.

export function validateStructure({ rooms, racks, connections, hasRoomMeta }) {
  const findings = []

  for (const room of rooms) {
    const hasRack = racks.some((r) => r.roomId === room.id)
    if (!hasRack) {
      findings.push({
        id: `room-no-rack-${room.id}`,
        type: 'room-without-rack',
        message: `${room.code} has no rack`,
        objectType: 'room',
        objectId: room.id,
      })
    }
  }

  for (const rack of racks) {
    const room = rooms.find((r) => r.id === rack.roomId)
    if (room && !hasRoomMeta(room.id)) {
      findings.push({
        id: `rack-no-details-${rack.id}`,
        type: 'rack-without-room-details',
        message: `Rack ${rack.code} in ${room.code} has no room details captured`,
        objectType: 'rack',
        objectId: rack.id,
      })
    }
  }

  for (const conn of connections) {
    if (conn.distanceM == null) {
      findings.push({
        id: `conn-no-distance-${conn.id}`,
        type: 'connection-without-distance',
        message: `Connection ${conn.fromRoomCode} → ${conn.toRoomCode} has no distance recorded`,
        objectType: 'connection',
        objectId: conn.id,
      })
    }
  }

  const codeCount = new Map()
  for (const room of rooms) codeCount.set(room.code, (codeCount.get(room.code) ?? 0) + 1)
  for (const [code, count] of codeCount) {
    if (count > 1) {
      findings.push({
        id: `dup-room-${code}`,
        type: 'duplicate-room-id',
        message: `Room ID "${code}" is used ${count} times`,
        objectType: 'room',
        objectId: null,
      })
    }
  }

  return findings
}
