// HLD object library (brief v2.2 §3.6, render pages 7-8), grouped into the
// client-audit categories (brief client audit, catalogue taxonomy also used
// by DATA-MODEL.md §4.8): Active networking, Server, Infrastructure,
// External, Passive.
//
// A draggable device item carries a `role` — dropping it calls
// addDeviceFromLibrary() (api/hld.js), which creates a real device record.
// Passive's Room/Rack carry a `kind` instead: they reference existing
// surveyed objects rather than creating one (the canvas is already
// auto-populated from survey data — see Hld.jsx's handleDragEnd).
//
// Firewall/WLC/Server, and all of Infrastructure and External, have no HLD
// canvas representation yet — addDeviceFromLibrary() only builds a hostname
// for the 5 original roles (shared/naming.js ROLE_CODES), and the BOM's
// device-lines loop (bomModel.js) only iterates the same 5, so a device
// created with any other role would silently vanish from the Bill of
// Materials. Rather than extend the hostname/BOM/catalogue model as part of
// an icon-integration change, these items carry `comingSoon: true` and
// render inert, matching the "available in a later milestone" pattern used
// elsewhere (e.g. ProjectSettings.jsx) rather than wiring them into device
// creation.
//
// `icon` keys into TopologyIcon (lib/topologyIcons.js) — for role-based
// items it's always the same string as `role`.

export const HLD_LIBRARY_CATEGORIES = [
  {
    key: 'active-networking',
    label: 'Active networking',
    items: [
      { id: 'hld-fusion', label: 'Fusion', role: 'fusion', icon: 'fusion', model: 'Cisco C9500' },
      { id: 'hld-border', label: 'Border', role: 'border', icon: 'border', model: 'Cisco C9500' },
      { id: 'hld-distribution', label: 'Distribution', role: 'distribution', icon: 'distribution', model: 'Cisco C9500' },
      { id: 'hld-edge', label: 'Edge', role: 'edge', icon: 'edge', model: 'Cisco C9300-48UX' },
      { id: 'hld-ap', label: 'AP', role: 'ap', icon: 'ap', model: 'Cisco Catalyst 9130AXI' },
      { id: 'hld-firewall', label: 'Firewall', icon: 'firewall', comingSoon: true },
      { id: 'hld-wlc', label: 'WLC', icon: 'wlc', comingSoon: true },
    ],
  },
  {
    key: 'server',
    label: 'Server',
    items: [{ id: 'hld-server', label: 'Server', icon: 'server', comingSoon: true }],
  },
  {
    key: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { id: 'hld-ups', label: 'UPS', icon: 'ups', comingSoon: true },
      { id: 'hld-pdu', label: 'PDU', icon: 'pdu', comingSoon: true },
      { id: 'hld-sensor', label: 'Sensor', icon: 'sensor', comingSoon: true },
    ],
  },
  {
    key: 'external',
    label: 'External',
    items: [
      { id: 'hld-wan', label: 'WAN/SP connection', icon: 'wan-circuit', comingSoon: true },
      { id: 'hld-remote-site', label: 'Remote site', icon: 'remote-site', comingSoon: true },
    ],
  },
  {
    key: 'passive',
    label: 'Passive',
    items: [
      { id: 'hld-room', label: 'Room', kind: 'room-ref', icon: 'room' },
      { id: 'hld-rack', label: 'Rack', kind: 'rack-ref', icon: 'rack' },
    ],
  },
]
