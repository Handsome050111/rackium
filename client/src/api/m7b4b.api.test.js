import { describe, it, expect, vi, afterEach } from 'vitest'
import { filterRecords } from './deploymentApi.js'
import { buildCmdbSheet } from '../lib/cmdbExport.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

// M7b-4b (DATA-MODEL §5.22): after cutover, keeping old gear, the CMDB mode.
describe('M7b-4b calls and the CMDB', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('a removal POSTs on the device; keeping old gear PUTs the reason (null withdraws)', async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.resetModules()
    const { deploymentApi } = await import('./deploymentApi.js')
    const { handoverApi } = await import('./documentsApi.js')
    const p = '/api/v1/orgs/o/projects/p'
    await deploymentApi.removeAfterCutover('o', 'p', 'd1', { note: 'Cutover done' })
    await deploymentApi.removeAfterCutover('o', 'p', 'd2')
    await handoverApi.keepOldGear('o', 'p', 'b1', 'Spare')
    await handoverApi.keepOldGear('o', 'p', 'b1', null)
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      [`${p}/deployment/devices/d1/removal`, 'POST', { note: 'Cutover done' }],
      [`${p}/deployment/devices/d2/removal`, 'POST', {}],
      [`${p}/handover/buildings/b1/old-gear`, 'PUT', { reason: 'Spare' }],
      [`${p}/handover/buildings/b1/old-gear`, 'PUT', { reason: null }],
    ])
  })

  it('the CMDB filters by mode; its Excel export has the Mode column in the project’s words', () => {
    const records = [
      { id: 'a', hostname: 'E-1', modeState: 'future', modeLabel: 'To-Be' },
      { id: 'b', hostname: 'T-1', modeState: 'interim', modeLabel: 'Transition' },
    ]
    expect(filterRecords(records, [], { modeState: 'interim' }).map((r) => r.id)).toEqual(['b'])
    expect(filterRecords(records, [], {}).map((r) => r.id)).toEqual(['a', 'b'])
    const sheet = buildCmdbSheet(records)
    expect(sheet[0].slice(0, 3)).toEqual(['Hostname', 'Legacy hostname', 'Mode'])
    expect(sheet.slice(1).map((row) => row[2])).toEqual(['To-Be', 'Transition'])
  })
})
