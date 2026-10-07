// Phase gating for a project's activePhases (DATA-MODEL §3.2, "pending client
// confirmation" default). A PM may add a phase that has not started. A phase
// that contains data cannot be removed. Order follows PHASE_KEYS; a project
// may skip phases, so activePhases is any ordered, non-empty subset.
import { PHASE_KEYS } from './phaseCalculations.js'

// `phaseHasData(phaseKey)` -> boolean: true when any building's phase status
// for this key is not 'not_started', or the phase owns a blocker. The caller
// (server) builds this from phaseStatuses + blockers; it is passed in so this
// module stays a pure function with no I/O.
export function canRemovePhase(phaseKey, phaseHasData) {
  return !phaseHasData(phaseKey)
}

// A phase may be added if it is not already active and has not started
// elsewhere in the project (it never has, for a phase not yet in
// activePhases, but the check is kept explicit for symmetry and future reuse).
export function canAddPhase(phaseKey, activePhases) {
  return PHASE_KEYS.includes(phaseKey) && !activePhases.includes(phaseKey)
}

// Validates and normalises a full activePhases replacement: keeps brief
// order, rejects phases that would be removed while they have data, rejects
// unknown or duplicate keys, and requires at least one phase.
export function applyActivePhases({ currentActivePhases, nextPhaseKeys, phaseHasData }) {
  const unique = new Set(nextPhaseKeys)
  if (unique.size !== nextPhaseKeys.length) return { ok: false, error: 'Duplicate phase' }
  if (nextPhaseKeys.length === 0) return { ok: false, error: 'At least one phase must stay active' }
  for (const key of nextPhaseKeys) {
    if (!PHASE_KEYS.includes(key)) return { ok: false, error: `Unknown phase: ${key}` }
  }
  const removed = currentActivePhases.filter((key) => !nextPhaseKeys.includes(key))
  for (const key of removed) {
    if (!canRemovePhase(key, phaseHasData)) return { ok: false, error: `Cannot remove ${key}: it already has data` }
  }
  const ordered = [...nextPhaseKeys].sort((a, b) => PHASE_KEYS.indexOf(a) - PHASE_KEYS.indexOf(b))
  return { ok: true, activePhases: ordered.map((phaseKey, position) => ({ phaseKey, position })) }
}

// The two seeded presets (brief, §3.10 "Presets").
export const PRESETS = {
  full_network_deployment: PHASE_KEYS,
  survey_and_design_only: ['cmo', 'survey', 'hld', 'lld', 'solution-package'],
}
