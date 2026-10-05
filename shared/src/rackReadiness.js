// Readiness summary (brief v2.3 §5.2 item 4: "System calculates the
// readiness summary: available RU, contiguous free RU, depth
// compatibility, power readiness, cable management, mounting material").
// Every pass/fail below is a rule over the placed objects and the survey
// facts — nothing here is a hand-set status.
import { computeFreeRU } from './rackValidation.js'

const MIN_USABLE_DEPTH_MM = 500

export function computeReadiness({ placements, rackHeightU, meta }) {
  const front = computeFreeRU(placements, rackHeightU, 'front')

  const depthCompatible = meta.details.usableDepthMm >= MIN_USABLE_DEPTH_MM

  const { pduA, pduB } = meta.mountingPower
  const powerReady = Boolean(pduA && pduA.freeSockets > 0 && (!pduB || pduB.freeSockets > 0))

  const hasCableManagementPlacement = placements.some((p) => p.category === 'Cable management')
  const cableManagementReady =
    meta.cablePath.verticalManagers + meta.cablePath.horizontalManagers >= 1 || hasCableManagementPlacement

  const rackMountedCount = placements.filter((p) => p.mounting !== '0U' && p.kind === 'device').length
  const mountingReady = meta.mountingPower.availableCageNutSets >= rackMountedCount

  const checks = [
    { id: 'depth', label: 'Depth compatibility', pass: depthCompatible, action: 'Confirm usable depth meets equipment requirements' },
    { id: 'power', label: 'Power readiness', pass: powerReady, action: 'Free up PDU sockets or add redundant power' },
    { id: 'cable', label: 'Cable management', pass: cableManagementReady, action: 'Install a cable manager for this rack' },
    { id: 'mounting', label: 'Mounting material', pass: mountingReady, action: 'Order additional cage nut sets' },
  ]

  const actions = checks.filter((c) => !c.pass).map((c) => c.action)

  return {
    availableRU: front.availableRU,
    contiguousFreeRU: front.contiguousFreeRU,
    checks,
    overallStatus: actions.length === 0 ? 'Ready' : `Ready with ${actions.length} action${actions.length === 1 ? '' : 's'}`,
    actions,
  }
}
