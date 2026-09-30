import { buildHostname } from '../lib/naming.js'

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
  { id: 'rack-tr-eg-01-r01', roomId: 'room-tr-eg-01', code: 'R01', heightU: 24 },
  { id: 'rack-tr-eg-02-r01', roomId: 'room-tr-eg-02', code: 'R01', heightU: 24 },
  { id: 'rack-tr-1og-01-r01', roomId: 'room-tr-1og-01', code: 'R01', heightU: 24 },
  { id: 'rack-tr-1og-02-r01', roomId: 'room-tr-1og-02', code: 'R01', heightU: 24 },
  { id: 'rack-tr-2og-01-r01', roomId: 'room-tr-2og-01', code: 'R01', heightU: 24 },
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
      ru: 20,
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
  { id: 'pp-ug1705-r01-cu', rackId: 'rack-ug1705-r01', ru: 30, heightU: 1, type: 'copper', ports: 24 },
  { id: 'pp-ug1705-r01-fi', rackId: 'rack-ug1705-r01', ru: 29, heightU: 1, type: 'fibre', ports: 24 },
  ...EDGE_ROOMS.map(({ rackId }, i) => ({
    id: `pp-edge-${i + 1}-cu`,
    rackId,
    ru: 18,
    heightU: 1,
    type: 'copper',
    ports: 24,
  })),
  ...EDGE_ROOMS.map(({ rackId }, i) => ({
    id: `pp-edge-${i + 1}-fi`,
    rackId,
    ru: 17,
    heightU: 1,
    type: 'fibre',
    ports: 24,
  })),
]

// 8-digit cable IDs, unique per project (brief v2.3 §6.1).
let nextCableId = 26184735
function newCableId() {
  return String(nextCableId++)
}

function directConnection({ id, source, dest, media, speed }) {
  return {
    id,
    source,
    dest,
    media,
    speed,
    sourceSfp: media === 'cat6a' ? null : `${speed}-${media.toUpperCase()}`,
    destSfp: media === 'cat6a' ? null : `${speed}-${media.toUpperCase()}`,
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
    source: { deviceId: 'dev-fusion', port: 'Te1/1/1' },
    dest: { deviceId: 'dev-border', port: 'Te1/1/1' },
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
]

export function getSiteForBuilding() {
  return { floors, rooms, racks, devices, patchPanels, connections }
}
