import { organisation, project, country, sal, campus, getBuildingById } from '../mock/hierarchy.js'
import { PHASES, PHASE_ORDER } from '../mock/phases.js'
import { computeOverallProgress, findCurrentPhase, countByType } from '../lib/phaseCalculations.js'

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
    const entry = building.phases[phase.id]
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

  const phaseEntries = PHASE_ORDER.map((phaseId) => ({ phaseId, status: building.phases[phaseId].status }))
  const currentPhaseId = findCurrentPhase(phaseEntries, PHASE_ORDER)
  const currentPhase = PHASES.find((p) => p.id === currentPhaseId)

  return resolveAfter({
    overallProgress: computeOverallProgress(phaseEntries),
    currentPhase: currentPhase.shortName,
    openBlockers: countByType(building.openItems, 'blocker'),
    approvalsAwaitingAction: countByType(building.openItems, 'approval'),
    lastSyncAt: building.lastSyncAt,
    nextMilestone: building.nextMilestone,
  })
}

export async function getRecentHistory(buildingId) {
  const building = getBuildingById(buildingId)
  if (!building) return notFound(buildingId)

  const sorted = [...building.history].sort((a, b) => new Date(b.at) - new Date(a.at))
  return resolveAfter(sorted)
}
