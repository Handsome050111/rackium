// Single source of truth for Rackium visual tokens (brief v2.3 §7.1).
// Imported by tailwind.config.js (class-based styling) and directly by
// components that need raw values (inline SVG strokes, canvas drawing).

export const colors = {
  // Interface (v2.3 §7.1)
  textPrimary: '#111318',
  textSecondary: '#4B5262',
  background: '#FFFFFF',
  backgroundMuted: '#F5F6F8',
  border: '#E2E5EA',
  brandBlue: '#094F9A',
  brandRed: '#ED1A4C',

  // Status (icons/labels only — never large fills)
  statusGrey: '#8A909C',
  statusAmber: '#F2994A',
  statusRed: '#ED1A4C',
  statusGreen: '#2E9E5B',
}

// Cable media colours (v2.3 §7.1, configurable per organisation later)
export const mediaColors = {
  os2: { stroke: '#FFD700', edge: '#B89A00' }, // SM fibre — thin darker edge to stay visible on white
  om4: { stroke: '#F4A624', edge: null },
  cat6a: { stroke: '#094F9A', edge: null },
  stack: { stroke: '#2E7D32', edge: null },
  dac: { stroke: '#7B1FA2', edge: null },
  power: { stroke: '#757575', edge: null, style: 'solid' },
  planned: { stroke: '#8A909C', edge: null, style: 'dashed' },
}

// Phase status model (v2.3 §4.4). "Pending" is never used.
export const phaseStatus = {
  not_started: { label: 'Not started', color: 'grey', pulsing: false },
  in_progress: { label: 'In progress', color: 'amber', pulsing: false },
  awaiting_approval: { label: 'Awaiting approval', color: 'amber', pulsing: true },
  changes_requested: { label: 'Changes requested', color: 'red', pulsing: false },
  blocked: { label: 'Blocked', color: 'red', pulsing: false, icon: 'blocker' },
  approved: { label: 'Approved', color: 'green', pulsing: false, icon: 'check' },
  completed: { label: 'Completed', color: 'green', pulsing: false, icon: 'check' },
}

// RU states (v2.3 §7.5 / §4.1)
export const ruState = {
  free: { fill: 'transparent', border: '#E2E5EA' },
  occupied: { fill: '#EAF1FB', border: '#094F9A' },
  reserved: { fill: 'transparent', border: '#094F9A', style: 'dashed' },
  blocked: { fill: '#F5F6F8', border: '#8A909C', style: 'hatched' },
}

export const spacing = {
  gutter: '16px',
  touchTarget: '44px',
}

export const breakpoints = {
  phone: 0,
  tablet: 768,
  ipad: 1024,
  desktop: 1280,
}
