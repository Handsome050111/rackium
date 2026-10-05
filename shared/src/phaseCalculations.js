// Phase status math (brief v2.3 §4.4, §7.3). Every KPI on the dashboard is
// derived from phase records here — nothing is hand-typed into the UI.

const PROGRESS_WEIGHT = {
  not_started: 0,
  in_progress: 0.5,
  awaiting_approval: 0.75,
  changes_requested: 0.5,
  blocked: 0.25,
  approved: 1,
  completed: 1,
}

// Terminal states that don't block or need action.
const RESOLVED_STATUSES = new Set(['approved', 'completed'])

// Overall progress = mean of each phase's weight, as a percentage. A phase
// with no approval step is done at "completed"; one with an approval step
// is done at "approved" — both count as 1. In-flight states count as partial
// credit so the bar moves before a phase closes out.
// B001 (§4.4 statuses: cmo completed, survey approved, hld approved,
// lld in_progress, solution-package not_started, bom in_progress,
// deployment/cmdb/handover not_started) sums to
// (1 + 1 + 1 + 0.5 + 0 + 0.5 + 0 + 0 + 0) / 9 = 0.444... -> 44%.
export function computeOverallProgress(phaseEntries) {
  if (phaseEntries.length === 0) return 0
  const total = phaseEntries.reduce((sum, p) => sum + (PROGRESS_WEIGHT[p.status] ?? 0), 0)
  return Math.round((total / phaseEntries.length) * 100)
}

export function findCurrentPhase(phaseEntries, phaseOrder) {
  const active = phaseOrder.find((phaseId) => {
    const entry = phaseEntries.find((p) => p.phaseId === phaseId)
    return entry && !RESOLVED_STATUSES.has(entry.status)
  })
  return active ?? phaseOrder[phaseOrder.length - 1]
}

export function countByType(openItems, type) {
  return openItems.filter((item) => item.type === type).length
}
