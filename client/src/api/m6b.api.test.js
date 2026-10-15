import { describe, it, expect, vi, afterEach } from 'vitest'
import { humanSize, isDone, FORMAT_LABEL } from './documentsApi.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./documentsApi.js')
}

describe('M6b documents and handover API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { documentsApi, handoverApi } = await import('./documentsApi.js')
    expect(await documentsApi.list('o', 'p', { buildingId: 'b' })).toEqual({ documents: [], types: [] })
    expect(await documentsApi.request('o', 'p', { typeKey: 'hld-document', format: 'pdf' })).toBeNull()
    expect(await handoverApi.view('o', 'p', 'b')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes: generation, download links, handover steps, logos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { documentsApi, handoverApi } = await loadReal()
    await documentsApi.request('o', 'p', { buildingId: 'b', typeKey: 'solution-package', format: 'docx', options: { prices: 'sell' } })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/documents')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ typeKey: 'solution-package', format: 'docx', options: { prices: 'sell' } })
    await documentsApi.list('o', 'p', { buildingId: 'b', typeKey: 'cable-labels' })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/o/projects/p/documents?buildingId=b&typeKey=cable-labels')
    expect(documentsApi.downloadUrl('o', 'p', 'd1')).toBe('/api/v1/orgs/o/projects/p/documents/d1/download')
    await handoverApi.deliver('o', 'p', 'b', { password: 'Handover-1', expiryDays: 10 })
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/orgs/o/projects/p/handover/buildings/b/deliver')
    expect(fetch.mock.calls[2][1].method).toBe('POST')
    await documentsApi.setOrgLogo('o', 'data:image/png;base64,AA==')
    expect(fetch.mock.calls[3][0]).toBe('/api/v1/orgs/o/settings/logo')
    expect(fetch.mock.calls[3][1].method).toBe('PUT')
    await documentsApi.locate('o', 'p', 'c1')
    expect(fetch.mock.calls[4][0]).toBe('/api/v1/orgs/o/projects/p/connections/c1/locate')
  })

  it('a public download posts the password (never in the URL) and reports a refusal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect password' } }) })
    vi.stubGlobal('fetch', fetchMock)
    const { publicDownload } = await loadReal()
    await expect(publicDownload('tok_123', 'd1', 'secret', 'x.pdf')).rejects.toThrow('Incorrect password')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/public/share-links/tok_123/documents/d1')
    expect(fetchMock.mock.calls[0][0]).not.toContain('secret')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: 'secret' })
  })

  it('helpers', () => {
    expect(humanSize(1536)).toBe('2 KB')
    expect(humanSize(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(humanSize(null)).toBe('')
    expect(isDone({ status: 'failed' })).toBe(true)
    expect(isDone({ status: 'generating' })).toBe(false)
    expect(FORMAT_LABEL.docx).toBe('Word')
  })
})
