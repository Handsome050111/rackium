import { organisation, project, country, sal, campus, getBuildingById } from '../mock/hierarchy.js'
import { PHASES, PHASE_ORDER } from '../mock/phases.js'
import { computeOverallProgress, findCurrentPhase, countByType } from '../lib/phaseCalculations.js'
import { getPhaseStatusOverride, setPhaseStatusOverride } from './phaseStatusStore.js'
import { getCmoContext } from './cmoDesign.js'

function effectivePhaseEntry(buildingId, phaseId, staticEntry) {
  return getPhaseStatusOverride(buildingId, phaseId) ?? staticEntry
}

function resolveAfter(value, ms = 120) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function notFound(buildingId) {
  return Promise.reject(new Error(`Unknown building: ${buildingId}`))
}

export async function getBuilding(buildingId) {
  const building = getBuildingById(buildingId)
  if (!building) return notFound(buildingId)

  return resolveAfter({
    id: building.id,
    code: building.code,
    name: building.name,
    breadcrumb: [
      { label: project.name, id: project.id },
      { label: country.code, id: country.id },
      { label: sal.code, id: sal.id },
      { label: campus.code, id: campus.id },
      { label: building.code, id: building.id },
    ],
    project: { code: project.name, country: country.code, sal: sal.code, campus: campus.code, building: building.code },
    organisationName: organisation.name,
  })
}

export async function getPhaseCards(buildingId) {
  const building = getBuildingById(buildingId)
  if (!building) return notFound(buildingId)

  const cards = PHASES.map((phase) => {
    const entry = effectivePhaseEntry(buildingId, phase.id, building.phases[phase.id])
    return {
      ...phase,
      status: entry.status,
      subLabel: entry.subLabel ?? null,
    }
  })

  return resolveAfter(cards)
}

export async function getBuildingKpis(buildingId) {
  const building = getBuildingById(buildingId)
  if (!building) return notFound(buildingId)

  const phaseEntries = PHASE_ORDER.map((phaseId) => ({
    phaseId,
    status: effectivePhaseEntry(buildingId, phaseId, building.phases[phaseId]).status,
  }))
  const currentPhaseId = findCurrentPhase(phaseEntries, PHASE_ORDER)
  const currentPhase = PHASES.find((p) => p.id === currentPhaseId)

  // Brief D39: unassigned CMO devices are a SAL-wide blocker — they count
  // against every building's dashboard, not just the one they'll end up
  // in, since nobody knows which building that is yet.
  const { kpis: cmoKpis } = await getCmoContext()

  return resolveAfter({
    overallProgress: computeOverallProgress(phaseEntries),
    currentPhase: currentPhase.shortName,
    openBlockers: countByType(building.openItems, 'blocker') + cmoKpis.unassigned,
    approvalsAwaitingAction: countByType(building.openItems, 'approval'),
    lastSyncAt: building.lastSyncAt,
    nextMilestone: building.nextMilestone,
  })
}

// Any phase workflow (HLD's Submit/Approve/Request Changes, and later
// phases' equivalents) calls this so the dashboard, stepper and sidebar
// all pick up the change immediately.
export async function updatePhaseStatus(buildingId, phaseId, status, subLabel = null) {
  setPhaseStatusOverride(buildingId, phaseId, status, subLabel)
  return resolveAfter({ phaseId, status, subLabel })
}

export async function getRecentHistory(buildingId) {
  const building = getBuildingById(buildingId)
  if (!building) return notFound(buildingId)

  const sorted = [...building.history].sort((a, b) => new Date(b.at) - new Date(a.at))
  return resolveAfter(sorted)
}
