import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { surveyProject, roomWithRack, upload, jpeg, sha256, newId, transition, fillTab } from './helpers/survey.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')
const start = (agent, base, bytes, extra) => agent.post(`${base}/files/uploads`).send({ fileId: newId(), fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, sha256: sha256(bytes), category: 'photo_reference', ...extra })
const chunk = (agent, base, fileId, offset, bytes) => agent.patch(`${base}/files/uploads/${fileId}?offset=${offset}`).set('Content-Type', 'application/octet-stream').send(bytes)

describe('chunked, resumable uploads (DATA-MODEL §9)', () => {
  it('an interrupted upload resumes from what arrived; a wrong offset is told where to resume', async () => {
    const p = await surveyProject(t())
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    const bytes = await jpeg({ width: 800, height: 600 })
    const fileId = newId()
    const body = { fileId, fileName: 'room.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, sha256: sha256(bytes), category: 'photo_reference', attachedTo: { type: 'room', id: room.id } }
    expect((await p.fe.post(`${p.base}/files/uploads`).send(body).expect(201)).body).toMatchObject({ receivedBytes: 0, completed: false })
    const half = Math.floor(bytes.length / 2)
    await chunk(p.fe, p.base, fileId, 0, bytes.subarray(0, half)).expect(200)

    // The connection drops; the client asks again with the same id.
    expect((await p.fe.post(`${p.base}/files/uploads`).send(body).expect(201)).body).toMatchObject({ receivedBytes: half, completed: false })
    expect((await p.fe.get(`${p.base}/files/uploads/${fileId}`).expect(200)).body.receivedBytes).toBe(half)
    const wrong = await chunk(p.fe, p.base, fileId, 0, bytes.subarray(0, half)).expect(409)
    expect(wrong.body.error).toMatchObject({ code: 'offset_mismatch', details: { receivedBytes: half } })
    await p.fe.post(`${p.base}/files/uploads/${fileId}/complete`).expect(409) // not all arrived

    await chunk(p.fe, p.base, fileId, half, bytes.subarray(half)).expect(200)
    const file = (await p.fe.post(`${p.base}/files/uploads/${fileId}/complete`).expect(201)).body.file
    expect(file).toMatchObject({ id: fileId, mimeType: 'image/jpeg', widthPx: 800, heightPx: 600, hasThumbnail: true })
    // Completing again (a retry after a lost response) returns the same file.
    expect((await p.fe.post(`${p.base}/files/uploads/${fileId}/complete`).expect(201)).body.file.id).toBe(fileId)
    expect((await p.fe.post(`${p.base}/files/uploads`).send(body).expect(201)).body).toMatchObject({ completed: true })

    // Someone else cannot see or continue another user's upload.
    await p.architect.get(`${p.base}/files/uploads/${fileId}`).expect(404)
  })

  it('a damaged upload (checksum) is refused and restarts; a disguised type is refused; size limits apply', async () => {
    const p = await surveyProject(t())
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    const attachedTo = { type: 'room', id: room.id }
    const bytes = await jpeg()
    const damaged = Buffer.from(bytes)
    damaged[damaged.length - 10] ^= 0xff
    const s = (await start(p.fe, p.base, bytes, { attachedTo }).expect(201)).body
    await chunk(p.fe, p.base, s.fileId, 0, damaged).expect(200)
    expect((await p.fe.post(`${p.base}/files/uploads/${s.fileId}/complete`).expect(422)).body.error.code).toBe('checksum_mismatch')
    expect((await p.fe.get(`${p.base}/files/uploads/${s.fileId}`)).body.receivedBytes).toBe(0)
    await chunk(p.fe, p.base, s.fileId, 0, bytes).expect(200)
    await p.fe.post(`${p.base}/files/uploads/${s.fileId}/complete`).expect(201)

    // A PDF named and declared as a JPEG.
    const fake = (await start(p.fe, p.base, PDF, { attachedTo }).expect(201)).body
    await chunk(p.fe, p.base, fake.fileId, 0, PDF).expect(200)
    expect((await p.fe.post(`${p.base}/files/uploads/${fake.fileId}/complete`).expect(415)).body.error.code).toBe('unsupported_type')

    // Declared types outside the category, and the per-type limits (photo 15 MB, PDF 25 MB, sheet 10 MB).
    await start(p.fe, p.base, PDF, { attachedTo, fileName: 'x.exe', mimeType: 'application/octet-stream' }).expect(400)
    await p.fe.post(`${p.base}/files/uploads`).send({ fileId: newId(), fileName: 'big.jpg', mimeType: 'image/jpeg', sizeBytes: 15 * 1024 * 1024 + 1, sha256: '0'.repeat(64), category: 'photo_reference', attachedTo }).expect(413)
    await p.fe.post(`${p.base}/files/uploads`).send({ fileId: newId(), fileName: 'plan.pdf', mimeType: 'application/pdf', sizeBytes: 25 * 1024 * 1024, sha256: '0'.repeat(64), category: 'document', attachedTo }).expect(201)
    await p.fe.post(`${p.base}/files/uploads`).send({ fileId: newId(), fileName: 'list.csv', mimeType: 'text/csv', sizeBytes: 10 * 1024 * 1024 + 1, sha256: '0'.repeat(64), category: 'document', attachedTo }).expect(413)

    const pdf = await upload(p.fe, p.base, { attachedTo, bytes: PDF, category: 'document', fileName: 'plan.pdf', mimeType: 'application/pdf' })
    expect(pdf).toMatchObject({ mimeType: 'application/pdf', hasThumbnail: false })
  })

  // Regression: client-chosen ids are global (File _id); a reused id was a 500.
  it("an id already used by someone else's file is refused, not overwritten", async () => {
    const p = await surveyProject(t())
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    const bytes = await jpeg()
    const file = await upload(p.fe, p.base, { attachedTo: { type: 'room', id: room.id }, bytes })
    const res = await p.architect
      .post(`${p.base}/files/uploads`)
      .send({ fileId: file.id, fileName: 'mine.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, sha256: sha256(bytes), category: 'photo_reference', attachedTo: { type: 'room', id: room.id } })
      .expect(409)
    expect(res.body.error.code).toBe('upload_exists')
  })
})

describe('file access control', () => {
  it('downloads only through authorised calls: project members in scope, never another organisation', async () => {
    const ctx = t()
    const p = await surveyProject(ctx)
    const b002 = p.building('B002').id
    const { room } = await roomWithRack(p.fe, p.base, b002)
    const bytes = await jpeg()
    const file = await upload(p.fe, p.base, { attachedTo: { type: 'room', id: room.id }, bytes })

    const content = await p.viewer.get(`${p.base}/files/${file.id}/content`).buffer(true).expect(200)
    expect(Buffer.compare(content.body, bytes)).toBe(0)
    expect(content.headers).toMatchObject({ 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300' })
    expect(content.headers['content-disposition']).toMatch(/^inline; filename="photo.jpg"/)
    const thumb = await p.viewer.get(`${p.base}/files/${file.id}/thumbnail`).buffer(true).expect(200)
    expect(thumb.headers['content-type']).toBe('image/jpeg')

    // Field Engineer scoped to B001 cannot read B002's files, or list them.
    await p.feB001.get(`${p.base}/files/${file.id}/content`).expect(404)
    await p.feB001.get(`${p.base}/files/${file.id}`).expect(404)
    await p.feB001.get(`${p.base}/files`).query({ type: 'room', id: room.id }).expect(404)
    // Signed out, and another organisation (even with the right URL).
    await ctx.agent().get(`${p.base}/files/${file.id}/content`).expect(401)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.base}/files/${file.id}/content`).expect(404)
    const own = (await outsider.agent.post(`/api/v1/orgs/${outsider.orgId}/projects`).send({ name: 'Own', code: 'OWN' }).expect(201)).body.project.id
    await outsider.agent.get(`/api/v1/orgs/${outsider.orgId}/projects/${own}/files/${file.id}/content`).expect(404)

    // Viewers read but never add or delete.
    await start(p.viewer, p.base, bytes, { attachedTo: { type: 'room', id: room.id } }).expect(403)
    await p.viewer.delete(`${p.base}/files/${file.id}`).expect(403)
    // Survey-form photos are the Field Engineer's.
    await start(p.architect, p.base, bytes, { attachedTo: { type: 'surveyTab', buildingId: b002, roomId: null, tab: 'Storage Area' } }).expect(403)
    expect((await p.viewer.get(`${p.base}/files`).query({ type: 'room', id: room.id }).expect(200)).body.files).toHaveLength(1)
  })

  it("a survey tab's photos cannot be removed once it is submitted; they can again in Draft", async () => {
    const p = await surveyProject(t())
    const target = { buildingId: p.building('B001').id, roomId: null, tab: 'Storage Area' }
    await fillTab(p.fe, p.base, target)
    const files = (await p.fe.get(`${p.base}/files`).query({ type: 'surveyTab', ...target, roomId: undefined }).expect(200)).body.files
    expect(files).toHaveLength(1)
    await transition(p.fe, p.base, target, 'submit').expect(200)
    expect((await p.fe.delete(`${p.base}/files/${files[0].id}`).expect(409)).body.error.code).toBe('tab_locked')
    await transition(p.architect, p.base, target, 'reject', 'Retake the photo').expect(200)
    await p.fe.delete(`${p.base}/files/${files[0].id}`).expect(200)
    await p.viewer.get(`${p.base}/files/${files[0].id}/content`).expect(404)
  })
})
