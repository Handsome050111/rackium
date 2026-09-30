// Survey-captured facts about a communication room (brief v2.3 §5.2,
// render pages 3-4's "Selected object" panel). Entered facts, not
// calculated — siteValidation.js derives pass/fail from these plus the
// placed racks.

export const roomSurveyMeta = {
  'room-tr-eg-01': { access: 'verified', power: 'available', environment: 'to-verify', photoCount: 3 },
  'room-tr-eg-02': { access: 'verified', power: 'available', environment: 'verified', photoCount: 2 },
  'room-tr-1og-01': { access: 'verified', power: 'available', environment: 'verified', photoCount: 1 },
  'room-tr-1og-02': { access: 'not-verified', power: 'unknown', environment: 'unknown', photoCount: 0 },
  'room-tr-2og-01': { access: 'not-verified', power: 'unknown', environment: 'unknown', photoCount: 0 },
  'room-ug1705': { access: 'verified', power: 'available', environment: 'verified', photoCount: 4 },
  'room-b002-eg-01': { access: 'verified', power: 'available', environment: 'verified', photoCount: 2 },
  'room-b002-1og-01': { access: 'not-verified', power: 'unknown', environment: 'unknown', photoCount: 0 },
  'room-b003-eg-01': { access: 'verified', power: 'available', environment: 'to-verify', photoCount: 1 },
}

const DEFAULT_META = { access: 'not-verified', power: 'unknown', environment: 'unknown', photoCount: 0 }

export function getRoomSurveyMeta(roomId) {
  return roomSurveyMeta[roomId] ?? DEFAULT_META
}

export function hasRoomSurveyMeta(roomId) {
  return Object.prototype.hasOwnProperty.call(roomSurveyMeta, roomId)
}
