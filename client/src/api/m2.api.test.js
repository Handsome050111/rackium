import { describe, it, expect, vi, afterEach } from 'vitest'

async function loadRealApis() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  const [projects, hierarchy, blockers, dashboard, viewAs] = await Promise.all([
    import('./projectsApi.js'),
    import('./hierarchyApi.js'),
    import('./blockersApi.js'),
    import('./dashboardApi.js'),
    import('./viewAsApi.js'),
  ])
  return { projectsApi: projects.projectsApi, hierarchyApi: hierarchy.hierarchyApi, blockersApi: blockers.blockersApi, dashboardApi: dashboard.dashboardApi, viewAsApi: viewAs.viewAsApi }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

describe('M2 API modules in real mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('projectsApi.create posts the wizard payload to /orgs/:orgId/projects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ project: { id: 'p1' } })))
    const { projectsApi } = await loadRealApis()
    await projectsApi.create('org1', { name: 'LANspire', activePhaseKeys: ['cmo'] })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'LANspire', activePhaseKeys: ['cmo'] })
  })

  it('projectsApi.update patches /orgs/:orgId/projects/:projectId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ project: null })))
    const { projectsApi } = await loadRealApis()
    await projectsApi.update('org1', 'p1', { status: 'archived' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1')
    expect(init.method).toBe('PATCH')
  })

  it('hierarchyApi.buildings.create posts to the hierarchy sub-path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ buildings: null })))
    const { hierarchyApi } = await loadRealApis()
    await hierarchyApi.buildings.create('org1', 'p1', { campusId: 'c1', code: 'B001', name: 'Building B001' })
    const [url] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1/hierarchy/buildings')
  })

  it('hierarchyApi.import posts rows to the import endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ imported: {} })))
    const { hierarchyApi } = await loadRealApis()
    await hierarchyApi.import('org1', 'p1', [{ countryCode: 'DE' }])
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1/hierarchy/import')
    expect(JSON.parse(init.body)).toEqual({ rows: [{ countryCode: 'DE' }] })
  })

  it('blockersApi.raise and .update hit the blockers routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ blocker: null })))
    const { blockersApi } = await loadRealApis()
    await blockersApi.raise('org1', 'p1', { buildingId: 'b1', phaseKey: 'survey', description: 'x' })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/org1/projects/p1/blockers')
    await blockersApi.update('org1', 'p1', 'bk1', { status: 'resolved' })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/org1/projects/p1/blockers/bk1')
  })

  it('dashboardApi.getBuildingDashboard reads the building dashboard route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { dashboardApi } = await loadRealApis()
    await dashboardApi.getBuildingDashboard('org1', 'p1', 'b1')
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/org1/projects/p1/dashboard/buildings/b1')
  })

  it('viewAsApi.start and .end hit the view-as routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ session: { id: 's1', viewedRole: 'viewer' } })))
    const { viewAsApi } = await loadRealApis()
    await viewAsApi.start('org1', 'p1', 'viewer')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1/view-as')
    expect(JSON.parse(init.body)).toEqual({ projectId: 'p1', role: 'viewer' })

    await viewAsApi.end('org1', 'p1', 's1')
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/org1/projects/p1/view-as/s1/end')
  })
})

describe('M2 API modules in mock mode make no network calls', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('every module resolves without fetch', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    const { projectsApi } = await import('./projectsApi.js')
    const { hierarchyApi } = await import('./hierarchyApi.js')
    const { blockersApi } = await import('./blockersApi.js')
    const { dashboardApi } = await import('./dashboardApi.js')
    const { viewAsApi } = await import('./viewAsApi.js')

    await projectsApi.list('org1')
    await hierarchyApi.tree('org1', 'p1')
    await blockersApi.listForBuilding('org1', 'p1', 'b1')
    await dashboardApi.getBuildingDashboard('org1', 'p1', 'b1')
    await viewAsApi.start('org1', 'p1', 'viewer')

    expect(fetch).not.toHaveBeenCalled()
  })
})
