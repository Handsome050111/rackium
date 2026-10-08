import { describe, it, expect } from 'vitest'
import { TOPOLOGY_ICONS } from './topologyIcons.js'

// The full set of roles the icon integration (Affinity symbol set, see
// docs/THIRD-PARTY.md) is required to cover — every role currently rendered
// on a canvas (HldNodes.jsx, CmdbLocationTree.jsx) or offered in the HLD
// object library (mock/hldLibrary.js), plus room/rack.
const REQUIRED_ROLES = [
  'fusion',
  'border',
  'distribution',
  'edge',
  'ap',
  'wlc',
  'firewall',
  'server',
  'ups',
  'pdu',
  'sensor',
  'wan-circuit',
  'remote-site',
  'room',
  'rack',
]

describe('TOPOLOGY_ICONS', () => {
  it('has a non-empty SVG for every required role', () => {
    for (const role of REQUIRED_ROLES) {
      expect(TOPOLOGY_ICONS[role], `missing icon for role "${role}"`).toBeTruthy()
      expect(TOPOLOGY_ICONS[role]).toContain('<svg')
    }
  })

  it('never bakes a colour into the markup — every icon uses currentColor', () => {
    for (const [role, svg] of Object.entries(TOPOLOGY_ICONS)) {
      expect(svg, `${role} contains a hardcoded fill colour`).not.toMatch(/fill:\s*(#|rgb)/i)
      expect(svg, `${role} never sets currentColor`).toContain('currentColor')
    }
  })
})
