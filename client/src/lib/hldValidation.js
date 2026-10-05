// Rule-based uplink validation for the HLD Edit Uplink wizard (brief v2.3
// §6.4, §6.8). Every finding here is derived from real inputs — this is
// what stops the render's mistake from recurring: it claimed switching
// OM4->OS2 "resolves the distance" constraint on an 84m link, but OM4
// 10G-SR reaches 400m, so distance was never the problem. The actual
// blocker in that scenario is patch-panel capacity, which medium doesn't
// touch at all.
import { DEFAULT_MEDIA_LIMITS_M } from '@rackium/shared/cableLength.js'
import { isSfpValidForMedia } from '../mock/sfpCatalog.js'

export function validateUplink({
  sourcePortFree,
  destPortFree,
  media,
  speed,
  sourceSfp,
  destSfp,
  estimatedLengthM, // number | null
  patchPanelFreePorts, // number | null — null means no patch panel is on this path, skip the check
}) {
  const findings = []

  const portsOk = sourcePortFree && destPortFree
  findings.push({
    id: 'port-availability',
    label: 'Port availability',
    status: portsOk ? 'pass' : 'fail',
    message: portsOk ? 'Both ports free' : 'Source or destination port already in use',
  })

  // Cat6a is RJ45 copper — no pluggable optic involved, so the SFP check
  // doesn't apply to it at all (brief v2.3 §6.4).
  const sfpOk = media === 'cat6a' || (isSfpValidForMedia(sourceSfp, media, speed) && isSfpValidForMedia(destSfp, media, speed))
  findings.push({
    id: 'sfp-compatibility',
    label: 'SFP compatibility',
    status: sfpOk ? 'pass' : 'fail',
    message:
      media === 'cat6a'
        ? 'Cat6A is RJ45 — no SFP required'
        : sfpOk
          ? `${sourceSfp} matches ${media.toUpperCase()} ${speed}`
          : `SFP does not support ${media.toUpperCase()} ${speed}`,
  })

  const limit = DEFAULT_MEDIA_LIMITS_M[media]
  const distanceOk = estimatedLengthM == null || limit == null || estimatedLengthM <= limit
  findings.push({
    id: 'distance-support',
    label: 'Distance support',
    status: distanceOk ? 'pass' : 'fail',
    message:
      estimatedLengthM == null
        ? 'No length estimate yet'
        : distanceOk
          ? `${estimatedLengthM} m within the ${limit} m ${media.toUpperCase()} limit`
          : `${estimatedLengthM} m exceeds the ${limit} m ${media.toUpperCase()} limit (VAL-011)`,
  })

  findings.push({
    id: 'surveyed-pathway',
    label: 'Surveyed pathway',
    status: estimatedLengthM != null ? 'pass' : 'info',
    message: estimatedLengthM != null ? 'Length from a surveyed building connection' : 'No surveyed pathway — length is an estimate',
  })

  if (patchPanelFreePorts != null) {
    const panelOk = patchPanelFreePorts > 0
    findings.push({
      id: 'patch-panel-capacity',
      label: 'Patch-panel capacity',
      status: panelOk ? 'pass' : 'fail',
      message: panelOk ? `${patchPanelFreePorts} free port${patchPanelFreePorts === 1 ? '' : 's'}` : 'No free ports on the destination patch panel',
    })
  }

  return findings
}

export function hasBlockingFailure(findings) {
  return findings.some((f) => f.status === 'fail')
}
