import { describe, it, expect, vi, afterEach } from 'vitest'
import { rolesFor, canIn, canCreateProjectsIn } from '../lib/realRoles.js'
import { ACTIONS } from '@rackium/shared/policy.js'

async function loadRealApis() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  const [catalogue, cmo] = await Promise.all([import('./catalogueApi.js'), import('./cmoApi.js')])
  return { catalogueApi: catalogue.catalogueApi, cmoApi: cmo.cmoApi, toCmoRows: cmo.toCmoRows }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

describe('M3a API modules in real mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('catalogueApi.list sends only the filters that are set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ items: [] })))
    const { catalogueApi } = await loadRealApis()
    await catalogueApi.list('org1', { q: '9300', group: '', category: '', poe: false, minPorts: '', projectId: 'p1' })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/org1/catalogue?q=9300&projectId=p1')
    await catalogueApi.list('org1', { poe: true })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/org1/catalogue?poe=true')
  })

  it('catalogueApi.replace patches the whole item; import posts rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ item: null })))
    const { catalogueApi } = await loadRealApis()
    await catalogueApi.replace('org1', 'i1', { model: 'X' })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/org1/catalogue/i1')
    expect(fetch.mock.calls[0][1].method).toBe('PATCH')
    await catalogueApi.import('org1', [{ model: 'X' }])
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/org1/catalogue/import')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ rows: [{ model: 'X' }] })
  })

  it('cmoApi sends only the mapped fields back, never the preview annotations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ summary: {} })))
    const { cmoApi } = await loadRealApis()
    const previewRow = { rowIndex: 3, serial: 'S1', building: 'B001', hostname: 'SW', errors: ['x'], warnings: [], valid: true, buildingId: 'b1', ruPosition: 4 }
    await cmoApi.commit('org1', 'p1', { rows: [previewRow], salId: 's1', fileName: 'cmo.xlsx' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1/cmo/import')
    expect(JSON.parse(init.body)).toEqual({
      rows: [{ rowIndex: 3, hostname: 'SW', model: null, serial: 'S1', mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }],
      salId: 's1',
      fileName: 'cmo.xlsx',
    })
  })

  it('organisationApi grants project creation and updates settings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.resetModules()
    const { organisationApi } = await import('./organisationApi.js')
    await organisationApi.setProjectCreation('org1', 'u1', true)
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/org1/members/u1/project-creation')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ allowed: true })
    await organisationApi.updateSettings('org1', { architectsSeePrices: true })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/org1/settings')
    expect(fetch.mock.calls[1][1].method).toBe('PATCH')
  })

  it('cmoApi.assign patches the device assignment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ device: {} })))
    const { cmoApi } = await loadRealApis()
    await cmoApi.assign('org1', 'p1', 'd1', 'b2')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org1/projects/p1/cmo/devices/d1/assignment')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ buildingId: 'b2' })
  })
})

describe('M3a API modules in mock mode', () => {
  it('make no network calls', async () => {
    vi.resetModules()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { catalogueApi } = await import('./catalogueApi.js')
    const { cmoApi } = await import('./cmoApi.js')
    await catalogueApi.list('org1')
    await cmoApi.context('org1', 'p1')
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('rolesFor (mirrors the server rolesIn)', () => {
  const memberships = [
    { level: 'organisation', role: 'org_admin', organisationId: 'o1', projectId: null },
    { level: 'project', role: 'architect', organisationId: 'o1', projectId: 'p1' },
    { level: 'project', role: 'pm', organisationId: 'o2', projectId: 'p9' },
  ]
  it('takes the organisation role plus the role in the given project only', () => {
    expect(rolesFor(memberships, 'o1')).toEqual(['org_admin'])
    expect(rolesFor(memberships, 'o1', 'p1')).toEqual(['org_admin', 'architect'])
    expect(rolesFor(memberships, 'o1', 'p9')).toEqual(['org_admin'])
    expect(rolesFor(memberships, 'o2', 'p9')).toEqual(['pm'])
  })
  it("a 'member' organisation row is not a role", () => {
    const rows = [
      { level: 'organisation', role: 'member', organisationId: 'o1', projectId: null, canCreateProjects: true },
      { level: 'project', role: 'viewer', organisationId: 'o1', projectId: 'p1' },
    ]
    expect(rolesFor(rows, 'o1', 'p1')).toEqual(['viewer'])
  })

  it('project creation comes from the organisation membership of that organisation only', () => {
    expect(canCreateProjectsIn(memberships, 'o1')).toBe(true) // Org Admin
    expect(canCreateProjectsIn([{ level: 'organisation', role: 'member', organisationId: 'o1', canCreateProjects: true }], 'o1')).toBe(true)
    expect(canCreateProjectsIn([{ level: 'organisation', role: 'member', organisationId: 'o1', canCreateProjects: false }], 'o1')).toBe(false)
    expect(canCreateProjectsIn([{ level: 'organisation', role: 'member', organisationId: 'o1', canCreateProjects: true }], 'o2')).toBe(false)
    expect(canCreateProjectsIn([{ level: 'project', role: 'pm', organisationId: 'o1', projectId: 'p1' }], 'o1')).toBe(false)
  })

  it('feeds can(): an architect cannot import CMO, a PM can and assigns', () => {
    expect(canIn([{ level: 'project', role: 'architect', organisationId: 'o1', projectId: 'p1' }], 'o1', 'p1', ACTIONS.IMPORT_CMO)).toBe(false)
    expect(canIn(memberships, 'o2', 'p9', ACTIONS.ASSIGN_CMO_DEVICE)).toBe(true)
    expect(canIn(memberships, 'o1', 'p1', ACTIONS.ASSIGN_CMO_DEVICE)).toBe(false)
  })
})
