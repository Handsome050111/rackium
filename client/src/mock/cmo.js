// CMO (existing inventory) records per room, imported from the client's
// Excel during CMO Inventory Validation (brief v2.3 §5.1). Used during
// survey to validate each placed device's serial/MAC.

export const cmoByRoom = {
  'room-tr-eg-01': [
    { serial: 'FCW2637A1B2', mac: '00:1A:2B:3C:4D:5E', expectedHostname: 'E-DE-ERL-C01-B001-EG-001' },
    { serial: 'FCW2637A1C3', mac: '00:1A:2B:3C:4D:5F', expectedHostname: 'A-DE-ERL-C01-B001-EG-001' },
  ],
  'room-tr-eg-02': [
    { serial: 'FCW2637A1D4', mac: '00:1A:2B:3C:4D:60', expectedHostname: 'E-DE-ERL-C01-B001-EG-002' },
  ],
  'room-tr-1og-01': [
    { serial: 'FCW2637A1E5', mac: '00:1A:2B:3C:4D:61', expectedHostname: 'E-DE-ERL-C01-B001-1OG-001' },
  ],
  'room-tr-1og-02': [
    { serial: 'FCW2637A1F6', mac: '00:1A:2B:3C:4D:62', expectedHostname: 'E-DE-ERL-C01-B001-1OG-002' },
  ],
  'room-tr-2og-01': [
    { serial: 'FCW2637A1G7', mac: '00:1A:2B:3C:4D:63', expectedHostname: 'E-DE-ERL-C01-B001-2OG-001' },
  ],
  'room-ug1705': [
    { serial: 'FXS2141Q0A1', mac: '00:1A:2B:3C:5A:01', expectedHostname: 'F-DE-ERL-C01-B001-FU1-001' },
    { serial: 'FXS2141Q0A2', mac: '00:1A:2B:3C:5A:02', expectedHostname: 'B-DE-ERL-C01-B001-FU1-001' },
  ],
}

// Serials already recorded against a placed device anywhere in the project
// (for the live duplicate check). Seeded with the two devices already
// placed in TR-EG-01 from the mock site data.
export const projectSerials = [
  { deviceId: 'dev-edge-1', serial: 'FCW2637A1B2' },
  { deviceId: 'dev-ap-1', serial: 'FCW2637A1C3' },
]

export function getCmoForRoom(roomId) {
  return cmoByRoom[roomId] ?? []
}
