// Shared freeze/approval check (brief Step 7: Solution Package approval
// freezes HLD and LLD and unlocks BOM procurement). A tiny standalone
// module so bomDesign.js and solutionPackageDesign.js can both depend on
// it without importing each other.
import { getPhaseCards } from './buildings.js'

export async function isSolutionPackageApproved(buildingId) {
  const cards = await getPhaseCards(buildingId)
  return cards.find((c) => c.id === 'solution-package')?.status === 'approved'
}
