import { describe, it, expect, vi, afterEach } from 'vitest'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

// M7b-5 (DATA-MODEL §3.11): the custom validation rules' calls.
describe('M7b-5 rule calls', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('organisation and project rules each have their own path; a preview names its building', async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.resetModules()
    const { validationRulesApi: api } = await import('./validationRulesApi.js')
    const o = '/api/v1/orgs/o/validation-rules'
    const p = '/api/v1/orgs/o/projects/p/validation-rules'
    await api.organisation('o').list()
    await api.organisation('o').create({ name: 'A' })
    await api.organisation('o').update('r1', { name: 'B' })
    await api.organisation('o').setEnabled('r1', false)
    await api.organisation('o').remove('r1')
    await api.project('o', 'p').list()
    await api.project('o', 'p').create({ name: 'C' })
    await api.project('o', 'p').remove('r2')
    await api.preview('o', 'p', { buildingId: 'b', rule: { name: 'D' } })
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET', init?.body ? JSON.parse(init.body) : null])).toEqual([
      [o, 'GET', null],
      [o, 'POST', { name: 'A' }],
      [`${o}/r1`, 'PUT', { name: 'B' }],
      [`${o}/r1/enabled`, 'PATCH', { enabled: false }],
      [`${o}/r1`, 'DELETE', null],
      [p, 'GET', null],
      [p, 'POST', { name: 'C' }],
      [`${p}/r2`, 'DELETE', null],
      [`${p}/preview`, 'POST', { buildingId: 'b', rule: { name: 'D' } }],
    ])
  })
})
