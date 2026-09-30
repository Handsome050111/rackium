// Rule-based port-mapping validation (brief v2.3 §6.8: VAL-001 family plus
// VAL-011/012/013). NexAI is this — rule checks, never machine learning.
import { isCableIdValid, isCableIdUnique } from './cableId.js'
import { DEFAULT_MEDIA_LIMITS_M } from './cableLength.js'

export function portKindFor(portId) {
  if (portId.startsWith('Gi')) return 'copper'
  if (portId.startsWith('Te')) return 'sfp'
  return 'copper' // patch panel ports are numeric labels; kind comes from the panel's own type instead
}

const COPPER_MEDIA = new Set(['cat6a'])

export function mediaCompatible(media, sourceKind, destKind) {
  const isCopperMedia = COPPER_MEDIA.has(media)
  const sourceIsCopper = sourceKind === 'copper'
  const destIsCopper = destKind === 'copper'
  return isCopperMedia ? sourceIsCopper && destIsCopper : !sourceIsCopper && !destIsCopper
}

// Returns an ordered list of { id, label, status: 'pass'|'fail'|'info', message }.
export function validateMapping({
  sourcePortFree,
  destPortFree,
  media,
  sourceKind,
  destKind,
  cableId,
  existingCableIds,
  excludeCableId,
  lengthResult, // from computeSuggestedLength
}) {
  const findings = []

  findings.push({
    id: 'source-port-available',
    label: 'Source port available',
    status: sourcePortFree ? 'pass' : 'fail',
    message: sourcePortFree ? 'Free' : 'Already used by another connection',
  })

  findings.push({
    id: 'dest-port-available',
    label: 'Destination port available',
    status: destPortFree ? 'pass' : 'fail',
    message: destPortFree ? 'Free' : 'Already used by another connection',
  })

  const compatible = mediaCompatible(media, sourceKind, destKind)
  findings.push({
    id: 'media-compatible',
    label: 'Media compatible',
    status: compatible ? 'pass' : 'fail',
    message: compatible ? `${media.toUpperCase()} matches both ports` : 'Selected media does not match port type at both ends',
  })

  const idValid = isCableIdValid(cableId)
  const idUnique = idValid && isCableIdUnique(cableId, existingCableIds, excludeCableId)
  findings.push({
    id: 'cable-id-unique',
    label: 'Cable ID unique',
    status: !idValid ? 'fail' : idUnique ? 'pass' : 'fail',
    message: !idValid ? 'Enter 1-32 characters' : idUnique ? 'No conflicts in this project' : 'Already used by another connection (VAL-013)',
  })

  if (lengthResult) {
    const limit = DEFAULT_MEDIA_LIMITS_M[media]
    if (lengthResult.estimated) {
      findings.push({
        id: 'cable-length',
        label: 'Suggested cable length',
        status: 'info',
        message: 'Cable pathway not surveyed — length is an estimate',
      })
    } else if (lengthResult.customLengthRequired) {
      findings.push({
        id: 'cable-length',
        label: 'Suggested cable length',
        status: 'fail',
        message: 'No stock length is long enough — custom length required (VAL-012)',
      })
    } else if (limit != null && lengthResult.rawMeters > limit) {
      findings.push({
        id: 'cable-length',
        label: 'Suggested cable length',
        status: 'fail',
        message: `Exceeds the ${limit} m ${media.toUpperCase()} limit (VAL-011)`,
      })
    } else {
      findings.push({
        id: 'cable-length',
        label: 'Suggested cable length',
        status: 'pass',
        message: `${lengthResult.suggested} m stock length`,
      })
    }
  }

  return findings
}

export function hasBlockingFailure(findings) {
  return findings.some((f) => f.status === 'fail')
}
