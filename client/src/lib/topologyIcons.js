// Topology device/role icons (Affinity symbol set, see docs/THIRD-PARTY.md for
// provenance) imported via Vite's `?raw` so TopologyIcon can inline them —
// inline markup is required (not an <img src>) so `fill:currentColor` in the
// SVGs picks up the wrapper's text color, the same way lucide-react icons do.
import fusion from '../assets/icons/topology/fusion.svg?raw'
import border from '../assets/icons/topology/border.svg?raw'
import distribution from '../assets/icons/topology/distribution.svg?raw'
import edge from '../assets/icons/topology/edge.svg?raw'
import ap from '../assets/icons/topology/ap.svg?raw'
import wlc from '../assets/icons/topology/wlc.svg?raw'
import firewall from '../assets/icons/topology/firewall.svg?raw'
import server from '../assets/icons/topology/server.svg?raw'
import ups from '../assets/icons/topology/ups.svg?raw'
import pdu from '../assets/icons/topology/pdu.svg?raw'
import sensor from '../assets/icons/topology/sensor.svg?raw'
import wanCircuit from '../assets/icons/topology/wan-circuit.svg?raw'
import remoteSite from '../assets/icons/topology/remote-site.svg?raw'
import room from '../assets/icons/topology/room.svg?raw'
import rack from '../assets/icons/topology/rack.svg?raw'

// Keyed by the same role strings used throughout HLD/LLD/Deployment/CMDB
// (shared/src/naming.js ROLE_CODES, shared/src/lldModel.js ROLE_RANK) plus
// the additions this icon set introduces, in the same lowercase-hyphenated
// style as the existing 'wan-circuit' role.
export const TOPOLOGY_ICONS = {
  fusion,
  border,
  distribution,
  edge,
  ap,
  wlc,
  firewall,
  server,
  ups,
  pdu,
  sensor,
  'wan-circuit': wanCircuit,
  'remote-site': remoteSite,
  room,
  rack,
}
