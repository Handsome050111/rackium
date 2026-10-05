// Cable ID rules (brief v2.3 §6.1): free text up to 32 chars, unique per
// project case-insensitively. The system suggests the next free 8-digit
// number by default; the user may accept it or type their own.

const DEFAULT_START = 26184735

// Connections created in HLD carry cableId: null until LLD assigns one, so
// every helper here tolerates empty entries in the list it is given.
function present(ids) {
  return ids.filter((id) => typeof id === 'string' && id.length > 0)
}

export function suggestNextCableId(existingIds, start = DEFAULT_START) {
  const used = new Set(present(existingIds).map((id) => id.toLowerCase()))
  let candidate = start
  while (used.has(String(candidate).toLowerCase())) {
    candidate += 1
  }
  return String(candidate)
}

export function isCableIdUnique(id, existingIds, excludeId = null) {
  const normalized = id.trim().toLowerCase()
  return !present(existingIds).some((existing) => existing !== excludeId && existing.toLowerCase() === normalized)
}

export function isCableIdValid(id) {
  const trimmed = id.trim()
  return trimmed.length > 0 && trimmed.length <= 32
}
