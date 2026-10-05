import { buildHostname } from '@rackium/shared/naming.js'
import { getCompatibleSfps } from './sfpCatalog.js'

const HN = { country: 'DE', sal: 'ERL', campus: 'C01', building: 'B001' }

export const floors = [
  { id: 'b001-fu1', buildingId: 'b001', token: 'FU1', name: 'Basement (FU1)', order: 0 },
  { id: 'b001-eg', buildingId: 'b001', token: 'EG', name: 'Ground floor (EG)', order: 1 },
  { id: 'b001-1og', buildingId: 'b001', token: '1.OG', name: '1st floor (1.OG)', order: 2 },
  { id: 'b001-2og', buildingId: 'b001', token: '2.OG', name: '2nd floor (2.OG)', order: 3 },
  { id: 'b001-3og', buildingId: 'b001', token: '3.OG', name: '3rd floor (3.OG)', order: 4 },
]

export const rooms = [
  { id: 'room-ug1705', floorId: 'b001-fu1', code: 'UG1705', name: 'UG1705 (main comms room)', isMainRoom: true },
  { id: 'room-tr-eg-01', floorId: 'b001-eg', code: 'TR-EG-01', name: 'TR-EG-01' },
  { id: 'room-tr-eg-02', floorId: 'b001-eg', code: 'TR-EG-02', name: 'TR-EG-02' },
  { id: 'room-tr-1og-01', floorId: 'b001-1og', code: 'TR-1OG-01', name: 'TR-1OG-01' },
  { id: 'room-tr-1og-02', floorId: 'b001-1og', code: 'TR-1OG-02', name: 'TR-1OG-02' },
  { id: 'room-tr-2og-01', floorId: 'b001-2og', code: 'TR-2OG-01', name: 'TR-2OG-01' },
]

export const racks = [
  { id: 'rack-ug1705-r01', roomId: 'room-ug1705', code: 'R01', heightU: 42 },
  { id: 'rack-ug1705-r02', roomId: 'room-ug1705', code: 'R02', heightU: 42 },
  { id: 'rack-tr-eg-01-r01', roomId: 'room-tr-eg-01', code: 'R01', heightU: 42 },
  // Custom height, as found in the Siemens survey (brief v2.3 §4.1) — used
  // to prove RackElevation isn't hardcoded to 42U.
  { id: 'rack-tr-eg-01-r02', roomId: 'room-tr-eg-01', code: 'R02', heightU: 23 },
  { id: 'rack-tr-eg-02-r01', roomId: 'room-tr-eg-02', code: 'R01', heightU: 42 },
  { id: 'rack-tr-1og-01-r01', roomId: 'room-tr-1og-01', code: 'R01', heightU: 42 },
  { id: 'rack-tr-1og-02-r01', roomId: 'room-tr-1og-02', code: 'R01', heightU: 42 },
  { id: 'rack-tr-2og-01-r01', roomId: 'room-tr-2og-01', code: 'R01', heightU: 42 },
]

// Edge/AP rooms, in the order the five access rooms are numbered.
const EDGE_ROOMS = [
  { roomId: 'room-tr-eg-01', rackId: 'rack-tr-eg-01-r01', floor: 'EG', seq: 1 },
  { roomId: 'room-tr-eg-02', rackId: 'rack-tr-eg-02-r01', floor: 'EG', seq: 2 },
  { roomId: 'room-tr-1og-01', rackId: 'rack-tr-1og-01-r01', floor: '1.OG', seq: 1 },
  { roomId: 'room-tr-1og-02', rackId: 'rack-tr-1og-02-r01', floor: '1.OG', seq: 2 },
  { roomId: 'room-tr-2og-01', rackId: 'rack-tr-2og-01-r01', floor: '2.OG', seq: 1 },
]

export const devices = [
  {
    id: 'dev-fusion',
    hostname: buildHostname({ ...HN, role: 'F', floor: 'FU1', seq: 1 }),
    role: 'fusion',
    model: 'Cisco C9500',
    rackId: 'rack-ug1705-r01',
    ru: 40,
    heightU: 1,
    face: 'front',
    status: 'planned',
  },
  {
    id: 'dev-border',
    hostname: buildHostname({ ...HN, role: 'B', floor: 'FU1', seq: 1 }),
    role: 'border',
    model: 'Cisco C9500',
    rackId: 'rack-ug1705-r01',
    ru: 38,
    heightU: 1,
    face: 'front',
    status: 'planned',
  },
  {
    id: 'dev-sdwan-cpe',
    hostname: 'CPE-DE-ERL-C01-B001-FU1-001',
    role: 'wan-circuit',
    model: 'Telekom SD-WAN CPE',
    rackId: 'rack-ug1705-r01',
    ru: 36,
    heightU: 1,
    face: 'front',
    status: 'planned',
  },
  ...EDGE_ROOMS.flatMap(({ roomId, rackId, floor, seq }, i) => [
    {
      id: `dev-edge-${i + 1}`,
      hostname: buildHostname({ ...HN, role: 'E', floor, seq }),
      role: 'edge',
      model: 'Cisco C9300-48UX',
      rackId,
      roomId,
      // RU40 in every edge rack — the §6.3 worked example (RU40 -> RU42
      // same rack = 0.59m -> 1m stock) runs against this exact placement.
      ru: 40,
      heightU: 1,
      face: 'front',
      status: 'planned',
    },
    {
      id: `dev-ap-${i + 1}`,
      hostname: buildHostname({ ...HN, role: 'A', floor, seq }),
      role: 'ap',
      model: 'Cisco Catalyst 9130AXI',
      rackId: null,
      roomId,
      mounting: 'ceiling',
      status: 'planned',
    },
  ]),
]

export const patchPanels = [
  { id: 'pp-ug1705-r01-cu', code: 'PP-CORE-CU', rackId: 'rack-ug1705-r01', ru: 30, heightU: 1, face: 'front', type: 'copper', ports: 24 },
  { id: 'pp-ug1705-r01-fi', code: 'PP-CORE-FI', rackId: 'rack-ug1705-r01', ru: 29, heightU: 1, face: 'front', type: 'fibre', ports: 24 },
  // PP-01..PP-10, two per edge room (copper then fibre), RU42/RU41 above
  // the Edge switch at RU40 — matches render page 15's rack layout.
  ...EDGE_ROOMS.flatMap(({ rackId }, i) => [
    {
      id: `pp-edge-${i + 1}-cu`,
      code: `PP-${String(2 * i + 1).padStart(2, '0')}`,
      rackId,
      ru: 42,
      heightU: 1,
      face: 'front',
      type: 'copper',
      ports: 24,
      // PP-09 (TR-2OG-01) is fully patched from a prior deployment phase —
      // ports occupied by legacy cabling outside this project's scope, so
      // there's no full connection record for the far end. Used to
      // demonstrate a genuine patch-panel-capacity block in HLD validation
      // (brief v2.3 §6.4/§6.8) — distance is NOT the constraint here.
      ...(i === 4 ? { preOccupiedPorts: Array.from({ length: 24 }, (_, n) => String(n + 1).padStart(2, '0')) } : {}),
    },
    {
      id: `pp-edge-${i + 1}-fi`,
      code: `PP-${String(2 * i + 2).padStart(2, '0')}`,
      rackId,
      ru: 41,
      heightU: 1,
      face: 'front',
      type: 'fibre',
      ports: 24,
    },
  ]),
]

// 8-digit cable IDs, unique per project (brief v2.3 §6.1).
let nextCableId = 26184735
function newCableId() {
  return String(nextCableId++)
}

function directConnection({ id, source, dest, media, speed }) {
  // Cat6a is RJ45, not a pluggable optic — no SFP applies. Fibre links get
  // a real code from the sfpCatalog (the same catalog HLD validation
  // checks against), not a made-up placeholder.
  const sfpCode = media === 'cat6a' ? null : (getCompatibleSfps(media, speed)[0]?.code ?? null)
  return {
    id,
    source,
    dest,
    media,
    speed,
    sourceSfp: sfpCode,
    destSfp: sfpCode,
    cableId: newCableId(),
    hops: [],
    lengths: { suggested: null, engineerSelected: null, installed: null },
    status: 'designed',
    testResult: null,
  }
}

export const connections = [
  directConnection({
    id: 'conn-fusion-border',
    // Border's own uplink to Fusion sits at the top of its 24-port core map,
    // clear of Te1/1/1-5 (reserved for the 5 downstream Edge uplinks below)
    // so the two never collide on the same physical port.
    source: { deviceId: 'dev-fusion', port: 'Te1/1/1' },
    dest: { deviceId: 'dev-border', port: 'Te1/1/24' },
    media: 'cat6a',
    speed: '10G',
  }),
  directConnection({
    id: 'conn-fusion-sdwan',
    source: { deviceId: 'dev-fusion', port: 'Gi1/1/1' },
    dest: { deviceId: 'dev-sdwan-cpe', port: 'WAN1' },
    media: 'cat6a',
    speed: '1G',
  }),
  ...EDGE_ROOMS.map((_room, i) => {
    const isOm4Exception = i === 1 // TR-EG-02 / Edge 02 is the one OM4 link
    return directConnection({
      id: `conn-border-edge-${i + 1}`,
      source: { deviceId: 'dev-border', port: `Te1/1/${i + 1}` },
      dest: { deviceId: `dev-edge-${i + 1}`, port: 'Te1/1/1' },
      media: isOm4Exception ? 'om4' : 'os2',
      speed: '10G',
    })
  }),
  // Pre-existing access patching in TR-EG-01 (Rackium Editor Revision 12),
  // so the editor has real mappings to show alongside a fresh one.
  directConnection({
    id: 'conn-edge1-pp01-01',
    source: { deviceId: 'dev-edge-1', port: 'Gi1/0/1' },
    dest: { deviceId: 'pp-edge-1-cu', port: '01' },
    media: 'cat6a',
    speed: '1G',
  }),
  directConnection({
    id: 'conn-edge1-pp01-02',
    source: { deviceId: 'dev-edge-1', port: 'Gi1/0/2' },
    dest: { deviceId: 'pp-edge-1-cu', port: '02' },
    media: 'cat6a',
    speed: '1G',
  }),
]

export function getSiteForBuilding() {
  return { floors, rooms, racks, devices, patchPanels, connections }
}
