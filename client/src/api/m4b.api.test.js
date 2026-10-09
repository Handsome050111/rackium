import { describe, it, expect, vi, afterEach } from 'vitest'
import { portMapOf, portChoices, isPortFree, toLldContext, fieldChangeText } from './lldApi.js'
import { buildCableScheduleSheet } from '../lib/lldExport.js'
import { parseLengthList, tableFromTexts } from '../lib/stockLengths.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) })

async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return (await import('./lldApi.js')).lldApi
}

describe('M4b LLD API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { lldApi } = await import('./lldApi.js')
    expect(await lldApi.view('o', 'p', 'b')).toBeNull()
    expect(await lldApi.validate('o', 'p', 'b')).toMatchObject({ findings: [] })
    expect(await lldApi.renamePreview('o', 'p', {})).toEqual({ rows: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('branch reads carry the branch; diffs encode their refs; deletes send the revision as a query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const lldApi = await loadReal()
    await lldApi.view('o', 'p', 'b', 'br1')
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/lld/buildings/b?branchId=br1')
    await lldApi.diff('o', 'p', { buildingId: 'b', from: 'v1', to: 'current:br1' })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/o/projects/p/lld/versions/diff?buildingId=b&from=v1&to=current%3Abr1')
    await lldApi.deleteConnection('o', 'p', 'c1', 7)
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/orgs/o/projects/p/lld/connections/c1?baseRevision=7')
    expect(fetch.mock.calls[2][1].method).toBe('DELETE')
    await lldApi.place('o', 'p', 'd1', { rackId: 'r', ru: 4, face: 'front', baseRevision: 2 })
    expect(fetch.mock.calls[3][1].method).toBe('PUT')
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ rackId: 'r', ru: 4, face: 'front', baseRevision: 2 })
  })

  it('a double booking surfaces the server code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(409, { code: 'port_in_use', message: 'Gi1/0/1 on E-1 is already used by another connection' })))
    const lldApi = await loadReal()
    await expect(lldApi.updateConnection('o', 'p', 'c1', { baseRevision: 1 })).rejects.toMatchObject({ code: 'port_in_use', status: 409 })
  })
})

const edge = {
  id: 'e',
  label: 'E-1',
  isPanel: false,
  ports: [
    ...Array.from({ length: 48 }, (_, i) => ({ id: `Gi1/0/${i + 1}`, n: i + 1, type: 'RJ45', role: 'access' })),
    { id: 'Te1/1/1', n: 1, type: 'SFP+', role: 'module' },
    { id: 'Te1/1/2', n: 2, type: 'SFP+', role: 'module' },
  ],
  occupied: [
    { portKey: 'gi1/0/1', connectionId: 'c1' },
    { portKey: 'te1/1/1', connectionId: 'c2' },
  ],
}
const panel = { id: 'p', label: 'PP-01', isPanel: true, ports: [1, 2, 3].map((n) => ({ id: `0${n}`, n, type: 'RJ45', role: 'access' })), occupied: [{ portKey: '01#rear', connectionId: 'c1' }] }

describe('Rackium Editor helpers', () => {
  it('port maps keep module ports apart and zig-zag many access ports', () => {
    const map = portMapOf(edge)
    expect(map.rows).toHaveLength(2)
    expect(map.rows[0][0].id).toBe('Gi1/0/1')
    expect(map.rows[1][0].id).toBe('Gi1/0/2')
    expect(map.modulePorts.map((p) => p.id)).toEqual(['Te1/1/1', 'Te1/1/2'])
    expect(portMapOf(panel).rows).toEqual([panel.ports.map((p) => ({ id: p.id, label: p.id, n: p.n, type: 'RJ45' }))])
  })

  it('suggests the first free compatible port; never counts the connection being edited as a clash', () => {
    expect(portChoices(edge, { media: 'cat6a' }).suggestion).toBe('Gi1/0/2')
    expect(portChoices(edge, { media: 'os2' }).suggestion).toBe('Te1/1/2')
    expect(portChoices(edge, { media: 'os2', exceptConnectionId: 'c2' }).suggestion).toBe('Te1/1/1')
    expect(portChoices(null, { media: 'os2' })).toEqual({ options: [], suggestion: null })
  })

  it('a patch panel has a rear and a front per port; a cable end lands on the front', () => {
    expect(portChoices(panel, { media: 'cat6a', side: 'rear' }).suggestion).toBe('02')
    expect(portChoices(panel, { media: 'cat6a', side: 'front' }).suggestion).toBe('01')
    expect(portChoices(panel, { media: 'cat6a' }).suggestion).toBe('01')
    expect(isPortFree(panel, '01', 'rear')).toBe(false)
    expect(isPortFree(panel, '01')).toBe(true)
    expect(isPortFree(panel, '01', 'rear', 'c1')).toBe(true)
  })
})

describe('LLD view → prototype tab context', () => {
  const view = {
    floors: [{ id: 'f', name: 'Floor EG' }],
    rooms: [{ id: 'r1', floorId: 'f', code: 'TR-EG-01' }],
    racks: [{ id: 'k1', roomId: 'r1', code: 'R01', heightU: 42, placements: [], freeRuByFace: { front: { availableRU: 42, contiguousFreeRU: 42 }, rear: { availableRU: 42, contiguousFreeRU: 42 } } }],
    devices: [
      { ...edge, role: 'edge', hostname: 'E-1', model: 'C9300', inDesign: true, rackId: 'k1', roomId: 'r1', ru: 40 },
      { ...panel, role: null, hostname: null, model: 'PP', inDesign: true, rackId: 'k1', roomId: 'r1', ru: 42 },
      { id: 'a', label: 'A-1', role: 'ap', hostname: 'A-1', inDesign: true, isPanel: false, roomId: 'r1', rackId: null, ru: null, ports: [{ id: 'Eth0', n: 0, type: 'RJ45', role: 'uplink' }], occupied: [] },
    ],
    connections: [
      {
        id: 'c1',
        source: { deviceId: 'e', portId: 'Gi1/0/1' },
        dest: { deviceId: 'a', portId: 'Eth0' },
        media: 'cat6a',
        speed: '1G',
        cableId: '26184735',
        hops: [{ seq: 1, patchPanelId: 'p', inPort: '01', outPort: '01', segmentCableId: 'S-1' }],
        lengths: { suggestedM: 5, engineerSelectedM: 7, effectiveM: 7, installedM: null },
        length: { lengthM: 4, lengthEstimated: false, estimateReason: null, placementPending: false, customLengthRequired: false },
      },
      { id: 'c2', source: { deviceId: 'e', portId: 'Te1/1/1' }, dest: { deviceId: 'a', portId: null }, media: 'os2', speed: '10G', cableId: null, hops: [], lengths: { suggestedM: null, engineerSelectedM: null, effectiveM: null, installedM: null }, length: { lengthM: null, lengthEstimated: true, estimateReason: 'No pathway recorded between these rooms', placementPending: false, customLengthRequired: false } },
    ],
    hld: { state: 'approved', latestApprovedNumber: 2, basedOnNumber: 1, changed: true },
  }

  it('builds cable rows (hops, lengths, estimated), port schedule and baseline the prototype tabs expect', () => {
    const ctx = toLldContext(view, { findings: [{ objectType: 'connection', objectId: 'c2', severity: 'critical', rule: 'L-CABLE-ID' }], summary: { critical: 1 } })
    const [c1, c2] = ctx.rows
    expect(c1).toMatchObject({ cableId: '26184735', mediaLabel: 'Cat6A', statusLabel: 'Designed', length: { suggested: 5, engineerSelected: 7, effective: 7, estimated: false } })
    expect(c1.hops[0].label).toBe('PP-01 01→01')
    expect(c1.source.entity).toMatchObject({ rackCode: 'R01', roomCode: 'TR-EG-01', floorName: 'Floor EG' })
    expect(c2).toMatchObject({ statusLabel: 'Cable ID pending', length: { estimated: true, estimateReason: 'No pathway recorded between these rooms' } })
    expect(ctx.checks).toEqual({ portConflicts: 0, duplicateCableIds: 0, missingCableIds: 1 })
    expect(ctx.hld).toMatchObject({ basedOnVersion: 1, currentVersion: 2, stale: true })
    expect(ctx.topology.connectionFindings).toEqual({ c2: { blocked: true, warning: false } })
    // Port schedule: the Edge only (no APs, no panels), Gi1/0/1 designed with its Cable ID.
    expect(ctx.portSchedule.map((e) => e.device.id)).toEqual(['e'])
    const access = ctx.portSchedule[0].groups.find((g) => g.id === 'access')
    expect(access.rows[0]).toMatchObject({ port: 'Gi1/0/1', status: 'Designed', cableId: '26184735' })
    expect(ctx.entityById.p.type).toBe('patchpanel')
  })

  it('the Cable Schedule export has Cable ID as its first column', () => {
    const sheet = buildCableScheduleSheet(toLldContext(view).rows)
    expect(sheet[0][0]).toBe('Cable ID')
    expect(sheet[1][0]).toBe('26184735')
    expect(sheet[1][3]).toBe('PP-01 01→01')
  })

  it('diff field changes read as before → after', () => {
    expect(fieldChangeText({ field: 'ru', before: null, after: 12 })).toBe('ru: — → 12')
  })
})

describe('Stock-length settings', () => {
  it('parses ascending positive lists; refuses anything else', () => {
    expect(parseLengthList('1, 2,3 ')).toEqual([1, 2, 3])
    expect(parseLengthList('0.5 1')).toEqual([0.5, 1])
    expect(parseLengthList('3, 2')).toBeNull()
    expect(parseLengthList('1, x')).toBeNull()
    expect(parseLengthList('')).toBeNull()
  })

  it('builds the whole table, or names the bad row', () => {
    const texts = { 'cat6a.same-rack': '1, 2', 'cat6a.same-room': '3', 'cat6a.cross-room': '5', os2: '5, 10', om4: '5', dac: '1', stack: '0.5' }
    expect(tableFromTexts(texts).table).toEqual({ cat6a: { 'same-rack': [1, 2], 'same-room': [3], 'cross-room': [5] }, os2: [5, 10], om4: [5], dac: [1], stack: [0.5] })
    expect(tableFromTexts({ ...texts, om4: '5, 4' }).error).toMatch(/^OM4 multimode/)
  })
})
