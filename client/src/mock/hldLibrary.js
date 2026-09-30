// HLD object library (brief v2.2 §3.6, render pages 7-8). Network devices
// create new device records (shared with Rackium Editor via
// api/networkStore.js). Room/Rack reference existing surveyed objects —
// the canvas is auto-populated from survey data already, so these add back
// any surveyed room/rack not currently shown, rather than creating new
// physical structure (that's Site Structure's job, brief v2.3 §5.2).

export const HLD_DEVICE_LIBRARY = [
  { id: 'hld-fusion', label: 'Fusion', role: 'fusion', icon: 'Server', model: 'Cisco C9500' },
  { id: 'hld-border', label: 'Border', role: 'border', icon: 'Server', model: 'Cisco C9500' },
  { id: 'hld-distribution', label: 'Distribution', role: 'distribution', icon: 'Server', model: 'Cisco C9500' },
  { id: 'hld-edge', label: 'Edge', role: 'edge', icon: 'Server', model: 'Cisco C9300-48UX' },
  { id: 'hld-ap', label: 'AP', role: 'ap', icon: 'Wifi', model: 'Cisco Catalyst 9130AXI' },
]

export const HLD_REFERENCE_LIBRARY = [
  { id: 'hld-room', label: 'Room', kind: 'room-ref', icon: 'DoorOpen' },
  { id: 'hld-rack', label: 'Rack', kind: 'rack-ref', icon: 'Building2' },
]
