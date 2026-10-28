import { describe, it, expect, vi, afterEach } from 'vitest'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

// M7b-3 (DATA-MODEL §5.20): the HLD design tools' calls.
describe('M7b-3 HLD tool calls', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('each tool POSTs its own endpoint with the body and the revision', async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.resetModules()
    const { hldApi } = await import('./hldApi.js')
    const base = '/api/v1/orgs/o/projects/p/hld'
    await hldApi.breakUplink('o', 'p', 'u1', { reason: 'Moves', baseRevision: 3 })
    await hldApi.rerouteUplink('o', 'p', 'u1', { viaPatchPanel: true, viaRoomIds: ['r1'], baseRevision: 4 })
    await hldApi.replaceEndpoint('o', 'p', 'u1', { end: 'dest', deviceId: 'd2', keepCableId: true, baseRevision: 5 })
    await hldApi.splitUplink('o', 'p', 'u1', { newDevice: { role: 'distribution', roomId: 'r1' }, baseRevision: 6 })
    await hldApi.mergeAt('o', 'p', 'd9', { baseRevision: 7 })
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method, JSON.parse(init.body)])).toEqual([
      [`${base}/uplinks/u1/break`, 'POST', { reason: 'Moves', baseRevision: 3 }],
      [`${base}/uplinks/u1/reroute`, 'POST', { viaPatchPanel: true, viaRoomIds: ['r1'], baseRevision: 4 }],
      [`${base}/uplinks/u1/replace-endpoint`, 'POST', { end: 'dest', deviceId: 'd2', keepCableId: true, baseRevision: 5 }],
      [`${base}/uplinks/u1/split`, 'POST', { newDevice: { role: 'distribution', roomId: 'r1' }, baseRevision: 6 }],
      [`${base}/devices/d9/merge`, 'POST', { baseRevision: 7 }],
    ])
  })
})
