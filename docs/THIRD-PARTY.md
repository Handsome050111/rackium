# Third-party assets

## Affinity symbol set — topology icons

- **Source:** https://github.com/ecceman/affinity
- **Licence:** Unlicense (public domain) — see the repo's `LICENSE`
- **Date imported:** 2026-10-08
- **Used for:** device/role icons on the HLD, LLD, Deployment and CMDB
  canvases and the HLD object library (`client/src/assets/icons/topology/`,
  `client/src/lib/topologyIcons.js`, `client/src/components/TopologyIcon.jsx`).

### Files taken from the set (`svg/naked/*.svg`, the backgroundless variant)

| Rackium role | Source file |
|---|---|
| `fusion` | `switch_multilayer.svg` |
| `border` | `router.svg` |
| `distribution` | `interconnect.svg` |
| `edge` | `switch.svg` |
| `ap` | `wifi.svg` |
| `wlc` | `wlc.svg` |
| `firewall` | `firewall.svg` |
| `server` | `server.svg` |
| `wan-circuit` | `cloud.svg` |
| `remote-site` | `office.svg` |

### Modifications

- Recoloured: the source fill (`rgb(77,77,77)` / `rgb(75,75,75)`) was replaced
  with `fill:currentColor` so colour is applied by the consuming component
  (`className="text-brand"`, matching how the app's lucide-react icons are
  styled) and is never baked into the SVG.
- `distribution` (from `interconnect.svg`): the source file's white
  centre-knockout `<circle>` was removed (a hardcoded white fill would not
  have worked once a colour class, rather than an opaque background, controls
  the glyph).
- All files passed through SVGO (`npx svgo --multipass`) for minification.

### Not from this set — drawn in-house, same style

No icon in the Affinity set fits these five roles. They were hand-drawn at
`client/src/assets/icons/topology/{room,rack,ups,pdu,sensor}.svg` as flat
single-colour silhouettes (`fill:currentColor`, no stroke) on a 200×200 grid,
matching the sourced icons' visual language:

- `room` — a floor-plan frame with a door-swing wedge.
- `rack` — a rack-elevation frame with horizontal U-slot dividers.
- `ups` — a rounded enclosure with a lightning-bolt cutout.
- `pdu` — a power-strip enclosure with three outlet holes.
- `sensor` — a centre dot with three concentric signal rings (radar/ping
  motif).

### Explicitly not used

Per instruction, no icons were taken from `aci686/Network-Icons-SVG` or any
Cisco/Microsoft stencil set.
