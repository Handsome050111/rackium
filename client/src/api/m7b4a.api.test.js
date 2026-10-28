import { describe, it, expect, vi, afterEach } from 'vitest'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

// M7b-4a (DATA-MODEL §5.21): mode states, CMO decisions and the state labels.
describe('M7b-4a calls', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('decisions PUT and DELETE on the CMO device (with the branch); labels GET and PATCH on the project', async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.resetModules()
    const { hldApi } = await import('./hldApi.js')
    const { deliveryApi } = await import('./deliveryApi.js')
    const p = '/api/v1/orgs/o/projects/p'
    await hldApi.setCmoDecision('o', 'p', 'd1', { decision: 'keep', role: 'edge', branchId: 'b1', baseRevision: 3 })
    await hldApi.clearCmoDecision('o', 'p', 'd1', { baseRevision: 4, branchId: 'b1' })
    await hldApi.clearCmoDecision('o', 'p', 'd1', { baseRevision: 5 })
    await deliveryApi.modeLabels('o', 'p')
    await deliveryApi.setModeLabels('o', 'p', { future: 'To-Be' })
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET', init?.body ? JSON.parse(init.body) : null])).toEqual([
      [`${p}/hld/devices/d1/cmo-decision`, 'PUT', { decision: 'keep', role: 'edge', branchId: 'b1', baseRevision: 3 }],
      [`${p}/hld/devices/d1/cmo-decision?baseRevision=4&branchId=b1`, 'DELETE', null],
      [`${p}/hld/devices/d1/cmo-decision?baseRevision=5`, 'DELETE', null],
      [`${p}/mode-labels`, 'GET', null],
      [`${p}/mode-labels`, 'PATCH', { modeLabels: { future: 'To-Be' } }],
    ])
  })

  it('an uplink draft carries its mode both ways; a draft without one leaves it to the server', async () => {
    const { draftToUplinkBody, uplinkToDraft } = await import('./hldApi.js')
    const conn = { source: { deviceId: 'a', portId: null }, dest: { deviceId: 'b', portId: null }, media: 'cat6a', speed: '1G', viaPatchPanel: false, modeState: 'interim' }
    expect(draftToUplinkBody(uplinkToDraft(conn)).modeState).toBe('interim')
    expect(draftToUplinkBody({ ...uplinkToDraft(conn), modeState: null })).not.toHaveProperty('modeState')
  })
})
