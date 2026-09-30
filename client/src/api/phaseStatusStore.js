// Mutable phase-status overrides, seeded from the static mock (hierarchy.js)
// but writable at runtime — so a workflow action (e.g. HLD "Submit for
// approval") updates the status everywhere that reads it (dashboard cards,
// project continuity stepper, sidebar), per brief v2.3 §7.3: "Cards,
// timeline and sidebar always show the same status for a phase." Reusable
// by any phase's workflow, not just HLD.
const overrides = {} // buildingId -> { phaseId: { status, subLabel? } }
const listeners = new Set()

export function getPhaseStatusOverride(buildingId, phaseId) {
  return overrides[buildingId]?.[phaseId] ?? null
}

export function setPhaseStatusOverride(buildingId, phaseId, status, subLabel = null) {
  if (!overrides[buildingId]) overrides[buildingId] = {}
  overrides[buildingId][phaseId] = { status, subLabel }
  listeners.forEach((fn) => fn())
}

// Sidebar and the dashboard mount as siblings of whatever phase screen
// changes a status — they can't just re-render from a prop change, so they
// subscribe here and re-fetch when notified.
export function subscribePhaseStatusChanges(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}
