// Survey-captured facts about the physical rack (brief v2.3 §5.2 render
// reference: rack details / mounting & power / cable path / accessibility).
// These are entered facts, not calculated — the Readiness summary derives
// pass/fail judgements from them plus the placed objects.

export const rackSurveyMeta = {
  'rack-tr-eg-01-r01': {
    details: { type: 'Floor-standing', standard: '19-inch', externalDepthMm: 1000, usableDepthMm: 850, railDistanceMm: 720, condition: 'Good' },
    mountingPower: {
      cageNutType: 'M6',
      availableCageNutSets: 24,
      mountingRails: 'Front & rear',
      pduA: { totalSockets: 24, freeSockets: 12 },
      pduB: { totalSockets: 24, freeSockets: 10 },
      redundantPower: 'Available',
      earthingVerified: true,
    },
    cablePath: {
      mainCableEntry: 'Top',
      pathway: 'Overhead tray',
      secondaryEntry: 'Raised floor',
      verticalManagers: 2,
      horizontalManagers: 1,
    },
    accessibility: {
      front: 'Accessible',
      rear: 'Accessible',
      left: 'Not accessible',
      right: 'Not accessible',
      frontClearanceMm: 1200,
      rearClearanceMm: 900,
    },
  },
  'rack-tr-eg-01-r02': {
    details: { type: 'Floor-standing', standard: '19-inch', externalDepthMm: 800, usableDepthMm: 650, railDistanceMm: 600, condition: 'Fair' },
    mountingPower: {
      cageNutType: 'M6',
      availableCageNutSets: 12,
      mountingRails: 'Front only',
      pduA: { totalSockets: 12, freeSockets: 12 },
      pduB: null,
      redundantPower: 'Not available',
      earthingVerified: true,
    },
    cablePath: {
      mainCableEntry: 'Bottom',
      pathway: 'Raised floor',
      secondaryEntry: 'None',
      verticalManagers: 0,
      horizontalManagers: 0,
    },
    accessibility: {
      front: 'Accessible',
      rear: 'Not accessible',
      left: 'Accessible',
      right: 'Not accessible',
      frontClearanceMm: 900,
      rearClearanceMm: 300,
    },
  },
}

const FALLBACK_META = {
  details: { type: 'Floor-standing', standard: '19-inch', externalDepthMm: 1000, usableDepthMm: 850, railDistanceMm: 720, condition: 'Good' },
  mountingPower: {
    cageNutType: 'M6',
    availableCageNutSets: 24,
    mountingRails: 'Front & rear',
    pduA: { totalSockets: 24, freeSockets: 24 },
    pduB: { totalSockets: 24, freeSockets: 24 },
    redundantPower: 'Available',
    earthingVerified: true,
  },
  cablePath: { mainCableEntry: 'Top', pathway: 'Overhead tray', secondaryEntry: 'Raised floor', verticalManagers: 1, horizontalManagers: 1 },
  accessibility: { front: 'Accessible', rear: 'Accessible', left: 'Not accessible', right: 'Not accessible', frontClearanceMm: 1000, rearClearanceMm: 800 },
}

export function getRackSurveyMeta(rackId) {
  return rackSurveyMeta[rackId] ?? FALLBACK_META
}
