import { TOPOLOGY_ICONS } from '../lib/topologyIcons.js'

// The one place a topology role (HLD/LLD/Deployment/CMDB device roles, plus
// room/rack) is turned into a glyph — screens key off `role` and never import
// an icon file directly. Renders inline (not <img>) so the SVGs' fill:currentColor
// picks up `className`'s text color, matching how lucide-react icons are styled
// elsewhere (e.g. `className="text-brand"`). Falls back to the generic server
// glyph for an unrecognised role, mirroring the `?? Server` fallback it replaces.
export default function TopologyIcon({ role, size = 16, className = '', title }) {
  const markup = TOPOLOGY_ICONS[role] ?? TOPOLOGY_ICONS.server

  return (
    <span
      className={`inline-block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      // Safe: markup is always one of our own build-time-bundled SVG assets
      // (TOPOLOGY_ICONS), never user- or server-supplied content.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
