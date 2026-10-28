import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { deployable, deliverAll, install, patch, depView, acceptEverything } from './helpers/m6a.js'
import { clientDecides } from './helpers/m5a.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { closePdfBrowser, pdfPages } from '../src/documents/render/pdf.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { HandoverBaseline } from '../src/models/handoverBaseline.js'
import { GeneratedDocument } from '../src/models/generatedDocument.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await closePdfBrowser()
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()
const col = (name) => mongoose.connection.db.collection(name)
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })
// PDF text with the line breaks taken out (a long ID may wrap at its hyphen).
const flat = (pages) => pages.join(' ').replace(/\s+/g, '')
const has = (text, s) => expect(text).toContain(s.replace(/\s+/g, ''))
const pub = (token, path = '') => `/api/v1/public/share-links/${token}${path}`

// Requests a document, runs the queue, returns its final state.
async function generate(ctx, p, agent, body) {
  const res = await agent.post(`${p.base}/documents`).send({ buildingId: p.b001, ...body })
  expect([200, 202], JSON.stringify(res.body)).toContain(res.status)
  await ctx.app.__documents.process()
  const doc = (await agent.get(`${p.base}/documents/${res.body.document.id}`).expect(200)).body.document
  // A failed job says why (e.g. no Chromium in CI), not just "failed".
  if (doc.status !== 'ready') throw new Error(`${doc.fileName} is ${doc.status}: ${doc.error ?? 'no error recorded'}`)
  return doc
}
const download = async (p, agent, id) => (await binary(agent.get(`${p.base}/documents/${id}/download`)).expect(200)).body

describe('Document engine: background jobs, PDFs with contents, watermark and audit (v2.2 §10, §11.8)', () => {
  it('an HLD document: queued, generated in the background, a PDF with cover, contents with page numbers, sections, page numbers and the watermark', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const res = expectStatus(await p.architect.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'hld-document', format: 'pdf' }), 202)
    expect(res.body.document).toMatchObject({ status: 'queued', version: 1, typeKey: 'hld-document', fileName: 'B001-hld-document-v1.pdf' })
    // Not ready yet: no download.
    expect((await p.architect.get(`${p.base}/documents/${res.body.document.id}/download`).expect(409)).body.error.code).toBe('not_ready')
    expect(await ctx.app.__documents.process()).toEqual({ done: 1 })
    const doc = (await p.architect.get(`${p.base}/documents/${res.body.document.id}`).expect(200)).body.document
    expect(doc, `generation failed: ${doc.error}`).toMatchObject({ status: 'ready', progress: 100, requestedBy: 'architect' })
    expect(doc.pageCount).toBeGreaterThan(3)
    const r = await binary(p.architect.get(`${p.base}/documents/${doc.id}/download`)).expect(200)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.headers['content-disposition']).toContain('B001-hld-document-v1.pdf')
    const pages = await pdfPages(r.body)
    expect(pages[0]).toContain('High-Level Design')
    expect(pages[0]).toContain('Client logo') // placeholder until the PM uploads one
    expect(pages[1]).toMatch(/Contents.*1 Overview.*\d.*2 Physical topology.*\d.*3 Device inventory.*\d.*4 Uplinks.*\d.*5 Approval history/s)
    const all = pages.join('\n')
    for (const s of ['Device inventory', 'Uplinks', 'E-DE-ERL-C01-B001-EG-001', 'TR-EG-01']) expect(all).toContain(s)
    // The watermark (organisation, date, user) and page numbers on every page.
    const today = new Date().toISOString().slice(0, 4)
    pages.forEach((text, i) => {
      expect(text).toMatch(new RegExp(`Acme Build · ${today}-\\d\\d-\\d\\d · architect`))
      expect(text).toContain(`Page ${i + 1} of ${pages.length}`)
    })
    // The contents' page numbers point at the real pages.
    const tocLine = pages[1].match(/3 Device inventory\s*(\d+)/)
    expect(pages[Number(tocLine[1]) - 1]).toContain('3 Device inventory')
    // Requested, generated and downloaded — each audited.
    const actions = (await col('auditentries').find({ objectId: doc.id }).toArray()).map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['document.requested', 'document.generated', 'document.downloaded']))
    // The file is a file-service record attached to the document.
    expect(await col('files').findOne({ 'attachedTo.type': 'generatedDocument' })).toMatchObject({ mimeType: 'application/pdf', category: 'document' })
  }, 180000)

  it('LLD and Solution Package PDFs contain their sections; the Word file too; Excel sheets with configurable headings', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const lld = await generate(ctx, p, p.architect, { typeKey: 'lld-document', format: 'pdf' })
    const lldText = flat(await pdfPages(await download(p, p.architect, lld.id)))
    for (const s of ['Low-Level Design', '2 Rack elevations', '3 Port schedule', '4 Cable schedule', 'C-EA-1b', 'Rack R01']) has(lldText, s)
    const sp = await generate(ctx, p, p.admin.agent, { typeKey: 'solution-package', format: 'pdf' })
    const spText = flat(await pdfPages(await download(p, p.admin.agent, sp.id)))
    for (const s of ['1 Document information and scope', '9 IP, VLAN, VN and VRF design', '16 BOM and procurement package', '18 Assumptions, risks, dependencies and open items', '10.10.0.0/24', 'Quantities only']) has(spText, s)
    const word = await generate(ctx, p, p.admin.agent, { typeKey: 'solution-package', format: 'docx' })
    const zip = await JSZip.loadAsync(await download(p, p.admin.agent, word.id))
    const xml = await zip.file('word/document.xml').async('string')
    for (const s of ['Solution Package', '7 Cabling and uplink schedules', '18 Assumptions, risks, dependencies and open items']) expect(xml).toContain(s)
    expect(xml).toContain('TOC') // a table of contents Word fills when the file opens
    // The SC column headings are a project setting (PM); placeholders until set.
    await p.architect.put(`${p.base}/settings/cable-headings`).send({ headings: { cableId: 'SC Kabel-Nr.' } }).expect(403)
    await p.admin.agent.put(`${p.base}/settings/cable-headings`).send({ headings: { bogus: 'x' } }).expect(400)
    expectStatus(await p.admin.agent.put(`${p.base}/settings/cable-headings`).send({ headings: { cableId: 'SC Kabel-Nr.', lengthM: 'Länge (m)' } }), 200)
    const xlsx = await generate(ctx, p, p.architect, { typeKey: 'cable-matrix', format: 'xlsx' })
    const book = XLSX.read(await download(p, p.architect, xlsx.id), { type: 'buffer' })
    expect(book.SheetNames).toEqual(['Cable schedule', 'Cable matrix', 'Port schedule'])
    const schedule = XLSX.utils.sheet_to_json(book.Sheets['Cable schedule'], { header: 1 })
    expect(schedule[0]).toEqual(['SC Kabel-Nr.', 'From device', 'From port', 'To device', 'To port', 'Media', 'Cable type', 'Länge (m)', 'Status'])
    expect(schedule.slice(1).map((r) => r[0])).toEqual(['C-BE-1', 'C-BF-1', 'C-EA-1', 'C-EA-1b'])
  }, 240000)

  it('identical requests while one is queued return it; a run that died is resumed onto the same file; a failure is reported', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const body = { buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx' }
    const first = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send(body), 202).body.document
    const again = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send(body), 200).body
    expect(again).toMatchObject({ existing: true, document: { id: first.id } })
    // Another user's identical request is their own (their watermark and scope).
    expect(expectStatus(await p.architect.post(`${p.base}/documents`).send(body), 202).body.document.version).toBe(2)
    // A process that claimed the job and died: its lock expires, the next run resumes it.
    await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => GeneratedDocument.updateOne({ _id: first.id }, { $set: { status: 'generating', lockedUntil: new Date(Date.now() - 1000), attempts: 1 } }))
    expect(await ctx.app.__documents.process()).toEqual({ done: 2 })
    expect(await ctx.app.__documents.process()).toEqual({ done: 0 })
    const doc = (await p.admin.agent.get(`${p.base}/documents/${first.id}`).expect(200)).body.document
    expect(doc.status).toBe('ready')
    expect(await col('files').countDocuments({ 'attachedTo.type': 'generatedDocument' })).toBe(2)
    // A document that cannot be generated fails with the reason.
    const b002 = p.building('B002').id
    const failed = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: b002, typeKey: 'lld-document', format: 'pdf' }), 202).body.document
    await ctx.app.__documents.process()
    expect((await p.admin.agent.get(`${p.base}/documents/${failed.id}`).expect(200)).body.document).toMatchObject({ status: 'failed', error: 'This building has no LLD yet' })
    expect(await col('auditentries').findOne({ action: 'document.failed' })).toBeTruthy()
    // Unknown formats and types are refused up front.
    expect((await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'hld-document', format: 'docx' }).expect(400)).body.error.message).toBe('HLD document is not available as DOCX')
    await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'handover-package', format: 'zip' }).expect(400)
  }, 180000)
})

describe('Access: prices, audit log, scopes and isolation', () => {
  it('price exports only for those who may see prices; priced documents hidden from others; audit export for its readers; out-of-scope and other organisations 404', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    await p.architect.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'solution-package', format: 'pdf', options: { prices: 'sell' } }).expect(403)
    const priced = await generate(ctx, p, p.admin.agent, { typeKey: 'solution-package', format: 'pdf', options: { prices: 'sell' } })
    const text = (await pdfPages(await download(p, p.admin.agent, priced.id))).join('\n')
    expect(text).toMatch(/EUR \d+\.\d\d/)
    expect(text).not.toMatch(/margin/i)
    // The Architect (no price access) neither lists nor opens it.
    const list = (await p.architect.get(`${p.base}/documents?buildingId=${p.b001}`).expect(200)).body.documents
    expect(list.map((d) => d.id)).not.toContain(priced.id)
    await p.architect.get(`${p.base}/documents/${priced.id}`).expect(404)
    await p.architect.get(`${p.base}/documents/${priced.id}/download`).expect(404)
    // The audit log export: PM, Architect, Reviewer, Org Admin — not a Field Engineer.
    await p.fe.post(`${p.base}/documents`).send({ typeKey: 'audit-log', format: 'csv' }).expect(403)
    const audit = await generate(ctx, p, p.reviewer, { buildingId: null, typeKey: 'audit-log', format: 'csv', options: { filters: { module: 'hld' } } })
    const csv = (await download(p, p.reviewer, audit.id)).toString('utf8')
    expect(csv.split('\r\n')[0]).toBe('﻿When,Who,Action,Object,Change type,Comment')
    expect(csv).toContain('hld.')
    const auditPdf = await generate(ctx, p, p.reviewer, { buildingId: null, typeKey: 'audit-log', format: 'pdf' })
    expect((await pdfPages(await download(p, p.reviewer, auditPdf.id))).join('\n')).toContain('Audit Log')
    await p.fe.get(`${p.base}/documents/${audit.id}`).expect(404)
    // A Viewer generates design documents.
    const hld = await generate(ctx, p, p.viewer, { typeKey: 'hld-document', format: 'pdf' })
    expect(hld.status).toBe('ready')
    // Scopes: a member scoped to B002 sees nothing of B001.
    const feB002 = await projectMember(ctx, p.admin, { email: 'fe2@example.com', role: 'field_engineer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    await feB002.get(`${p.base}/documents?buildingId=${p.b001}`).expect(404)
    await feB002.get(`${p.base}/documents/${hld.id}`).expect(404)
    await feB002.get(`${p.base}/documents/${hld.id}/download`).expect(404)
    await feB002.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'hld-document', format: 'pdf' }).expect(404)
    // Another organisation: 404 everywhere.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await other.agent.get(`${p.base}/documents/${hld.id}/download`).expect(404)
    await other.agent.get(`/api/v1/orgs/${other.orgId}/projects/${p.projectId}/documents/${hld.id}`).expect(404)
  }, 240000)
})

describe('Download share links (time-limited, optional password)', () => {
  it('a PM shares chosen documents: password checked, downloads audited; a link without a password; expired, revoked and foreign documents refused', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const hld = await generate(ctx, p, p.admin.agent, { typeKey: 'hld-document', format: 'pdf' })
    const bom = await generate(ctx, p, p.admin.agent, { typeKey: 'bom-final', format: 'xlsx' })
    const other = await generate(ctx, p, p.admin.agent, { typeKey: 'lld-document', format: 'pdf' })
    await p.architect.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [hld.id] }).expect(403)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [hld.id, bom.id], expiryDays: 3, password: 'Secret-Pass-1', label: 'Design pack' }), 201).body.shareLink
    expect(link).toMatchObject({ hasPassword: true, password: 'Secret-Pass-1' })
    expect(link.url).toMatch(/^\/download\//)
    const token = link.url.split('/').pop()
    expect((await ctx.agent().get(pub(token)).expect(200)).body).toMatchObject({ status: 'active', kind: 'document_download', passwordRequired: true })
    expect((await ctx.agent().post(pub(token, '/view')).send({}).expect(401)).body.error.code).toBe('password_required')
    await ctx.agent().post(pub(token, '/view')).send({ password: 'wrong-pass' }).expect(401)
    const view = (await ctx.agent().post(pub(token, '/view')).send({ password: 'Secret-Pass-1' }).expect(200)).body
    expect(view.documents.map((d) => d.fileName)).toEqual(expect.arrayContaining(['B001-hld-document-v1.pdf', 'B001-bom-final-v1.xlsx']))
    await ctx.agent().post(pub(token, `/documents/${hld.id}`)).send({ password: 'nope-nope' }).expect(401)
    const file = await binary(ctx.agent().post(pub(token, `/documents/${hld.id}`)).send({ password: 'Secret-Pass-1' })).expect(200)
    expect(file.body.equals(await download(p, p.admin.agent, hld.id))).toBe(true)
    // Not part of the link: 404.
    await ctx.agent().post(pub(token, `/documents/${other.id}`)).send({ password: 'Secret-Pass-1' }).expect(404)
    expect(await col('auditentries').findOne({ action: 'document.downloaded', source: 'client_link' })).toBeTruthy()
    expect(await col('sharelinks').findOne({ kind: 'document_download' })).toMatchObject({ downloads: 1, label: 'Design pack' })
    // A link without a password.
    const open = expectStatus(await p.admin.agent.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [bom.id] }), 201).body.shareLink
    expect(open).toMatchObject({ hasPassword: false, password: null })
    const openToken = open.url.split('/').pop()
    await binary(ctx.agent().post(pub(openToken, `/documents/${bom.id}`)).send({})).expect(200)
    // Expired and revoked links refuse.
    await col('sharelinks').updateOne({ _id: new mongoose.Types.ObjectId(open.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await ctx.agent().post(pub(openToken, `/documents/${bom.id}`)).send({}).expect(410)).body.error.code).toBe('link_expired')
    await p.admin.agent.post(`${p.base}/share-links/${link.id}/revoke`).send({}).expect(200)
    expect((await ctx.agent().post(pub(token, `/documents/${hld.id}`)).send({ password: 'Secret-Pass-1' }).expect(410)).body.error.code).toBe('link_revoked')
    // A download link decides nothing.
    await ctx.agent().post(pub(openToken, '/decision')).send({ password: 'x', decision: 'approved', name: 'X', termsAccepted: true }).expect(404)
    expect((await p.admin.agent.get(`${p.base}/documents/share-links?buildingId=${p.b001}`).expect(200)).body.shareLinks).toHaveLength(2)
  }, 240000)
})

describe('QR cable labels', () => {
  it('a label sheet: two labels per cable showing the cable ID; the QR target needs sign-in and respects scope', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await depView(p.fe, p)
    const ea = v.connections.find((c) => c.segments.length === 2)
    await p.fe.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'cable-labels', format: 'pdf', options: { connectionIds: [ea.id] } }).expect(202)
    await ctx.app.__documents.process()
    const failed = (await p.fe.get(`${p.base}/documents?buildingId=${p.b001}&typeKey=cable-labels`).expect(200)).body.documents[0]
    expect(failed).toMatchObject({ status: 'failed', error: 'Choose a label size' })
    await p.fe.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'cable-labels', format: 'pdf', options: { labelSize: 'avery-l7160' } }).expect(400)
    const labels = await generate(ctx, p, p.fe, { typeKey: 'cable-labels', format: 'pdf', options: { labelSize: 'avery-l7160', connectionIds: [ea.id] } })
    const pages = await pdfPages(await download(p, p.fe, labels.id))
    expect(pages).toHaveLength(1)
    expect(flat(pages).match(/C-EA-1b/g)).toHaveLength(2)
    expect(flat(pages).match(/C-EA-1(?!b)/g)).toHaveLength(2)
    expect(pages[0]).toContain('This end:')
    // Single labels: one per page.
    const single = await generate(ctx, p, p.fe, { typeKey: 'cable-labels', format: 'pdf', options: { labelSize: 'brady-54x25', connectionIds: [ea.id] } })
    expect(await pdfPages(await download(p, p.fe, single.id))).toHaveLength(4)
    // The QR target: the connection for a signed-in member in scope.
    expect((await p.viewer.get(`${p.base}/connections/${ea.id}/locate`).expect(200)).body).toMatchObject({ connectionId: ea.id, buildingId: p.b001, screen: 'deployment' })
    await ctx.agent().get(`${p.base}/connections/${ea.id}/locate`).expect(401)
    const feB002 = await projectMember(ctx, p.admin, { email: 'fe2@example.com', role: 'field_engineer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    await feB002.get(`${p.base}/connections/${ea.id}/locate`).expect(404)
  }, 180000)
})

describe('Renaming a planned panel once the design is frozen (PR #14 review)', () => {
  it('refused on the frozen LLD; a change request carries it (its impact shows it) and, once the client approves, the LLD, deployment view, QR cable labels and documents generated afterwards read the new label — documents generated before keep their version and content', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p, panel } = d
    const before = panel.label
    // Short enough to print whole on a cable label (longer names end in "…"
    // there, so the old label is matched by its prefix on labels).
    const after = 'VT-A1'
    const beforeOnLabel = before.slice(0, 10)
    const ea = (await depView(p.fe, p)).connections.find((c) => c.segments.length === 2)
    const labelsBody = { typeKey: 'cable-labels', format: 'pdf', options: { labelSize: 'avery-l7160', connectionIds: [ea.id] } }
    const cellsOf = async (doc, agent) => {
      const book = XLSX.read(await download(p, agent, doc.id), { type: 'buffer' })
      return book.SheetNames.flatMap((n) => XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1 }).flat()).join(' ')
    }
    // Generated before the rename: the panel's label as it was.
    const labels1 = await generate(ctx, p, p.fe, labelsBody)
    const lld1 = await generate(ctx, p, p.architect, { typeKey: 'lld-document', format: 'pdf' })
    const matrix1 = await generate(ctx, p, p.architect, { typeKey: 'cable-matrix', format: 'xlsx' })
    has(flat(await pdfPages(await download(p, p.fe, labels1.id))), beforeOnLabel)
    has(flat(await pdfPages(await download(p, p.architect, lld1.id))), before)
    expect(await cellsOf(matrix1, p.architect)).toContain(before)

    // Frozen by the Solution Package approval: not on the main LLD.
    expect(expectStatus(await d.save('put', `${p.lld}/devices/${panel.id}/label`, { label: after }), 409).body.error.code).toBe('change_request_required')
    // Through a change request whose only change is the rename (was refused as "no change").
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Rename the patch panel', reason: "The customer's panel naming" }), 201).body.changeRequest
    const branchPanel = (await d.view(cr.branchId)).devices.find((x) => x.inDesign && x.label === before)
    expectStatus(await d.save('put', `${p.lld}/devices/${branchPanel.id}/label`, { label: after }, { branchId: cr.branchId }), 200)
    const impact = (await p.admin.agent.get(`${p.base}/change-requests/${cr.id}`).expect(200)).body.changeRequest.impact
    expect(impact.design.devices.changed.map((x) => x.fields)).toEqual([[{ field: 'label', before, after }]])
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    expectStatus(await clientDecides(ctx, link, { comments: 'Approved' }), 200)

    // Applied: the frozen LLD and what derives from it read the new label —
    // after the old one, "old → new" (M7b-2: a renamed device keeps its old
    // name, addendum v2.3 Q5, DATA-MODEL §5.19).
    const renamed = `${before} → ${after}`
    expect((await d.view()).devices.find((x) => x.id === panel.id)).toMatchObject({ label: renamed, name: after, legacyHostname: before, isPanel: true })
    const ends = (await depView(p.fe, p)).connections.find((c) => c.id === ea.id).segments.flatMap((s) => [s.from.name, s.to.name])
    expect(ends).toContain(renamed)
    expect(ends).not.toContain(before)
    // Generated afterwards: new versions with the new label.
    const labels2 = await generate(ctx, p, p.fe, labelsBody)
    const lld2 = await generate(ctx, p, p.architect, { typeKey: 'lld-document', format: 'pdf' })
    const matrix2 = await generate(ctx, p, p.architect, { typeKey: 'cable-matrix', format: 'xlsx' })
    expect([labels2.version, lld2.version, matrix2.version]).toEqual([labels1.version + 1, lld1.version + 1, matrix1.version + 1])
    for (const [doc, agent] of [[labels2, p.fe], [lld2, p.architect]]) {
      const text = flat(await pdfPages(await download(p, agent, doc.id)))
      has(text, renamed)
    }
    expect(await cellsOf(matrix2, p.architect)).toContain(renamed)
    // Generated before: the same version, the same bytes, the old label.
    for (const [doc, agent] of [[labels1, p.fe], [lld1, p.architect], [matrix1, p.architect]]) {
      const bytes = await download(p, agent, doc.id)
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(doc.sha256)
      expect((await agent.get(`${p.base}/documents/${doc.id}`).expect(200)).body.document.version).toBe(doc.version)
    }
    has(flat(await pdfPages(await download(p, p.fe, labels1.id))), beforeOnLabel)
  }, 300000)
})

describe('Branding', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  it('organisation logo (Org Admin) and client logo (PM) on the cover; validated; audited', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const org = `/api/v1/orgs/${p.admin.orgId}`
    await p.architect.put(`${org}/settings/logo`).send({ dataUrl: PNG }).expect(403)
    await p.admin.agent.put(`${org}/settings/logo`).send({ dataUrl: 'data:image/png;base64,AAAA' }).expect(400)
    expectStatus(await p.admin.agent.put(`${org}/settings/logo`).send({ dataUrl: PNG }), 200)
    await p.architect.put(`${p.base}/settings/client-logo`).send({ dataUrl: PNG }).expect(403)
    expectStatus(await p.admin.agent.put(`${p.base}/settings/client-logo`).send({ dataUrl: PNG }), 200)
    expect((await binary(p.viewer.get(`${p.base}/settings/client-logo`)).expect(200)).headers['content-type']).toBe('image/png')
    const doc = await generate(ctx, p, p.architect, { typeKey: 'exception-register', format: 'pdf' })
    const cover = (await pdfPages(await download(p, p.architect, doc.id)))[0]
    expect(cover).not.toContain('Client logo')
    expect(cover).toContain('Exception Register')
    expect((await col('auditentries').find({ action: { $in: ['organisation.logo.updated', 'settings.client_logo.updated'] } }).toArray()).length).toBe(2)
  }, 180000)
})

describe('Handover workflow (brief v2.3 §5.9)', () => {
  it('checklist → compile (background) → review → deliver → the client accepts: immutable baseline, design read-only, CMDB editable, phase Approved', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const H = `${p.base}/handover/buildings/${p.b001}`
    let view = (await p.admin.agent.get(H).expect(200)).body
    expect(view).toMatchObject({ state: 'pending', ready: false })
    expect(view.checklist.find((i) => i.id === 'deployment')).toMatchObject({ ok: false })
    expect((await p.admin.agent.post(`${H}/compile`).expect(409)).body.error.message).toBe('The pre-compilation checklist is not complete')
    await acceptEverything(p)
    view = (await p.admin.agent.get(H).expect(200)).body
    expect(view.checklist.filter((i) => !i.ok)).toEqual([])
    expect(view).toMatchObject({ state: 'ready', stateLabel: 'Ready' })
    await p.architect.post(`${H}/compile`).expect(403)
    view = expectStatus(await p.admin.agent.post(`${H}/compile`), 202).body
    expect(view).toMatchObject({ state: 'compiling', round: 1, fileCount: 12 })
    await p.reviewer.post(`${H}/review`).expect(409)
    expect(await ctx.app.__documents.process({ limit: 30 })).toEqual({ done: 12 })
    view = (await p.admin.agent.get(H).expect(200)).body
    expect(view).toMatchObject({ state: 'compiled', compiledCount: 12 })
    expect(view.documents.every((d) => d.status === 'ready')).toBe(true)
    expect(view.package).toMatchObject({ typeKey: 'handover-package', status: 'ready' })
    const pkg = await JSZip.loadAsync(await download(p, p.admin.agent, view.package.id))
    expect(Object.keys(pkg.files)).toHaveLength(13) // 12 files + manifest
    expect(await pkg.file('manifest.csv').async('string')).toContain('exec-summary,pdf,1')
    // The 11 documents open and contain their sections.
    const docId = (key, format = 'pdf') => view.documents.find((d) => d.key === key).files.find((f) => f.format === format).document.id
    expect((await pdfPages(await download(p, p.admin.agent, docId('deployment-report')))).join('\n')).toContain('Installation records')
    expect((await pdfPages(await download(p, p.admin.agent, docId('as-built')))).join('\n')).toContain('The installation matches the frozen design field by field.')
    expect((await download(p, p.admin.agent, docId('cmdb-extract', 'csv'))).toString()).toContain('Hostname,Legacy hostname,Mode,Role,Model')
    // Review (PM or Reviewer), then delivery (PM) with a share link.
    await p.fe.post(`${H}/review`).expect(403)
    expectStatus(await p.reviewer.post(`${H}/review`), 200)
    await p.architect.post(`${H}/deliver`).send({}).expect(403)
    const delivered = expectStatus(await p.admin.agent.post(`${H}/deliver`).send({ password: 'Handover-2026', expiryDays: 10 }), 201).body
    expect(delivered.handover.state).toBe('delivered')
    const token = delivered.shareLink.token
    const subject = (await ctx.agent().post(pub(token, '/view')).send({ password: 'Handover-2026' }).expect(200)).body
    expect(subject).toMatchObject({ kind: 'handover', kindLabel: 'Handover package' })
    expect(subject.handover.documents).toHaveLength(11)
    // The client downloads the package through the link.
    const pkgFile = await binary(ctx.agent().post(pub(token, `/documents/${view.package.id}`)).send({ password: 'Handover-2026' })).expect(200)
    expect(pkgFile.headers['content-type']).toBe('application/zip')
    // The client accepts (name, role, comments, acceptance, signature).
    const decided = expectStatus(await clientDecides(ctx, { token, password: 'Handover-2026' }, { comments: 'Accepted as built' }), 200).body
    expect(decided).toMatchObject({ decision: 'approved', accepted: true, baseline: 'v1.0' })
    view = (await p.admin.agent.get(H).expect(200)).body
    expect(view).toMatchObject({ state: 'accepted', phaseStatus: 'approved', baseline: { label: 'v1.0', documents: 12, client: { name: 'Clara Client' } } })
    // The baseline is immutable.
    const baseline = await col('handoverbaselines').findOne({})
    expect(baseline.documents.map((d) => d.typeKey)).toEqual(expect.arrayContaining(['exec-summary', 'photo-evidence']))
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => HandoverBaseline.updateOne({ _id: baseline._id }, { $set: { label: 'v9' } }))).rejects.toThrow(/immutable/)
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => HandoverBaseline.deleteOne({ _id: baseline._id }))).rejects.toThrow(/immutable/)
    // Design phases and deployment are read-only; the CMDB stays editable.
    expect((await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Late change' }).expect(409)).body.error.code).toBe('handed_over')
    const dep = await depView(p.fe, p)
    expect((await p.fe.put(`${p.dep}/devices/${dep.devices[0].id}/installation`).send({ notes: 'x' }).expect(409)).body.error.code).toMatch(/handed_over|accepted/)
    expect((await p.fe.post(`${p.dep}/exceptions/${new mongoose.Types.ObjectId()}/review`).send({ decision: 'accepted' }).expect(403)).body.error.code).toBe('forbidden')
    const line = (await p.admin.agent.get(`${p.base}/bom/buildings/${p.b001}`).expect(200)).body.lines[0]
    expect((await p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: line.key, notes: 'late', version: line.procurement.version }).expect(409)).body.error.code).toBe('handed_over')
    expect((await p.fe.post(`${p.base}/survey/floors`).send({ buildingId: p.b001, token: 'OG', name: 'Upper', order: 1 }).expect(409)).body.error.code).toBe('handed_over')
    const rec = (await p.architect.get(`${p.cmdb}/buildings/${p.b001}`).expect(200)).body.records[0]
    expectStatus(await p.architect.patch(`${p.cmdb}/records/${rec.id}`).send({ assetTag: 'INV-AFTER', version: rec.version }), 200)
    // Dashboard and project list show the Handover phase Approved; the package stays downloadable.
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb', 'handover'] }).expect(200)
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'handover').status).toBe('approved')
    const projects = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/projects`).expect(200)).body.projects
    expect(projects[0].buildings.find((b) => b.id === p.b001).progress).toBe(100)
    await binary(p.viewer.get(`${p.base}/documents/${view.package.id}/download`)).expect(200)
    // The decided link keeps serving the package until it expires.
    await ctx.agent().post(pub(token, '/view')).send({ password: 'Handover-2026' }).expect(200)
    expect((await col('auditentries').findOne({ action: 'handover.baseline_written' })).changeType).toBe('client_decision')
  }, 600000)

  it('the client requests changes: back to the PM, recompiled as a new round; revoking a delivered link returns it to Under review', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    await acceptEverything(p)
    const H = `${p.base}/handover/buildings/${p.b001}`
    await p.admin.agent.post(`${H}/compile`).expect(202)
    await ctx.app.__documents.process({ limit: 30 })
    await p.admin.agent.post(`${H}/review`).expect(200)
    const first = (await p.admin.agent.post(`${H}/deliver`).send({}).expect(201)).body.shareLink
    expect(first.generatedPassword).toBe(true)
    // Revoked: back to Under review, delivered again.
    await p.admin.agent.post(`${p.base}/share-links/${first.id}/revoke`).send({}).expect(200)
    expect((await p.admin.agent.get(H).expect(200)).body.state).toBe('under_review')
    const second = (await p.admin.agent.post(`${H}/deliver`).send({}).expect(201)).body.shareLink
    await clientDecides(ctx, { token: second.token, password: second.password }, { decision: 'changes_requested', comments: '' }).expect(400)
    expectStatus(await clientDecides(ctx, { token: second.token, password: second.password }, { decision: 'changes_requested', comments: 'Add the rack photos' }), 200)
    const view = (await p.admin.agent.get(H).expect(200)).body
    expect(view).toMatchObject({ state: 'changes_requested', phaseStatus: 'changes_requested', lastDecision: { value: 'changes_requested', comments: 'Add the rack photos' } })
    expect((await col('notifications').find({ type: 'handover_changes_requested' }).toArray()).length).toBeGreaterThan(0)
    const again = expectStatus(await p.admin.agent.post(`${H}/compile`), 202).body
    expect(again).toMatchObject({ state: 'compiling', round: 2 })
    expect(await col('handoverbaselines').countDocuments()).toBe(0)
    // Design edits still possible before acceptance (a CR is allowed).
    expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Before acceptance' }), 201)
  }, 600000)
})

describe('Large request bodies (found in M6b)', () => {
  it('a lifecycle import of thousands of rows is accepted (it hit the 100 KB limit before); logos above it too', async () => {
    const ctx = t()
    const { p } = await deployable(ctx, { frozen: false })
    const rows = Array.from({ length: 3000 }, (_, i) => ({ Serial: `SERIAL-NUMBER-${String(i).padStart(6, '0')}`, 'Warranty end': '2030-01-01' }))
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(150_000)
    const preview = expectStatus(await p.architect.post(`${p.cmdb}/lifecycle-import`).send({ buildingId: p.b001, rows }), 200).body
    expect(preview).toMatchObject({ matched: 0, problems: 3000 })
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200_000)]).toString('base64')}`
    expectStatus(await p.admin.agent.put(`/api/v1/orgs/${p.admin.orgId}/settings/logo`).send({ dataUrl: big }), 200)
  }, 180000)
})

describe('Queue resilience (found in M6b)', () => {
  it('a job that crashes the runner does not stop the jobs behind it', async () => {
    const ctx = t()
    const { p } = await deployable(ctx, { frozen: false })
    const good = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'hld-document', format: 'pdf' }), 202).body.document
    // A corrupt job queued first (no organisation): opening it fails before the job's own error handling.
    await col('generateddocuments').insertOne({ projectId: new mongoose.Types.ObjectId(), buildingId: null, typeKey: 'hld-document', format: 'pdf', version: 1, status: 'queued', attempts: 0, requestKey: 'x', requestedBy: new mongoose.Types.ObjectId(), fileId: new mongoose.Types.ObjectId(), requestedAt: new Date(0) })
    expect((await ctx.app.__documents.process()).done).toBe(2)
    expect((await p.admin.agent.get(`${p.base}/documents/${good.id}`).expect(200)).body.document.status).toBe('ready')
  }, 180000)
})

describe('Handover package timing (found in M6b)', () => {
  it('Compiled only once the package is attached (the screen polls until Compiled)', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    await acceptEverything(p)
    const H = `${p.base}/handover/buildings/${p.b001}`
    await p.admin.agent.post(`${H}/compile`).expect(202)
    await ctx.app.__documents.process({ limit: 30 })
    const view = (await p.admin.agent.get(H).expect(200)).body
    expect(view.state).toBe('compiled')
    expect(view.package).toMatchObject({ status: 'ready' }) // never Compiled without its package
    expect(await col('generateddocuments').countDocuments({ typeKey: 'handover-package' })).toBe(1)
  }, 600000)
})

describe('M6b review: cost prices stay internal', () => {
  it('cost mode: Org Admin/PM/Reviewer only, "INTERNAL — cost prices" on every page and sheet; never in a share link, a public download or a handover package', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    await p.architect.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'pdf', options: { prices: 'cost' } }).expect(403)
    await p.fe.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'pdf', options: { prices: 'cost' } }).expect(403)
    const pdf = await generate(ctx, p, p.admin.agent, { typeKey: 'bom-final', format: 'pdf', options: { prices: 'cost' } })
    const pages = await pdfPages(await download(p, p.admin.agent, pdf.id))
    expect(pages.length).toBeGreaterThan(2)
    pages.forEach((page) => expect(page).toContain('INTERNAL — cost prices'))
    expect(pages[0]).toContain('not for the client')
    const xlsx = await generate(ctx, p, p.reviewer, { typeKey: 'bom-final', format: 'xlsx', options: { prices: 'cost' } })
    const book = XLSX.read(await download(p, p.reviewer, xlsx.id), { type: 'buffer' })
    expect(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })[0]).toEqual(['INTERNAL — cost prices'])
    // The Reviewer reads it; the Architect neither lists nor opens it.
    await p.reviewer.get(`${p.base}/documents/${pdf.id}`).expect(200)
    expect((await p.architect.get(`${p.base}/documents?buildingId=${p.b001}`).expect(200)).body.documents.map((d) => d.id)).not.toContain(pdf.id)
    await p.architect.get(`${p.base}/documents/${pdf.id}/download`).expect(404)
    // A share link refuses it, alone or among client-safe documents.
    const sell = await generate(ctx, p, p.admin.agent, { typeKey: 'bom-final', format: 'pdf', options: { prices: 'sell' } })
    expect((await p.admin.agent.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [sell.id, pdf.id] }).expect(400)).body.error.message).toBe('B001-bom-final-v1.pdf is internal (cost prices) and cannot be shared with a client')
    // Even a link that somehow lists it never serves it.
    const link = expectStatus(await p.admin.agent.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [sell.id] }), 201).body.shareLink
    await col('sharelinks').updateOne({ _id: new mongoose.Types.ObjectId(link.id) }, { $push: { documentIds: new mongoose.Types.ObjectId(pdf.id) } })
    const token = link.url.split('/').pop()
    const view = (await ctx.agent().post(pub(token, '/view')).send({}).expect(200)).body
    expect(view.documents.map((d) => d.id)).toEqual([sell.id])
    await ctx.agent().post(pub(token, `/documents/${pdf.id}`)).send({}).expect(404)
    // A handover package never takes cost prices.
    await expect(ctx.app.__documents.enqueue({}, { buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx', options: { prices: 'cost' }, handover: { round: 1 } }, {})).rejects.toThrow('A handover package cannot contain cost prices')
  }, 300000)
})

describe('M6b review: the survey report prints its tables in full', () => {
  it('a table section with many rows: every row, the column headings repeated on each page it spans', async () => {
    const ctx = t()
    const { p } = await deployable(ctx, { frozen: false })
    const { getTabDefinition } = await import('@rackium/shared/surveyForm.js')
    const def = getTabDefinition('Location Details')
    const index = def.sections.findIndex((s) => s.layout === 'table')
    const [first, second] = def.sections[index].fields
    const rows = Array.from({ length: 90 }, (_, i) => ({ rowId: new mongoose.Types.ObjectId(), fieldValues: [{ key: first.key, value: `ROW-${String(i + 1).padStart(3, '0')}` }, { key: second.key, value: 'value' }] }))
    const res = await col('surveytabrecords').updateOne({ tab: 'Location Details', roomId: null, buildingId: new mongoose.Types.ObjectId(p.b001) }, { $set: { sections: [{ sectionIndex: index, layout: 'table', fieldValues: [], rows }], hasData: true } })
    expect(res.matchedCount).toBe(1)
    const doc = await generate(ctx, p, p.architect, { typeKey: 'survey-report', format: 'pdf' })
    const pages = await pdfPages(await download(p, p.architect, doc.id))
    const all = flat(pages)
    for (const n of [1, 45, 90]) expect(all).toContain(`ROW-${String(n).padStart(3, '0')}`)
    expect(all).not.toMatch(/\d+row\(s\)/)
    // The table spans pages; each of them repeats the column headings.
    const heading = first.label.replace(/\s+/g, '')
    const tablePages = pages.map((pg) => pg.replace(/\s+/g, '')).filter((pg) => /ROW-\d{3}/.test(pg))
    expect(tablePages.length).toBeGreaterThan(1)
    tablePages.forEach((pg) => expect(pg).toContain(heading))
  }, 300000)
})
