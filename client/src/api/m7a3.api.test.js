import { describe, it, expect, vi, afterEach } from 'vitest'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./insightsApi.js')
}

describe('M7a-3 dashboards, workload, analytics and report schedules API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { insightsApi, reportSchedulesApi } = await import('./insightsApi.js')
    expect(await insightsApi.project('o', 'p')).toBeNull()
    expect(await insightsApi.organisation('o')).toBeNull()
    expect(await reportSchedulesApi.list('o', 'p')).toEqual({ schedules: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes; a schedule names its recipients by id; the View-As header only inside the viewed project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { insightsApi, reportSchedulesApi } = await loadReal()
    const viewAs = await import('../lib/viewAsSession.js')
    await insightsApi.project('o', 'p')
    await insightsApi.rollup('o', 'p')
    await insightsApi.organisation('o')
    await insightsApi.workload('o', 'p')
    await insightsApi.analytics('o', 'p')
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['/api/v1/orgs/o/projects/p/dashboard', '/api/v1/orgs/o/projects/p/dashboard/rollup', '/api/v1/orgs/o/dashboard', '/api/v1/orgs/o/projects/p/workload', '/api/v1/orgs/o/projects/p/analytics'])
    await reportSchedulesApi.create('o', 'p', { typeKey: 'weekly-status', format: 'pdf', frequency: 'weekly', weekday: 1, recipientIds: ['u1'] })
    expect(fetch.mock.calls[5][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ typeKey: 'weekly-status', format: 'pdf', frequency: 'weekly', weekday: 1, recipientIds: ['u1'] }) })
    await reportSchedulesApi.update('o', 'p', 's1', { paused: true })
    expect(fetch.mock.calls[6]).toEqual(['/api/v1/orgs/o/projects/p/report-schedules/s1', expect.objectContaining({ method: 'PATCH' })])
    viewAs.setViewAsSession({ id: 'v1', projectId: 'p', viewedRole: 'viewer' })
    await insightsApi.project('o', 'p')
    expect(fetch.mock.calls[7][1].headers['X-View-As-Session']).toBe('v1')
    await insightsApi.organisation('o')
    expect(fetch.mock.calls[8][1].headers['X-View-As-Session']).toBeUndefined()
    viewAs.setViewAsSession(null)
  })
})
