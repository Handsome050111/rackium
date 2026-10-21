import { describe, it, expect, vi, afterEach } from 'vitest'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./m7a2Api.js')
}

describe('M7a-2 search, DGUV and field help API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { searchApi, dguvApi, fieldHelpApi } = await import('./m7a2Api.js')
    expect(await searchApi.search('o', 'SW-1')).toEqual({ results: [] })
    expect(await dguvApi.view('o', 'p')).toBeNull()
    expect(await fieldHelpApi.list('o')).toEqual({ fields: [] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes: search with the current project (and the View-As header only inside the viewed project), DGUV nodes and CSV, field help text and photos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ results: [] })))
    const { searchApi, dguvApi, fieldHelpApi } = await loadReal()
    // The same module instance the API module now uses.
    const viewAs = await import('../lib/viewAsSession.js')
    await searchApi.search('o', '00:1a 2b', 'p1')
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/search?q=00%3A1a+2b&projectId=p1')
    expect(fetch.mock.calls[0][1].headers['X-View-As-Session']).toBeUndefined()
    viewAs.setViewAsSession({ id: 's1', projectId: 'p1', viewedRole: 'viewer' })
    await searchApi.search('o', 'B001', 'p1')
    expect(fetch.mock.calls[1][1].headers['X-View-As-Session']).toBe('s1')
    await searchApi.search('o', 'B001', 'p2')
    expect(fetch.mock.calls[2][1].headers['X-View-As-Session']).toBeUndefined()
    viewAs.setViewAsSession(null)
    await dguvApi.view('o', 'p', { level: 'building', id: 'b1' })
    expect(fetch.mock.calls[3][0]).toBe('/api/v1/orgs/o/projects/p/dguv?level=building&id=b1')
    expect(dguvApi.exportUrl('o', 'p', { level: 'rack', id: 'r1', status: 'overdue' })).toBe('/api/v1/orgs/o/projects/p/dguv/export.csv?level=rack&id=r1&status=overdue')
    await fieldHelpApi.update('o', 'survey:general:location_id', { meaning: 'x' })
    expect(fetch.mock.calls[4][0]).toBe('/api/v1/orgs/o/field-help/survey%3Ageneral%3Alocation_id')
    expect(fetch.mock.calls[4][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ meaning: 'x' }) })
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })
    await fieldHelpApi.addPhoto('o', 'survey:general:location_id', photo, 'Front')
    expect(fetch.mock.calls[5][0]).toBe('/api/v1/orgs/o/field-help/survey%3Ageneral%3Alocation_id/photos?caption=Front')
    expect(fetch.mock.calls[5][1].body).toBe(photo)
    expect(fetch.mock.calls[5][1].headers['Content-Type']).toBe('image/jpeg')
  })
})
