import { describe, it, expect, vi, afterEach } from 'vitest'
import { draftToUplinkBody, uplinkToDraft, libraryCategories, connectionStatus } from './hldApi.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) })

async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return (await import('./hldApi.js')).hldApi
}

describe('M4a HLD API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { hldApi } = await import('./hldApi.js')
    expect(await hldApi.library('o', 'p')).toEqual({ roles: [], optics: [], presets: [] })
    expect(await hldApi.validate('o', 'p', 'b')).toMatchObject({ findings: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('design writes carry the revision; deletes send it as a query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const hldApi = await loadReal()
    await hldApi.generate('o', 'p', { buildingId: 'b', preset: 'M', baseRevision: 3 })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/hld/generate')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ buildingId: 'b', preset: 'M', baseRevision: 3 })
    await hldApi.deleteUplink('o', 'p', 'u1', 4)
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/o/projects/p/hld/uplinks/u1?baseRevision=4')
    expect(fetch.mock.calls[1][1].method).toBe('DELETE')
    await hldApi.moveDevice('o', 'p', 'd1', { x: 1, y: 2 })
    expect(fetch.mock.calls[2][1].method).toBe('PUT')
  })

  it('a stale save surfaces the server code and who changed it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(409, { code: 'stale_revision', message: 'This HLD was changed by Alex since you loaded it', details: { revision: 5 } })))
    const hldApi = await loadReal()
    await expect(hldApi.updateUplink('o', 'p', 'u1', { baseRevision: 4 })).rejects.toMatchObject({ code: 'stale_revision', status: 409, details: { revision: 5 } })
  })
})

describe('HLD helpers', () => {
  it('the uplink wizard draft maps to the API body and back; copper and DAC carry no SFP', () => {
    const draft = { sourceDeviceId: 'a', sourcePort: '', destDeviceId: 'b', destPort: 'Te1/1/1', media: 'os2', speed: '10G', sourceSfp: 'Cisco SFP-10G-LR', destSfp: 'Cisco SFP-10G-LR', usePatchPanel: true }
    const body = draftToUplinkBody(draft)
    expect(body).toEqual({ source: { deviceId: 'a', portId: null }, dest: { deviceId: 'b', portId: 'Te1/1/1' }, media: 'os2', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-LR', viaPatchPanel: true })
    expect(draftToUplinkBody({ ...draft, media: 'cat6a' })).toMatchObject({ sourceSfpCode: null, destSfpCode: null })
    expect(uplinkToDraft({ ...body, id: 'u', sourceSfpCode: 'X', destSfpCode: 'Y' })).toMatchObject({ sourceDeviceId: 'a', destPort: 'Te1/1/1', sourceSfp: 'X', usePatchPanel: true })
  })

  it('every role is a library item with its hostname code; groups follow the catalogue', () => {
    const roles = [
      { role: 'edge', label: 'Edge', group: 'active_networking', icon: 'edge', code: 'E', defaultModel: 'Cisco C9300-48UX' },
      { role: 'firewall', label: 'Firewall', group: 'active_networking', icon: 'firewall', code: 'FW', defaultModel: 'Generic Firewall 1U' },
      { role: 'wan_circuit', label: 'WAN/SP connection', group: 'external', icon: 'wan-circuit', code: null, defaultModel: null },
    ]
    const cats = libraryCategories(roles)
    expect(cats.map((c) => c.key)).toEqual(['active_networking', 'external'])
    expect(cats[0].items.map((i) => i.label)).toEqual(['Edge (E)', 'Firewall (FW)'])
    expect(cats[1].items[0]).toMatchObject({ label: 'WAN/SP connection', role: 'wan_circuit' })
    expect(cats.flatMap((c) => c.items).some((i) => i.comingSoon)).toBe(false)
  })

  it('uplink status on the canvas: Critical blocks, Warning flags', () => {
    expect(connectionStatus([
      { objectType: 'connection', objectId: 'u1', severity: 'critical' },
      { objectType: 'connection', objectId: 'u2', severity: 'warning' },
      { objectType: 'device', objectId: 'd1', severity: 'critical' },
    ])).toEqual({ u1: { blocked: true, warning: false }, u2: { blocked: false, warning: true } })
  })
})
