import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// authApi reads VITE_API_MODE when it is imported, so each test re-imports it
// under the mode it needs.
async function loadRealApi() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./authApi.js')
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

describe('resend endpoints in real mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ message: 'ok', invitations: [], invitation: { id: 'x' } })))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('resendVerification posts the email to the verification resend route', async () => {
    const { authApi } = await loadRealApi()
    await authApi.resendVerification('ann@example.com')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/auth/verify-email/resend')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ email: 'ann@example.com' })
  })

  it('listInvitations reads the organisation\'s pending invitations', async () => {
    const { authApi } = await loadRealApi()
    await authApi.listInvitations('org123')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org123/invitations')
    expect(init.method).toBe('GET')
  })

  it('resendInvitation posts to the invitation\'s resend route', async () => {
    const { authApi } = await loadRealApi()
    await authApi.resendInvitation('org123', 'inv456')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/v1/orgs/org123/invitations/inv456/resend')
    expect(init.method).toBe('POST')
  })
})

describe('resend endpoints in mock mode', () => {
  it('make no network calls', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn())
    const { authApi } = await import('./authApi.js')
    await authApi.resendVerification('ann@example.com')
    await authApi.listInvitations('org123')
    await authApi.resendInvitation('org123', 'inv456')
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
})
