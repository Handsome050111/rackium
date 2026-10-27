import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { closePdfBrowser } from '../src/documents/render/pdf.js'
import { seedDemo, DEMO_USERS, DEMO_BUILDINGS, DEMO_PASSWORD, STAGES } from '../dev/demoData.js'
import { claimRuntimeDir, readOwner, DEV_PORTS } from '../dev/runtime.js'

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

// `npm run dev:local` (docs/BACKEND-SETUP.md): the demo data reaches every
// stage through the API, so a change that breaks a flow breaks this test
// rather than the next local review.
describe('dev:local demo data', () => {
  it('one organisation, a user for every role, one building at each stage from survey to handover — all synthetic', async () => {
    const ctx = createTestApp()
    const seeded = await seedDemo({ agent: ctx.agent, mailer: ctx.mailer, processDocuments: () => ctx.app.__documents.process({ limit: 50 }) })
    const { base, buildings } = seeded
    expect(buildings.map((b) => b.stage)).toEqual(STAGES)
    // Synthetic only: example.com addresses, nothing from client files.
    expect(DEMO_USERS.every((u) => u.email.endsWith('@example.com'))).toBe(true)

    // Every role signs in with the shared demo password and has its role.
    const signedIn = {}
    for (const u of DEMO_USERS) {
      const a = ctx.agent()
      const { body } = await a.post('/api/v1/auth/login').send({ email: u.email, password: DEMO_PASSWORD }).expect(200)
      const roles = body.memberships.map((m) => m.role)
      expect(roles, u.email).toContain(u.role)
      signedIn[u.key] = a
    }
    expect(Object.keys(signedIn)).toHaveLength(7)
    const { admin } = signedIn
    const get = async (p) => (await admin.get(`${base}${p}`).expect(200)).body
    const at = (stage) => buildings.find((b) => b.stage === stage).id

    // Survey: one tab verified, the rest open; every later building fully verified.
    const survey = await get(`/survey/buildings/${at('survey')}/progress`)
    expect(survey).toMatchObject({ verifiedCount: 1, allVerified: false })
    expect(survey.totalCount).toBeGreaterThan(1)
    for (const b of buildings.filter((x) => x.stage !== 'survey')) expect(await get(`/survey/buildings/${b.id}/progress`), b.code).toMatchObject({ allVerified: true, phaseStatus: 'approved' })
    // HLD and LLD waiting for review.
    expect((await get(`/hld/buildings/${at('hld')}`)).status).toBe('awaiting_approval')
    expect((await get(`/hld/buildings/${at('lld')}`)).status).toBe('approved')
    expect((await get(`/lld/buildings/${at('lld')}`)).status).toBe('awaiting_approval')
    // BOM approved, procurement half done.
    const bom = await get(`/bom/buildings/${at('bom')}`)
    expect(bom.procurement).toMatchObject({ bomApproved: true, unlocked: true })
    const statuses = bom.lines.map((l) => l.procurement.status)
    expect(statuses).toContain('ordered')
    expect(statuses).toContain('not_ordered')
    // Deployment under way: some installed, some not, nothing accepted.
    const dep = await get(`/deployment/buildings/${at('deployment')}`)
    const installed = dep.devices.filter((d) => d.status === 'installed').length
    expect(installed).toBeGreaterThan(0)
    expect(installed).toBeLessThan(dep.devices.length)
    expect(dep.devices.some((d) => d.status === 'accepted')).toBe(false)
    // Handed over and accepted by the client.
    expect(await get(`/handover/buildings/${at('handover')}`)).toMatchObject({ state: 'accepted', phaseStatus: 'approved', baseline: { label: 'v1.0' } })
    // The project list shows the six buildings.
    const projects = (await admin.get(`/api/v1/orgs/${seeded.orgId}/projects`).expect(200)).body.projects
    expect(projects[0].buildings.map((b) => b.code).sort()).toEqual(DEMO_BUILDINGS.map((b) => b.code))
  }, 600000)
})

describe('dev:local runtime folder and ports', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rackium-dev-runtime-test-'))

  it('is taken by one live run at a time; a folder left by a killed run is cleared', () => {
    const dir = path.join(tmp(), '.runtime')
    const first = claimRuntimeDir(dir, { pid: 111, isAlive: () => true })
    fs.writeFileSync(path.join(first.dbDir, 'leftover'), 'x')
    expect(readOwner(dir)).toMatchObject({ pid: 111 })
    // Another process while the first is alive: refused, nothing removed.
    expect(() => claimRuntimeDir(dir, { pid: 222, isAlive: () => true })).toThrow(/already running \(process 111\)/)
    expect(fs.existsSync(path.join(first.dbDir, 'leftover'))).toBe(true)
    // The first was killed: its leftovers go, the new run owns a clean folder.
    const second = claimRuntimeDir(dir, { pid: 222, isAlive: () => false })
    expect(fs.existsSync(path.join(second.dbDir, 'leftover'))).toBe(false)
    expect(readOwner(dir)).toMatchObject({ pid: 222 })
    fs.rmSync(path.dirname(dir), { recursive: true, force: true })
  })

  it('never uses a port of `npm run dev` or the Playwright servers', () => {
    const taken = [4000, 5173, 4100, 5174]
    expect(Object.values(DEV_PORTS).filter((p) => taken.includes(p))).toEqual([])
  })
})
