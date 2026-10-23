import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { lldProject } from './helpers/lld.js'
import { closePdfBrowser, pdfPages } from '../src/documents/render/pdf.js'

// M7a-3: the standard reports as PDF (headless Chromium, so this file runs
// in the second Vitest process with api.m6b.test.js).
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

describe('Standard reports as PDF (v2.2 §21.9)', () => {
  it('a scoped member’s Weekly Status PDF holds their building only, with the watermark; a cost BOM Summary is marked internal on every page', async () => {
    const ctx = createTestApp()
    const p = await lldProject(ctx)
    const pm = await projectMember(ctx, p.admin, { email: 'pm@example.com', role: 'pm', projectId: p.projectId })
    const pdf = async (agent, typeKey, options = {}) => {
      const res = expectStatus(await agent.post(`${p.base}/documents`).send({ typeKey, format: 'pdf', options }), 202)
      await ctx.app.__documents.process()
      const doc = (await agent.get(`${p.base}/documents/${res.body.document.id}`).expect(200)).body.document
      expect(doc.status, doc.error).toBe('ready')
      return pdfPages((await binary(agent.get(`${p.base}/documents/${doc.id}/download`)).expect(200)).body)
    }
    const weekly = (await pdf(p.feB001, 'weekly-status')).join('\n')
    expect(weekly).toMatch(/Weekly Status Report/)
    expect(weekly).toMatch(/B001/)
    expect(weekly).not.toMatch(/B002|B101/)
    expect(weekly).toMatch(/buildings in your scope/)
    const cost = await pdf(pm, 'bom-summary', { prices: 'cost' })
    for (const page of cost) expect(page).toMatch(/INTERNAL — cost prices/)
    const plain = (await pdf(p.viewer, 'bom-summary')).join('\n')
    expect(plain).not.toMatch(/INTERNAL|EUR|Value/)
  }, 240000)
})
