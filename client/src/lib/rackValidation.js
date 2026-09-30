// Rack placement validation (brief v2.3 §4.1, §7.5, §5.2 item 3). A
// placement's `ru` is its LOWEST occupied RU: a 2U device at ru=40 occupies
// RU40-41 (i.e. [ru, ru + heightU - 1]).

export function occupiedRange(placement) {
  return [placement.ru, placement.ru + placement.heightU - 1]
}

export function isWithinBoundary(ru, heightU, rackHeightU) {
  return ru >= 1 && ru + heightU - 1 <= rackHeightU
}

function rangesOverlap([aStart, aEnd], [bStart, bEnd]) {
  return aStart <= bEnd && bStart <= aEnd
}

// `blocked` applies to both faces; a full_depth item also occupies both
// faces. Everything else (including `reserved`) applies to its own face
// only (brief v2.3 correction: reserved is per face, blocked is not).
export function occupiesFaces(placement) {
  if (placement.kind === 'blocked') return ['front', 'rear']
  if (placement.fullDepth) return ['front', 'rear']
  return [placement.face]
}

// Returns a list of conflicts (empty = valid). `excludeId` lets a placement
// being moved ignore a collision with its own previous position.
export function findConflicts(candidate, existingPlacements, rackHeightU, excludeId = null) {
  if (candidate.heightU === 0) return [] // 0U items don't occupy RU space

  if (!isWithinBoundary(candidate.ru, candidate.heightU, rackHeightU)) {
    return [{ type: 'boundary', message: 'Outside rack boundary' }]
  }

  const candidateRange = occupiedRange(candidate)
  const candidateFaces = occupiesFaces(candidate)
  const conflicts = []

  for (const existing of existingPlacements) {
    if (existing.id === excludeId) continue
    if (existing.heightU === 0) continue
    const existingFaces = occupiesFaces(existing)
    const sharesFace = candidateFaces.some((f) => existingFaces.includes(f))
    if (!sharesFace) continue
    if (rangesOverlap(candidateRange, occupiedRange(existing))) {
      conflicts.push({ type: 'overlap', message: `Conflicts with ${existing.label}`, withId: existing.id })
    }
  }

  return conflicts
}

export function isPlacementValid(candidate, existingPlacements, rackHeightU, excludeId = null) {
  return findConflicts(candidate, existingPlacements, rackHeightU, excludeId).length === 0
}

// Free / contiguous-free RU for one face. An RU is "occupied" for a face
// when any placement whose occupiesFaces() includes that face covers it —
// so a blocked RU or a full-depth device removes it from both faces' free
// counts, and a same-rack RU used on the other face only stays free here.
export function computeFreeRU(placements, rackHeightU, face) {
  const occupied = new Set()
  for (const p of placements) {
    if (p.heightU === 0) continue
    if (!occupiesFaces(p).includes(face)) continue
    const [start, end] = occupiedRange(p)
    for (let ru = start; ru <= end; ru++) occupied.add(ru)
  }

  let availableRU = 0
  let contiguousFreeRU = 0
  let currentRun = 0
  for (let ru = 1; ru <= rackHeightU; ru++) {
    if (occupied.has(ru)) {
      currentRun = 0
      continue
    }
    availableRU++
    currentRun++
    contiguousFreeRU = Math.max(contiguousFreeRU, currentRun)
  }

  return { availableRU, contiguousFreeRU }
}
