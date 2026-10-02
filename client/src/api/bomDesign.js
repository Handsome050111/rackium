// BOM (brief v2.3 §5.6, Step 7). Draft BOM generated live from the shared
// HLD/LLD records — lines are recomputed on every read, never hand-typed;
// only per-line vendor + procurement status/PO/delivery data persists
// across recomputation (keyed by a stable line key, not an id that would
// change if the design changes).
import { getLldContext } from './lldDesign.js'
import { getPhaseCards, updatePhaseStatus } from './buildings.js'
import { getMarginPercent } from './projectSettings.js'
import { isSolutionPackageApproved, isHandoverAccepted } from './designFreeze.js'
import { buildBom, reconcileDeviceCounts } from '../lib/bomModel.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const PROCUREMENT_STATUSES = ['Not ordered', 'Ordered', 'Shipped', 'Delivered']

// buildingId -> lineKey -> { vendor, procurementStatus, poNumber, expectedDelivery, actualDelivery, notes }
const procurementOverrides = {}

function overridesFor(buildingId) {
  return (procurementOverrides[buildingId] ??= {})
}

// `preloaded.lldContext` lets a caller that already has one (e.g.
// getSolutionPackageContext, which needs its own anyway) hand it in
// instead of this re-fetching the whole HLD/LLD chain a second time.
export async function getBomContext(buildingId, preloaded = {}) {
  const [lldContext, phaseCards, marginPercent, solutionPackageApproved, handoverAccepted] = await Promise.all([
    preloaded.lldContext ?? getLldContext(buildingId),
    getPhaseCards(buildingId),
    getMarginPercent(),
    isSolutionPackageApproved(buildingId),
    isHandoverAccepted(buildingId),
  ])

  const devices = lldContext.entities.filter((e) => e.type === 'device')
  const bom = buildBom(devices, lldContext.rows, lldContext.rows)
  const overrides = overridesFor(buildingId)

  const lines = bom.lines.map((line) => {
    const override = overrides[line.key] ?? {}
    return {
      ...line,
      vendor: override.vendor ?? line.vendor,
      procurementStatus: override.procurementStatus ?? 'Not ordered',
      poNumber: override.poNumber ?? null,
      expectedDelivery: override.expectedDelivery ?? null,
      actualDelivery: override.actualDelivery ?? null,
      notes: override.notes ?? '',
    }
  })

  const costTotal = Math.round(lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0) * 100) / 100
  const priceWithMargin = Math.round(costTotal * (1 + marginPercent / 100) * 100) / 100
  const reconciliation = reconcileDeviceCounts(devices, bom)

  const bomPhase = phaseCards.find((c) => c.id === 'bom')
  const status = bomPhase?.status ?? 'not_started'
  // "Draft" specifically means "not yet unlocked by Solution Package
  // approval" (brief §5.6) — ignore the seed's own subLabel here, since
  // reusing it would keep showing "Draft" after approval (mock/hierarchy.js
  // seeds the bom phase card with subLabel: 'Draft' for the dashboard's
  // pre-Step-7 starting state).
  const subLabel = solutionPackageApproved ? null : 'Draft'

  return resolveAfter({
    lines,
    calc: bom.calc,
    currency: bom.currency,
    costTotal,
    marginPercent,
    priceWithMargin,
    reconciliation,
    status,
    subLabel,
    procurementLocked: !solutionPackageApproved || handoverAccepted,
    solutionPackageApproved,
    handoverAccepted,
    conflicts: lldContext.checks.portConflicts + lldContext.checks.duplicateCableIds,
  })
}

export { PROCUREMENT_STATUSES }

export async function setLineVendor(buildingId, lineKey, vendor) {
  const overrides = overridesFor(buildingId)
  overrides[lineKey] = { ...overrides[lineKey], vendor }
  return resolveAfter({ ok: true })
}

export async function setLineProcurement(buildingId, lineKey, patch) {
  const [approved, handoverAccepted] = await Promise.all([isSolutionPackageApproved(buildingId), isHandoverAccepted(buildingId)])
  if (!approved) return resolveAfter({ ok: false, error: 'Procurement fields unlock after the Solution Package is approved.' })
  if (handoverAccepted) return resolveAfter({ ok: false, error: 'This building has been handed over — the BOM is read-only.' })
  const overrides = overridesFor(buildingId)
  overrides[lineKey] = { ...overrides[lineKey], ...patch }
  return resolveAfter({ ok: true })
}

// Brief D21: the PM approves the procurement BOM directly — no separate
// reviewer step (unlike HLD/Solution Package's architect-submits /
// pm-or-reviewer-approves split).
export async function approveProcurementBom(buildingId) {
  const [approved, handoverAccepted] = await Promise.all([isSolutionPackageApproved(buildingId), isHandoverAccepted(buildingId)])
  if (!approved) return resolveAfter({ ok: false, error: 'The Solution Package must be approved before the procurement BOM can be approved.' })
  if (handoverAccepted) return resolveAfter({ ok: false, error: 'This building has been handed over — the BOM is read-only.' })
  await updatePhaseStatus(buildingId, 'bom', 'approved')
  return resolveAfter({ ok: true })
}
