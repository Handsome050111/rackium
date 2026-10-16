// Fixture data for the document assembly tests (M6b): the shapes the server
// loaders produce, small but complete.
export const ctx = { project: { name: 'Acme Campus', code: 'ACM', clientName: 'Acme Retail' }, building: { code: 'B001', name: 'Headquarters' }, versionLabel: 'v1', generatedAt: new Date('2026-10-15T08:00:00Z') }

const floors = [{ id: 'f1', token: 'EG', name: 'Ground floor', order: 0 }]
const rooms = [
  { id: 'r1', floorId: 'f1', code: 'TR-EG-01' },
  { id: 'r2', floorId: 'f1', code: 'TR-EG-02' },
]
const placements = [{ id: 'd1', ru: 40, heightU: 1, face: 'front', mounting: 'rack', kind: 'device', label: 'B-SW-01', sublabel: 'C9500' }]
export const lld = {
  floors,
  rooms,
  racks: [
    { id: 'k1', roomId: 'r1', code: 'R01', heightU: 42, placements },
    { id: 'k2', roomId: 'r2', code: 'R01', heightU: 42, placements: [{ id: 'p1', ru: 42, heightU: 1, face: 'front', mounting: 'rack', kind: 'device', label: 'PP-01' }] },
  ],
  devices: [
    { id: 'd1', hostname: 'B-SW-01', label: 'B-SW-01', role: 'border', roleLabel: 'Border', model: 'C9500', roomId: 'r1', rackId: 'k1', inDesign: true, ports: [{ id: 'Te1/1/1', type: 'SFP+' }, { id: 'Te1/1/2', type: 'SFP+' }] },
    { id: 'd2', hostname: 'E-SW-01', label: 'E-SW-01', role: 'edge', roleLabel: 'Edge', model: 'C9300-48UX', roomId: 'r2', rackId: 'k2', inDesign: true, ports: [{ id: 'Te1/1/1', type: 'SFP+' }, { id: 'Gi1/0/1', type: 'RJ45' }] },
    { id: 'a1', hostname: 'A-AP-01', label: 'A-AP-01', role: 'ap', roleLabel: 'AP', model: '9130AXI', roomId: 'r2', rackId: null, inDesign: true, ports: [{ id: 'Eth0', type: 'RJ45' }] },
    { id: 'p1', hostname: null, label: 'PP-01', isPanel: true, roomId: 'r2', rackId: 'k2', inDesign: true, ports: [] },
  ],
  connections: [
    { id: 'c1', source: { deviceId: 'd1', portId: 'Te1/1/1' }, dest: { deviceId: 'd2', portId: 'Te1/1/1' }, media: 'os2', speed: '10G', cableId: 'C-BE-1', status: 'approved', hops: [], segments: [{ index: 0, kind: 'direct', from: { deviceId: 'd1', portId: 'Te1/1/1' }, to: { deviceId: 'd2', portId: 'Te1/1/1' }, cableId: 'C-BE-1', effectiveM: 50 }] },
    {
      id: 'c2',
      source: { deviceId: 'd2', portId: 'Gi1/0/1' },
      dest: { deviceId: 'a1', portId: 'Eth0' },
      media: 'cat6a',
      speed: '1G',
      cableId: 'C-EA-1',
      status: 'approved',
      hops: [{ patchPanelId: 'p1', inPort: '01', outPort: '02' }],
      segments: [
        { index: 0, kind: 'patch_cord', from: { deviceId: 'd2', portId: 'Gi1/0/1' }, to: { deviceId: 'p1', portId: '01' }, cableId: 'C-EA-1', effectiveM: 1 },
        { index: 1, kind: 'patch_cord', from: { deviceId: 'p1', portId: '02' }, to: { deviceId: 'a1', portId: 'Eth0' }, cableId: 'C-EA-1b', effectiveM: 15 },
      ],
    },
  ],
  versions: [{ number: 2, label: 'LLD v2', frozen: true }],
}
export const hld = { floors, rooms, racks: lld.racks, devices: lld.devices.filter((d) => !d.isPanel), connections: lld.connections, design: { preset: 'M' }, status: 'approved', version: { number: 1, createdAt: '2026-09-01T00:00:00Z' }, approvals: [{ status: 'approved', submittedBy: 'Ada', decision: { value: 'approved', decidedBy: 'Owner', decidedAt: '2026-09-02T00:00:00Z' } }] }

export const exceptions = [{ id: 'e1', deviceId: 'd2', deviceName: 'E-SW-01', label: 'RU', field: 'ru', designedValue: '40', installedValue: '30', reason: 'Old router in RU 40', status: 'accepted', reviewedBy: 'Rita', reviewNote: null }]
export const deployment = {
  pipeline: { devices: { planned: 4, installed: 2, tested: 1, accepted: 1, remaining: 2 }, connections: { planned: 2, installed: 1, tested: 1, faulty: 0, remaining: 1 }, progress: 25 },
  devices: [
    { id: 'd2', hostname: 'E-SW-01', status: 'accepted', statusLabel: 'Accepted', installation: { serial: 'FOC123', mac: '70:b3:17:55:2a:01', rackCode: 'R01', ru: 30, face: 'front', technician: 'Fiona', installedAt: '2026-10-10T09:00:00Z' }, deviations: [{ field: 'ru', label: 'RU', designedValue: '40', installedValue: '30', handled: true }] },
    { id: 'd1', hostname: 'B-SW-01', status: 'installed', statusLabel: 'Installed', installation: { serial: 'FOC999', mac: null, rackCode: 'R01', ru: 40, face: 'front', technician: 'Fiona', installedAt: '2026-10-11T09:00:00Z' }, deviations: [] },
  ],
  connections: [{ id: 'c2', source: { name: 'E-SW-01', portId: 'Gi1/0/1' }, dest: { name: 'A-AP-01', portId: 'Eth0' }, statusLabel: 'Tested', status: 'tested', test: { result: 'pass', by: 'Fiona' }, segments: [{ cableId: 'C-EA-1', installed: { cableId: 'C-EA-1', installedM: 1.2 } }], deviations: [{ field: 'length:1', label: 'Length (cable 2)', designedValue: '15 m', installedValue: '22 m', handled: false }] }],
  exceptions,
}
export const cmdb = {
  records: [{ id: 'd2', hostname: 'E-SW-01', role: 'edge', roleLabel: 'Edge', model: 'C9300-48UX', vendor: 'Cisco', serial: 'FOC123', mac: '70:b3:17:55:2a:01', roomCode: 'TR-EG-02', rackCode: 'R01', ru: 30, face: 'front', status: 'accepted', statusLabel: 'Accepted', assetTag: 'INV-1', lifecycle: { warrantyEnd: '2031-10-01' }, dguv: { status: 'valid', label: 'Valid' }, provenance: { serial: { source: 'deployment' } }, acceptedAt: '2026-10-12T00:00:00Z' }],
  connections: [],
  cableMatrix: [{ device: 'E-SW-01', port: 'Gi1/0/1', toDevice: 'A-AP-01', toPort: 'Eth0', cableIds: ['C-EA-1'], testResult: 'pass' }],
  retiredRecords: [],
}
export const bom = {
  currency: 'EUR',
  lines: [
    { key: 'device:d1', lineType: 'serialised', category: 'Network devices', item: 'C9500', spec: 'B-SW-01', qty: 1, unit: 'Each', source: 'HLD', unitPriceMinor: 1000000, lineTotalMinor: 1000000, procurement: { status: 'delivered' } },
    { key: 'cable:os2:50', lineType: 'consumable', category: 'Cables', item: 'OS2 cable', spec: '50 m', qty: 1, unit: 'Each', source: 'LLD', unitPriceMinor: 5000, lineTotalMinor: 5000, procurement: { status: 'ordered' } },
  ],
  procurement: { bomApproved: true, approvedVersionNumber: 1 },
}
