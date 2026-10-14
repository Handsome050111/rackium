import { describe, it, expect, vi, afterEach } from 'vitest'
import { installationDraft, installationBody, patchingDraft, patchingBody, cmdbRows, filterRecords } from './deploymentApi.js'
import { portRows } from '../components/realCmdb/portRows.js'
import { buildCmdbSheet } from '../lib/cmdbExport.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./deploymentApi.js')
}

describe('M6a deployment and CMDB API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { deploymentApi, cmdbApi } = await import('./deploymentApi.js')
    expect(await deploymentApi.view('o', 'p', 'b')).toBeNull()
    expect(await deploymentApi.saveInstallation('o', 'p', 'd', { serial: 'X' })).toBeNull()
    expect(await cmdbApi.view('o', 'p', 'b')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { deploymentApi, cmdbApi } = await loadReal()
    await deploymentApi.saveInstallation('o', 'p', 'd1', { serial: 'FOX1', markInstalled: true })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/deployment/devices/d1/installation')
    expect(fetch.mock.calls[0][1].method).toBe('PUT')
    await deploymentApi.testConnection('o', 'p', 'c1', { result: 'pass' })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/o/projects/p/deployment/connections/c1/test')
    await deploymentApi.reviewException('o', 'p', 'e1', { decision: 'rejected', note: 'Move it' })
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/orgs/o/projects/p/deployment/exceptions/e1/review')
    await cmdbApi.edit('o', 'p', 'd1', { assetTag: 'A', version: 3 })
    expect(fetch.mock.calls[3][1].method).toBe('PATCH')
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ assetTag: 'A', version: 3 })
    await cmdbApi.importLifecycle('o', 'p', { buildingId: 'b', rows: [{ Serial: 'X' }], apply: false })
    expect(fetch.mock.calls[4][0]).toBe('/api/v1/orgs/o/projects/p/cmdb/lifecycle-import')
  })
})

describe('installation and patching forms', () => {
  const device = { rackId: 'k1', ru: 40, face: 'front', installation: { serial: null, mac: null, rackId: null, ru: null } }
  it('start from the design, send nulls for empty text and a numeric RU', () => {
    const draft = installationDraft(device)
    expect(draft).toEqual({ serial: '', mac: '', rackId: 'k1', ru: 40, face: 'front', pduOutlet: '', notes: '' })
    expect(installationBody({ ...draft, serial: ' FOX1 ', ru: '38' }, { placed: true })).toEqual({ serial: 'FOX1', mac: null, rackId: 'k1', ru: 38, face: 'front', pduOutlet: null, notes: null })
    // An unplaced device (an AP) sends no placement.
    expect(installationBody(draft, { placed: false })).not.toHaveProperty('rackId')
  })
  it('patching starts from the recorded values, else the design', () => {
    const conn = { source: { portId: 'Gi1/0/1' }, dest: { portId: 'Eth0' }, installed: null, segments: [{ index: 0, cableId: 'C-1', installed: null }, { index: 1, cableId: 'C-2', installed: { cableId: 'C-2x', installedM: 4, confirmed: true } }] }
    const draft = patchingDraft(conn)
    expect(draft.segments).toEqual([
      { index: 0, cableId: 'C-1', installedM: '', confirmed: false },
      { index: 1, cableId: 'C-2x', installedM: 4, confirmed: true },
    ])
    expect(patchingBody({ ...draft, segments: [{ ...draft.segments[0], installedM: '2.5', confirmed: true }, draft.segments[1]] }, { confirm: true })).toEqual({
      sourcePort: 'Gi1/0/1',
      destPort: 'Eth0',
      segments: [
        { index: 0, cableId: 'C-1', installedM: 2.5, confirmed: true },
        { index: 1, cableId: 'C-2x', installedM: 4, confirmed: true },
      ],
      confirm: true,
    })
  })
})

describe('CMDB inventory', () => {
  const records = [
    { id: 'a', hostname: 'B001-SW-01', serial: 'FOX1', mac: '00:11:22:33:44:55', status: 'accepted', statusLabel: 'Accepted', roomCode: 'R1', roleLabel: 'Edge', acceptedAt: '2026-10-14T08:00:00Z', acceptedBy: 'Rita', dguv: { status: 'valid', label: 'Valid' } },
    { id: 'b', hostname: 'B001-AP-01', serial: 'Q2X', mac: null, status: 'maintenance', statusLabel: 'Maintenance', roomCode: 'R2', roleLabel: 'AP', acceptedAt: null, dguv: null },
  ]
  const connections = [{ id: 'c', source: { deviceId: 'a', portId: 'Gi1/0/1', name: 'B001-SW-01' }, dest: { deviceId: 'b', portId: 'Eth0', name: 'B001-AP-01' }, hops: [{ name: 'PP-01', inPort: '01', outPort: '02' }], segments: [{ cableId: 'C-77' }], media: 'cat6a', testResult: 'pass' }]
  it('search by hostname, serial, MAC or cable ID; filter by status and room', () => {
    expect(filterRecords(records, connections, { q: 'c-77' }).map((r) => r.id)).toEqual(['a', 'b'])
    expect(filterRecords(records, connections, { q: '44:55' }).map((r) => r.id)).toEqual(['a'])
    expect(filterRecords(records, connections, { q: 'q2x' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRecords(records, connections, { status: 'maintenance' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRecords(records, connections, { roomCode: 'R1' }).map((r) => r.id)).toEqual(['a'])
  })
  it('Excel rows carry acceptance and DGUV', () => {
    const sheet = buildCmdbSheet(cmdbRows(records))
    expect(sheet[0]).toContain('Serial Number')
    expect(sheet[1]).toEqual(expect.arrayContaining(['B001-SW-01', 'FOX1', 'Accepted 2026-10-14 by Rita', 'Valid']))
    expect(sheet[2]).toEqual(expect.arrayContaining(['—', 'n/a']))
  })
  it('port list: patched ports first with the far end and the hops in their own direction', () => {
    const rows = portRows({ id: 'b', ports: [{ id: 'Eth0' }, { id: 'Eth1' }] }, connections)
    expect(rows.map((r) => [r.port, r.other?.name ?? 'free'])).toEqual([
      ['Eth0', 'B001-SW-01'],
      ['Eth1', 'free'],
    ])
    expect(rows[0].hops.map((h) => h.name)).toEqual(['PP-01'])
  })
})
