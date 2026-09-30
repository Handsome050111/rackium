// Structural survey data for B003 (Logistics). Minimal on purpose — see
// b002-site.js.

export const floors = [
  { id: 'b003-eg', buildingId: 'b003', token: 'EG', name: 'Ground floor (EG)', order: 0 },
  { id: 'b003-1og', buildingId: 'b003', token: '1.OG', name: '1st floor (1.OG)', order: 1 },
]

export const rooms = [{ id: 'room-b003-eg-01', floorId: 'b003-eg', code: 'TR-B003-EG-01', name: 'TR-B003-EG-01' }]

export const racks = [{ id: 'rack-b003-eg-01-r01', roomId: 'room-b003-eg-01', code: 'R01', heightU: 42 }]

export const devices = []
export const patchPanels = []
export const connections = []
