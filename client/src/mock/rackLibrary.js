// Rack object library (brief v2.3 §5.2 rack survey library list). Dragged
// from the right-side panel onto an RU (§7.5). Catalogue items link to real
// models where available; these are generic placeholders.

export const RACK_LIBRARY_ITEMS = [
  { id: 'lib-pp-24', label: '24-port patch panel', category: 'Patch panels', heightU: 1, mounting: 'rack', icon: 'Grid3x3' },
  { id: 'lib-pp-48', label: '48-port patch panel', category: 'Patch panels', heightU: 1, mounting: 'rack', icon: 'Grid3x3' },
  { id: 'lib-pp-fibre', label: 'Fibre patch panel', category: 'Patch panels', heightU: 1, mounting: 'rack', icon: 'Grid3x3' },
  { id: 'lib-sw-24', label: '24-port switch', category: 'Switches', heightU: 1, mounting: 'rack', icon: 'Server' },
  { id: 'lib-sw-48', label: '48-port switch', category: 'Switches', heightU: 1, mounting: 'rack', icon: 'Server' },
  { id: 'lib-sw-chassis', label: 'Chassis switch', category: 'Switches', heightU: 7, mounting: 'rack', fullDepth: true, icon: 'Server' },
  { id: 'lib-firewall', label: 'Firewall', category: 'Security', heightU: 1, mounting: 'rack', icon: 'ShieldAlert' },
  { id: 'lib-cable-manager', label: 'Cable manager', category: 'Cable management', heightU: 1, mounting: 'rack', icon: 'Cable' },
  { id: 'lib-brush-panel', label: 'Brush panel', category: 'Cable management', heightU: 1, mounting: 'rack', icon: 'Minus' },
  { id: 'lib-pdu-0u', label: 'PDU (0U)', category: 'Power', heightU: 0, mounting: '0U', icon: 'Plug' },
  { id: 'lib-pdu-1u', label: 'PDU (1U)', category: 'Power', heightU: 1, mounting: 'rack', icon: 'Plug' },
  { id: 'lib-ups', label: 'UPS', category: 'Power', heightU: 3, mounting: 'rack', icon: 'BatteryCharging' },
  { id: 'lib-shelf', label: 'Shelf', category: 'Accessories', heightU: 1, mounting: 'rack', icon: 'Layers' },
  { id: 'lib-blanking-panel', label: 'Blanking panel', category: 'Accessories', heightU: 1, mounting: 'rack', icon: 'Square' },
  { id: 'lib-kvm-tray', label: 'KVM tray', category: 'Accessories', heightU: 1, mounting: 'rack', icon: 'MonitorSmartphone' },
  { id: 'lib-fan-unit', label: 'Fan unit', category: 'Accessories', heightU: 1, mounting: 'rack', icon: 'Fan' },
  { id: 'lib-other', label: 'Other accessory', category: 'Accessories', heightU: 1, mounting: 'rack', icon: 'Package' },
]

// Rack-state tools, not catalogue devices — each sets an RU's state rather
// than placing equipment. Gated by role (brief v2.3 §4.1: reserved is
// Architect-only, blocked is PM/Org Admin-only).
export const RACK_STATE_TOOLS = [
  { id: 'tool-reserved', label: 'Reserved RU', kind: 'reserved', heightU: 1, permission: 'canReserve', icon: 'Bookmark' },
  { id: 'tool-blocked', label: 'Blocked RU', kind: 'blocked', heightU: 1, permission: 'canBlock', icon: 'Ban' },
]
