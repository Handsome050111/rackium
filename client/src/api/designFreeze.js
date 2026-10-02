// Shared freeze/approval check (brief Step 7: Solution Package approval
// freezes HLD and LLD and unlocks BOM procurement; Step 9: Handover
// acceptance freezes everything). A tiny standalone module so
// bomDesign.js/solutionPackageDesign.js and every design-phase page can
// depend on it without importing each other.
//
// Handover-acceptance STATE is owned here, not in api/handoverDesign.js,
// even though handoverDesign.js is where it's written from — if
// handoverDesign.js owned it, designFreeze.js would import handoverDesign,
// which imports bomDesign (for its own checklist data), which imports
// designFreeze again, a real import cycle that caused Vite dev mode to
// serve two separate instances of a module deep in that cycle (shareLink.js
// via handoverDesign.js) with two separate copies of its in-memory store —
// a share-link token generated through one instance was invisible to the
// other. One-directional dependency (handoverDesign -> designFreeze, never
// back) avoids the whole class of bug.
import { getPhaseCards } from './buildings.js'
import { registerStore } from '../lib/persistentStore.js'

const acceptedBuildings = new Set()

registerStore('designFreeze', {
  getSnapshot: () => Array.from(acceptedBuildings),
  restoreSnapshot: (data) => {
    acceptedBuildings.clear()
    ;(data ?? []).forEach((id) => acceptedBuildings.add(id))
  },
})

export function markHandoverAccepted(buildingId) {
  acceptedBuildings.add(buildingId)
}

export async function isHandoverAccepted(buildingId) {
  return acceptedBuildings.has(buildingId)
}

export async function isSolutionPackageApproved(buildingId) {
  const cards = await getPhaseCards(buildingId)
  return cards.find((c) => c.id === 'solution-package')?.status === 'approved'
}

// Design phases (Survey, HLD, LLD, Solution Package, BOM, Deployment) go
// read-only once the Solution Package is approved OR the Handover is
// accepted — CMDB is deliberately excluded (brief v2.2 §3.11: "CMDB
// remains editable for operational changes" after handover).
export async function isDesignFrozen(buildingId) {
  const [spApproved, handoverAccepted] = await Promise.all([isSolutionPackageApproved(buildingId), isHandoverAccepted(buildingId)])
  return spApproved || handoverAccepted
}
