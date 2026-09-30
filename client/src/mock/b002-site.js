// Structural survey data for B002 (Production). Minimal on purpose — this
// building only needs to exist for the multi-building Site Structure view
// and cross-building connections; it has no device roster yet.

export const floors = [
  { id: 'b002-eg', buildingId: 'b002', token: 'EG', name: 'Ground floor (EG)', order: 0 },
  { id: 'b002-1og', buildingId: 'b002', token: '1.OG', name: '1st floor (1.OG)', order: 1 },
  { id: 'b002-2og', buildingId: 'b002', token: '2.OG', name: '2nd floor (2.OG)', order: 2 },
]

export const rooms = [
  { id: 'room-b002-eg-01', floorId: 'b002-eg', code: 'TR-B002-EG-01', name: 'TR-B002-EG-01' },
  { id: 'room-b002-1og-01', floorId: 'b002-1og', code: 'TR-B002-1OG-01', name: 'TR-B002-1OG-01' },
]

export const racks = [
  { id: 'rack-b002-eg-01-r01', roomId: 'room-b002-eg-01', code: 'R01', heightU: 42 },
  { id: 'rack-b002-1og-01-r01', roomId: 'room-b002-1og-01', code: 'R01', heightU: 42 },
]

export const devices = []
export const patchPanels = []
export const connections = []
