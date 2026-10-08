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

// Every file in the folder, not just the ones TOPOLOGY_ICONS imports — a
// newly added SVG is checked before anyone wires it in. TopologyIcon inlines
// this markup with dangerouslySetInnerHTML, so it must be inert.
const ALL_SVG_FILES = import.meta.glob('../assets/icons/topology/*.svg', { query: '?raw', import: 'default', eager: true })

describe('topology SVG files are safe to inline', () => {
  const files = Object.entries(ALL_SVG_FILES)

  it('finds the icon files', () => {
    expect(files.length).toBeGreaterThanOrEqual(REQUIRED_ROLES.length)
  })

  it.each(files)('%s has no <script> or <foreignObject>', (_file, svg) => {
    expect(svg).not.toMatch(/<script\b/i)
    expect(svg).not.toMatch(/<foreignObject\b/i)
  })

  it.each(files)('%s has no on* event-handler attributes', (_file, svg) => {
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it.each(files)('%s has no external href / xlink:href', (_file, svg) => {
    // Any href that isn't a same-document fragment (#id) is external,
    // including javascript: and data: URLs.
    for (const [, value] of svg.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
      expect(value, `href="${value}"`).toMatch(/^#/)
    }
  })

  it.each(files)('%s has no embedded raster images', (_file, svg) => {
    expect(svg).not.toMatch(/<image\b/i)
    expect(svg).not.toMatch(/data:image\//i)
  })
})

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
