// Site size drives which network layers a design needs. An "S" site has no
// distribution layer (Border uplinks straight to the Edge nodes).
export const siteProfileByBuilding = {
  b001: { size: 'S' },
}

export function getSiteProfile(buildingId) {
  return siteProfileByBuilding[buildingId] ?? { size: 'S' }
}
