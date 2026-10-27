import { describe, it, expect } from 'vitest'
import { toLldContext } from './lldApi.js'
import { buildCmdbSheet } from '../lib/cmdbExport.js'
import { cmdbRows } from './deploymentApi.js'

// M7b-2 (addendum v2.3 Q5; DATA-MODEL §5.19): a device renamed through a
// change request reads "old → new" on the LLD screens; the CMDB Excel export
// has its old name in a column of its own.
describe('M7b-2 client pieces', () => {
  const ports = (ids, type) => ids.map((id, n) => ({ id, n, type, role: 'access' }))
  const view = {
    floors: [{ id: 'f', name: 'Floor EG' }],
    rooms: [{ id: 'r1', floorId: 'f', code: 'TR-EG-01' }],
    racks: [{ id: 'k1', roomId: 'r1', code: 'R01', heightU: 42, placements: [], freeRuByFace: { front: { availableRU: 42 }, rear: { availableRU: 42 } } }],
    devices: [
      // As the server sends them: label already "old → new", name the current one.
      { id: 'e', label: 'E-0 → E-1', name: 'E-1', hostname: 'E-1', legacyHostname: 'E-0', role: 'edge', inDesign: true, isPanel: false, rackId: 'k1', roomId: 'r1', ru: 10, ports: ports(['Gi1/0/1'], 'RJ45'), occupied: [] },
      { id: 'p', label: 'PP-00 → PP-01', name: 'PP-01', hostname: null, legacyHostname: 'PP-00', role: null, inDesign: true, isPanel: true, rackId: 'k1', roomId: 'r1', ru: 40, ports: ports(['01', '02'], 'RJ45'), occupied: [] },
      { id: 'a', label: 'A-1', name: 'A-1', hostname: 'A-1', legacyHostname: null, role: 'ap', inDesign: true, isPanel: false, rackId: null, roomId: 'r1', ru: null, ports: ports(['Eth0'], 'RJ45'), occupied: [] },
    ],
    connections: [
      {
        id: 'c1',
        source: { deviceId: 'e', portId: 'Gi1/0/1' },
        dest: { deviceId: 'a', portId: 'Eth0' },
        media: 'cat6a',
        speed: '1G',
        cableId: 'C-1',
        hops: [{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '02', segmentCableId: 'C-1b', lengths: { engineerSelectedM: null, installedM: null } }],
        lengths: { suggestedM: 2, engineerSelectedM: null, effectiveM: 2, installedM: null },
        length: { lengthM: null, lengthEstimated: false, estimateReason: null, placementPending: true, customLengthRequired: false },
        segments: [
          { index: 0, kind: 'patch_cord', from: { deviceId: 'e', portId: 'Gi1/0/1' }, to: { deviceId: 'p', portId: '01' }, cableId: 'C-1', situation: 'same-rack', lengthM: 1.85, suggestedM: 2, engineerSelectedM: null, effectiveM: 2, installedM: null, lengthEstimated: false, estimateReason: null, placementPending: false, customLengthRequired: false },
          { index: 1, kind: 'patch_cord', from: { deviceId: 'p', portId: '02' }, to: { deviceId: 'a', portId: 'Eth0' }, cableId: 'C-1b', situation: 'same-room', lengthM: null, suggestedM: null, engineerSelectedM: null, effectiveM: 3, installedM: null, lengthEstimated: false, estimateReason: null, placementPending: true, customLengthRequired: false },
        ],
      },
    ],
    hld: { state: 'approved', latestApprovedNumber: 1, basedOnNumber: 1, changed: false },
  }

  it('the LLD screens name a renamed switch and panel "old → new" (the switch by hostname, the panel by its label)', () => {
    const ctx = toLldContext(view)
    expect(ctx.entityById.e.hostname).toBe('E-0 → E-1')
    expect(ctx.entityById.a.hostname).toBe('A-1')
    expect(ctx.rows[0].segments.map((s) => [s.from, s.to])).toEqual([
      ['E-0 → E-1 Gi1/0/1', 'PP-00 → PP-01 / Port 01'],
      ['PP-00 → PP-01 / Port 02', 'A-1 Eth0'],
    ])
  })

  it('the CMDB Excel export has a Legacy hostname column after Hostname', () => {
    const sheet = buildCmdbSheet(cmdbRows([{ id: 'e', hostname: 'E-1', legacyHostname: 'E-0', statusLabel: 'Accepted' }, { id: 'a', hostname: 'A-1', legacyHostname: null, statusLabel: 'Accepted' }]))
    expect(sheet[0].slice(0, 2)).toEqual(['Hostname', 'Legacy hostname'])
    expect(sheet.slice(1).map((r) => r.slice(0, 2))).toEqual([['E-1', 'E-0'], ['A-1', '']])
  })
})
