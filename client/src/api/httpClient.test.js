import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiRequest, ApiError } from './httpClient.js'

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('apiRequest', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed body and sends cookies', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { ok: true }))
    const out = await apiRequest('/health')
    expect(out).toEqual({ ok: true })
    expect(fetch.mock.calls[0][1].credentials).toBe('include')
  })

  it('sends a JSON body with the right content type', async () => {
    fetch.mockResolvedValue(jsonResponse(202, { message: 'ok' }))
    await apiRequest('/auth/signup', { method: 'POST', body: { email: 'a@b.co' } })
    const [, init] = fetch.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.co' })
  })

  it('returns null for 204', async () => {
    fetch.mockResolvedValue({ ok: true, status: 204, json: async () => null })
    expect(await apiRequest('/auth/logout', { method: 'POST' })).toBeNull()
  })

  it('turns the server error envelope into an ApiError with code and message', async () => {
    fetch.mockResolvedValue(jsonResponse(401, { error: { code: 'invalid_credentials', message: 'Email or password is not correct' } }))
    const err = await apiRequest('/auth/login', { method: 'POST', body: {} }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(401)
    expect(err.code).toBe('invalid_credentials')
    expect(err.message).toBe('Email or password is not correct')
  })

  it('reports a network failure as its own error code', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await apiRequest('/me').catch((e) => e)
    expect(err.code).toBe('network')
  })

  it('handles a non-JSON error body without crashing', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json') } })
    const err = await apiRequest('/me').catch((e) => e)
    expect(err.status).toBe(502)
    expect(err.code).toBe('unknown')
  })
})

describe('authApi in mock mode', () => {
  it('resolves the demo identity without any network call', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { authApi, DEMO_USER } = await import('./authApi.js')
    const out = await authApi.me()
    expect(out.user).toEqual(DEMO_USER)
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
