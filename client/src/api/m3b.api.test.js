import { describe, it, expect, vi, afterEach } from 'vitest'
import { editsReadyToSync, toSyncBody, baseOf, EPOCH, describeResult, newObjectId, fileIdsOf } from '../lib/realOfflineQueue.js'
import { toPlacementBody, factPatch, stepperLinksFor, formatValue, toPanelValue, toApiValue } from '../lib/realSurveyModel.js'
import { fitWithin, jpegName } from '../lib/photoCompress.js'

async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  const [survey, files] = await Promise.all([import('./surveyApi.js'), import('./filesApi.js')])
  return { surveyApi: survey.surveyApi, filesApi: files.filesApi, uploadFile: files.uploadFile }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) })

describe('M3b API modules', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { surveyApi } = await import('./surveyApi.js')
    const { uploadFile } = await import('./filesApi.js')
    expect(await surveyApi.structure('o', 'p', 'b')).toEqual({ buildings: [], pathways: [], findings: [] })
    expect(await surveyApi.sync('o', 'p', [])).toEqual({ results: [] })
    expect(await uploadFile('o', 'p', new Blob(['x']), { fileId: 'f1' })).toEqual({ id: 'f1' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('survey records are addressed by building, room and tab; building tabs send no room', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ record: null })))
    const { surveyApi } = await loadReal()
    await surveyApi.record('o', 'p', { buildingId: 'b1', roomId: null, tab: 'Storage Area' })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/survey/records?buildingId=b1&tab=Storage+Area')
    await surveyApi.edit('o', 'p', { buildingId: 'b1', tab: 'WAN', op: { kind: 'addRow', sectionIndex: 0, rowId: 'r' }, baseLastModifiedAt: EPOCH })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ buildingId: 'b1', roomId: null, tab: 'WAN', op: { kind: 'addRow', sectionIndex: 0, rowId: 'r' }, baseLastModifiedAt: EPOCH })
    await surveyApi.transition('o', 'p', { buildingId: 'b1', roomId: 'r1', tab: 'Firewall', action: 'reject', reason: 'Retake' })
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ buildingId: 'b1', roomId: 'r1', tab: 'Firewall', action: 'reject', reason: 'Retake' })
  })

  it('uploads in chunks and resumes from what the server already has', async () => {
    const blob = new Blob([new Uint8Array(2.5 * 1024 * 1024)])
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ receivedBytes: 1024 * 1024, completed: false })) // start: 1 MiB already there
        .mockResolvedValueOnce(ok({ receivedBytes: 2 * 1024 * 1024 }))
        .mockResolvedValueOnce(ok({ receivedBytes: blob.size }))
        .mockResolvedValueOnce(ok({ file: { id: 'f1' } }))
    )
    const { uploadFile } = await loadReal()
    const progress = []
    const file = await uploadFile('o', 'p', blob, { fileId: 'f1', fileName: 'a.jpg', mimeType: 'image/jpeg', category: 'photo_reference', attachedTo: { type: 'room', id: 'r' } }, { sha256: 'h', onProgress: (n) => progress.push(n) })
    expect(file).toEqual({ id: 'f1' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ fileId: 'f1', sizeBytes: blob.size, sha256: 'h' })
    expect(fetch.mock.calls[1][0]).toBe(`/api/v1/orgs/o/projects/p/files/uploads/f1?offset=${1024 * 1024}`)
    expect(fetch.mock.calls[2][0]).toBe(`/api/v1/orgs/o/projects/p/files/uploads/f1?offset=${2 * 1024 * 1024}`)
    expect(fetch.mock.calls[3][0]).toBe('/api/v1/orgs/o/projects/p/files/uploads/f1/complete')
    expect(progress).toEqual([1024 * 1024, 2 * 1024 * 1024, blob.size])
  })

  it('an offset mismatch continues from the offset the server reports', async () => {
    const blob = new Blob([new Uint8Array(1500)])
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(ok({ receivedBytes: 0, completed: false }))
        .mockResolvedValueOnce(fail(409, { code: 'offset_mismatch', message: 'x', details: { receivedBytes: 1500 } }))
        .mockResolvedValueOnce(ok({ file: { id: 'f2' } }))
    )
    const { uploadFile } = await loadReal()
    expect(await uploadFile('o', 'p', blob, { fileId: 'f2' }, { sha256: 'h' })).toEqual({ id: 'f2' })
  })

  it('a completed upload is not sent again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ completed: true, file: { id: 'f3' } })))
    const { uploadFile } = await loadReal()
    expect(await uploadFile('o', 'p', new Blob(['abc']), { fileId: 'f3' }, { sha256: 'h' })).toEqual({ id: 'f3' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('file URLs are the authorised API routes, never public links', async () => {
    const { filesApi } = await loadReal()
    expect(filesApi.thumbnailUrl('o', 'p', 'f')).toBe('/api/v1/orgs/o/projects/p/files/f/thumbnail')
    expect(filesApi.contentUrl('o', 'p', 'f')).toBe('/api/v1/orgs/o/projects/p/files/f/content')
  })
})

describe('offline queue planning', () => {
  const edit = (opId, queuedAt, op = { kind: 'setField', value: 'x' }) => ({ opId, queuedAt, buildingId: 'b', roomId: null, tab: 'WAN', op, baseLastModifiedAt: EPOCH, description: opId })

  it('replays in queued order and holds edits back behind a photo still uploading', () => {
    const edits = [edit('c', '2026-01-01T00:00:03Z'), edit('a', '2026-01-01T00:00:01Z'), edit('b', '2026-01-01T00:00:02Z', { kind: 'setField', value: { fileIds: ['f1'] } })]
    expect(editsReadyToSync(edits, []).map((e) => e.opId)).toEqual(['a', 'b', 'c'])
    expect(editsReadyToSync(edits, ['f1']).map((e) => e.opId)).toEqual(['a'])
    expect(fileIdsOf(edits[2].op)).toEqual(['f1'])
  })

  it('sync bodies carry only what the server takes; a never-saved tab has the epoch as base', () => {
    expect(toSyncBody([{ ...edit('a', '2026-01-01T00:00:01Z'), projectKey: 'o/p' }])[0]).toEqual({ opId: 'a', queuedAt: '2026-01-01T00:00:01Z', buildingId: 'b', roomId: null, tab: 'WAN', op: { kind: 'setField', value: 'x' }, baseLastModifiedAt: EPOCH })
    expect(baseOf({ lastModifiedAt: null })).toBe(EPOCH)
    expect(baseOf({ lastModifiedAt: '2026-01-02T00:00:00Z' })).toBe('2026-01-02T00:00:00Z')
  })

  it('report lines name conflicts, skips and refusals', () => {
    const conflict = { changedBy: 'Alex', fields: [] }
    expect(describeResult({ outcome: 'conflict', conflict }, { description: 'WAN — x' })).toEqual({ kind: 'conflict', what: 'WAN — x', conflict })
    expect(describeResult({ outcome: 'skipped', reason: 'gone' }, null)).toEqual({ kind: 'skipped', what: 'Edit', reason: 'gone' })
    expect(describeResult({ outcome: 'rejected', reason: 'locked' }, null).kind).toBe('rejected')
    expect(describeResult({ outcome: 'applied', duplicate: true }, null).kind).toBe('applied')
  })

  it('object ids are 24 hex characters and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, newObjectId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{24}$/)
  })
})

describe('real survey helpers', () => {
  it('placements: only devices are sent; identity only when edited here, never for CMO devices', () => {
    const body = toPlacementBody([
      { id: 'd1', kind: 'device', ru: 40, heightU: 1, face: 'front', mounting: 'rack', label: 'SW', serial: 'S1' },
      { id: 'd2', deviceId: 'd2', kind: 'device', ru: 0, heightU: 0, face: 'rear', mounting: '0U', label: 'PDU', identityEdited: true, serial: 'P1', mac: '' },
      { id: 'd3', kind: 'device', ru: 30, heightU: 1, face: 'front', label: 'CMO', fromCmo: true, identityEdited: true, serial: 'X' },
      { id: 'ru-1', kind: 'reserved', ru: 10, heightU: 1, face: 'front', label: 'Reserved' },
    ])
    expect(body).toHaveLength(3)
    expect(body[0]).toEqual({ deviceId: 'd1', ru: 40, heightU: 1, face: 'front', fullDepth: false, mounting: 'rack', railSide: null, category: null, label: 'SW', sublabel: null })
    expect(body[1]).toMatchObject({ deviceId: 'd2', ru: 0, heightU: 0, railSide: 'left', serial: 'P1', mac: null })
    expect(body[2]).not.toHaveProperty('serial')
  })

  it('rack facts: numbers validated, PDU sockets sent as a pair', () => {
    expect(factPatch({}, 'details', 'usableDepthMm', '650', true)).toEqual({ details: { usableDepthMm: 650 } })
    expect(factPatch({}, 'details', 'usableDepthMm', '-1', true)).toBeNull()
    expect(factPatch({}, 'details', 'type', '', false)).toEqual({ details: { type: null } })
    expect(factPatch({ mountingPower: { pduA: { totalSockets: 24, freeSockets: 4 } } }, 'mountingPower', 'pduA.freeSockets', '6', true)).toEqual({ mountingPower: { pduA: { totalSockets: 24, freeSockets: 6 } } })
  })

  it('room facts map between the panel and the API; stepper links stay in the project', () => {
    expect(toPanelValue('not_verified')).toBe('not-verified')
    expect(toApiValue('to-verify')).toBe('to_verify')
    const links = stepperLinksFor('o', 'p', 'b', null)
    expect(links['rack-survey']).toBeUndefined()
    expect(links['room-details']).toBe('/orgs/o/projects/p/buildings/b/survey/room')
    expect(formatValue({ fileIds: ['a', 'b'] })).toBe('2 file(s)')
    expect(formatValue(null)).toBe('—')
  })

  it('photos: long edge capped, aspect kept, never enlarged; re-encoded name', () => {
    expect(fitWithin(5120, 2880)).toEqual({ width: 2560, height: 1440 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 })
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(jpegName('')).toBe('photo.jpg')
  })
})
