import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import mongoose from 'mongoose'
import * as XLSX from 'xlsx'
import { localDate, addDays } from '@rackium/shared/timeZone.js'
import { REPORTS } from '@rackium/shared/reports.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { lldProject } from './helpers/lld.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { PhaseHistory } from '../src/models/phaseHistory.js'
import { PhaseTarget } from '../src/models/phaseTarget.js'
import { Blocker } from '../src/models/blocker.js'
import { Approval } from '../src/models/approval.js'
import { DesignVersion } from '../src/models/designVersion.js'
import { File } from '../src/models/file.js'
import { sendScheduledReports } from '../src/reports/schedules.js'
import { deliverOutbox } from '../src/notifications/jobs.js'

// M7a-3: dashboards (project, country/SAL rollup, organisation), the workload
// matrix, analytics, the seven standard reports and scheduled reports
// (DATA-MODEL §5.17) — access for every endpoint, scope, price visibility,
// figures per person, and the schedule rules.
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
const col = (name) => mongoose.connection.db.collection(name)
const oid = (id) => new mongoose.Types.ObjectId(String(id))
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const get = async (agent, url, status = 200) => expectStatus(await agent.get(url), status).body
const me = async (agent) => (await agent.get('/api/v1/me').expect(200)).body.user.id
const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })

// lldProject (helpers/lld.js): B001 and B002 (SAL ERL), B101 (SAL MUC); B001's
// HLD approved (a BOM from it), the LLD phase active. The team: the Org Admin
// (also PM, as creator), an Architect, a Field Engineer, a Field Engineer
// scoped to B001, a Viewer, a Reviewer — plus an unscoped PM and a PM scoped
// to SAL MUC.
async function team(ctx) {
  const p = await lldProject(ctx)
  p.pm = await projectMember(ctx, p.admin, { email: 'pm@example.com', role: 'pm', projectId: p.projectId })
  p.pmMuc = await projectMember(ctx, p.admin, { email: 'pm-muc@example.com', role: 'pm', projectId: p.projectId, scopes: [{ type: 'sal', refId: p.sal('MUC').id }] })
  p.ids = { admin: p.admin.userId }
  for (const k of ['architect', 'fe', 'feB001', 'viewer', 'reviewer', 'pm', 'pmMuc']) p.ids[k] = await me(p[k])
  p.b002 = p.building('B002').id
  p.b101 = p.building('B101').id
  p.org = `/api/v1/orgs/${p.admin.orgId}`
  p.tenant = { organisationId: oid(p.admin.orgId), projectId: oid(p.projectId) }
  p.today = localDate(new Date(), 'Europe/Berlin')
  return p
}
const scoped = (p, fn) => runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, fn)
const codes = (rows) => rows.map((r) => r.code).sort()

describe('Every M7a-3 endpoint: sign-in, membership, role (401 / 404 / 403 as elsewhere)', () => {
  it('dashboards and analytics for every member; workload and schedules for the Org Admin and PMs only; nothing for another organisation or project', async () => {
    const ctx = t()
    const p = await team(ctx)
    const schedule = (await expectStatus(await p.pm.post(`${p.base}/report-schedules`).send({ typeKey: 'weekly-status', format: 'csv', frequency: 'weekly', weekday: 1, recipientIds: [p.ids.viewer] }), 201)).body.schedule
    const readAll = [`${p.base}/dashboard`, `${p.base}/dashboard/rollup`, `${p.base}/analytics`, `${p.org}/dashboard`]
    const restricted = [`${p.base}/workload`, `${p.base}/report-schedules`, `${p.base}/report-schedules/recipients`]
    const writes = [
      ['post', `${p.base}/report-schedules`, { typeKey: 'weekly-status', format: 'csv', frequency: 'weekly', weekday: 1, recipientIds: [p.ids.viewer] }],
      ['patch', `${p.base}/report-schedules/${schedule.id}`, { paused: true }],
      ['delete', `${p.base}/report-schedules/${schedule.id}`, undefined],
    ]
    // Signed out: 401 everywhere.
    const anon = ctx.agent()
    for (const url of [...readAll, ...restricted]) expectStatus(await anon.get(url), 401)
    for (const [m, url, body] of writes) expectStatus(await anon[m](url).send(body), 401)
    // Every member reads the dashboards and analytics.
    for (const k of ['architect', 'fe', 'feB001', 'viewer', 'reviewer', 'pm', 'pmMuc']) for (const url of readAll) expectStatus(await p[k].get(url), 200)
    expectStatus(await p.admin.agent.get(`${p.base}/dashboard`), 200)
    // Workload and schedules: 403 for the other roles…
    for (const k of ['architect', 'fe', 'feB001', 'viewer', 'reviewer']) {
      for (const url of restricted) expectStatus(await p[k].get(url), 403)
      for (const [m, url, body] of writes) expectStatus(await p[k][m](url).send(body), 403)
    }
    // …and 200 for the Org Admin and both PMs (the scoped one too).
    for (const agent of [p.admin.agent, p.pm, p.pmMuc]) for (const url of restricted) expectStatus(await agent.get(url), 200)
    // View As keeps the viewed role's rights: as a Viewer, no workload; as a PM, read-only.
    const session = (await expectStatus(await p.admin.agent.post(`${p.base}/view-as`).send({ projectId: p.projectId, role: 'viewer' }), 201)).body.session
    expectStatus(await p.admin.agent.get(`${p.base}/workload`).set('X-View-As-Session', session.id), 403)
    expectStatus(await p.admin.agent.get(`${p.base}/dashboard`).set('X-View-As-Session', session.id), 200)
    const asPm = (await expectStatus(await p.admin.agent.post(`${p.base}/view-as`).send({ projectId: p.projectId, role: 'pm' }), 201)).body.session
    expectStatus(await p.admin.agent.get(`${p.base}/workload`).set('X-View-As-Session', asPm.id), 200)
    expectStatus(await p.admin.agent.post(`${p.base}/report-schedules`).set('X-View-As-Session', asPm.id).send(writes[0][2]), 403)
    // Another organisation: 404 for its project and its organisation dashboard.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    for (const url of [...readAll, ...restricted]) expectStatus(await other.agent.get(url), 404)
    for (const [m, url, body] of writes) expectStatus(await other.agent[m](url).send(body), 404)
    // A member of another project of the same organisation: 404 for this project.
    const second = (await p.admin.agent.post(`${p.org}/projects`).send({ name: 'Second', code: 'SEC' }).expect(201)).body.project
    const outsider = await projectMember(ctx, p.admin, { email: 'outsider@example.com', role: 'pm', projectId: second.id })
    for (const url of [`${p.base}/dashboard`, `${p.base}/dashboard/rollup`, `${p.base}/analytics`, ...restricted]) expectStatus(await outsider.get(url), 404)
    // …and their organisation dashboard lists only their own project.
    expect((await get(outsider, `${p.org}/dashboard`)).projects.map((x) => x.id)).toEqual([second.id])
    // A schedule of another project is not found from this one.
    const outsiderId = await me(outsider)
    const otherSchedule = expectStatus(await outsider.post(`/api/v1/orgs/${p.admin.orgId}/projects/${second.id}/report-schedules`).send({ typeKey: 'weekly-status', format: 'csv', frequency: 'weekly', weekday: 1, recipientIds: [outsiderId] }), 201).body.schedule
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${otherSchedule.id}`).send({ paused: true }), 404)
    expectStatus(await p.pm.delete(`${p.base}/report-schedules/${otherSchedule.id}`), 404)
  }, 240000)
})

describe('Dashboards count only the buildings the caller can open (v2.2 §21.6)', () => {
  it('project dashboard, country/SAL rollup and organisation dashboard: totals, overdue and buildings by phase over the caller’s scope', async () => {
    const ctx = t()
    const p = await team(ctx)
    // B002's survey target has passed: overdue for those who can see B002.
    expectStatus(await p.pm.put(`${p.base}/schedule/targets`).send({ targets: [{ buildingId: p.b002, phaseKey: 'survey', targetDate: addDays(p.today, -10) }] }), 200)
    const admin = await get(p.admin.agent, `${p.base}/dashboard`)
    expect(codes(admin.buildings)).toEqual(['B001', 'B002', 'B101'])
    expect(admin.scope).toEqual({ buildings: 3, limited: false })
    expect(admin.overdue).toMatchObject({ buildings: 1, phases: [{ code: 'B002', phaseKey: 'survey' }] })
    // Buildings by current phase: each building once, under its first phase not done.
    expect(admin.byPhase.reduce((n, x) => n + x.count, 0)).toBe(3)
    for (const x of admin.byPhase) expect(x.count, x.phaseKey).toBe(admin.buildings.filter((b) => b.currentPhase === x.phaseKey).length)
    expect(admin.byPhase.map((x) => x.phaseKey)).toEqual([...admin.phases, 'done'])
    // B001's survey is verified and its HLD approved: further along than B002.
    const progress = (code) => admin.buildings.find((b) => b.code === code).progress
    expect(progress('B001')).toBeGreaterThan(progress('B002'))
    expect(admin.progress).toBe(Math.round((progress('B001') + progress('B002') + progress('B101')) / 3))
    // B001 has a design: its open validation findings are counted.
    expect(admin.buildings.find((b) => b.code === 'B001').validation).toEqual({ critical: expect.any(Number), warning: expect.any(Number) })
    expect(admin.dguv.counts.total).toBe(0)

    const fe = await get(p.feB001, `${p.base}/dashboard`)
    expect(codes(fe.buildings)).toEqual(['B001'])
    expect(fe.scope).toEqual({ buildings: 1, limited: true })
    expect(fe.overdue).toEqual({ buildings: 0, phases: [] })
    expect(JSON.stringify(fe)).not.toMatch(new RegExp(`${p.b002}|${p.b101}|B002|B101`))

    const muc = await get(p.pmMuc, `${p.base}/dashboard/rollup`)
    expect(muc.totals.buildings).toBe(1)
    expect(muc.countries).toHaveLength(1)
    expect(muc.countries[0].sals.map((s) => [s.code, s.buildingCodes])).toEqual([['MUC', ['B101']]])
    const all = await get(p.admin.agent, `${p.base}/dashboard/rollup`)
    expect(all.countries[0]).toMatchObject({ code: 'DE', buildings: 3, overdue: 1 })
    expect(all.countries[0].sals.map((s) => [s.code, s.buildings, s.overdue])).toEqual([['ERL', 2, 1], ['MUC', 1, 0]])
    expect(all.totals.avgProgress).toBe(Math.round(admin.buildings.reduce((n, b) => n + b.progress, 0) / 3))

    // Organisation level: the same buildings per project.
    const orgAdmin = await get(p.admin.agent, `${p.org}/dashboard`)
    expect(orgAdmin.projects.map((x) => [x.name, x.buildings, x.overdue, x.atRisk])).toEqual([['Survey', 3, 1, true]])
    expect(orgAdmin.totals).toMatchObject({ projects: 1, buildings: 3, overdue: 1 })
    const orgFe = await get(p.feB001, `${p.org}/dashboard`)
    expect(orgFe.projects.map((x) => [x.buildings, x.overdue, x.scopeLimited])).toEqual([[1, 0, true]])
    expect(orgFe.totals).toMatchObject({ buildings: 1, overdue: 0 })
    // The Org Admin sees every project of the organisation, a member only their own.
    const second = (await p.admin.agent.post(`${p.org}/projects`).send({ name: 'Second', code: 'SEC' }).expect(201)).body.project
    expect((await get(p.admin.agent, `${p.org}/dashboard`)).projects.map((x) => x.id)).toContain(second.id)
    expect((await get(p.viewer, `${p.org}/dashboard`)).projects.map((x) => x.id)).not.toContain(second.id)
    // An archived project is not listed with the active ones.
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/projects/${second.id}`).send({ status: 'archived' }).expect(200)
    const afterArchive = await get(p.admin.agent, `${p.org}/dashboard`)
    expect(afterArchive.projects.map((x) => x.id)).not.toContain(second.id)
    expect(afterArchive.archived).toBe(1)
  }, 240000)
})

describe('BOM value only for those who may see prices (D20)', () => {
  it('rollups and the organisation dashboard: Org Admin, PM and Reviewer; Architects only when the Org Admin allows it; never the others', async () => {
    const ctx = t()
    const p = await team(ctx)
    const rollup = async (agent) => get(agent, `${p.base}/dashboard/rollup`)
    for (const agent of [p.admin.agent, p.pm, p.reviewer]) {
      const r = await rollup(agent)
      expect(r.pricesVisible).toBe(true)
      expect(r.totals.bomValue).toMatchObject({ costMinor: expect.any(Number), sellMinor: expect.any(Number), buildings: 1 })
      expect(r.countries[0].sals.find((s) => s.code === 'ERL').bomValue.buildings).toBe(1)
      expect(r.countries[0].sals.find((s) => s.code === 'MUC').bomValue.buildings).toBe(0)
      expect((await get(agent, `${p.org}/dashboard`)).totals.bomValue).toMatchObject({ costMinor: r.totals.bomValue.costMinor, projects: 1, hiddenProjects: 0 })
    }
    for (const agent of [p.architect, p.viewer, p.fe, p.feB001]) {
      const r = await rollup(agent)
      expect(r.pricesVisible).toBe(false)
      expect(JSON.stringify(r)).not.toMatch(/bomValue|costMinor|sellMinor/)
      expect(JSON.stringify(await get(agent, `${p.org}/dashboard`))).not.toMatch(/bomValue|costMinor|sellMinor/)
      expect(JSON.stringify(await get(agent, `${p.base}/dashboard`))).not.toMatch(/bomValue|costMinor|sellMinor/)
    }
    // A scoped PM: the value of their buildings only (B101 has no design).
    expect((await rollup(p.pmMuc)).totals.bomValue).toMatchObject({ costMinor: 0, buildings: 0 })
    // The Org Admin lets Architects see prices: then they see the value too.
    expectStatus(await p.admin.agent.patch(`${p.org}/settings`).send({ architectsSeePrices: true }), 200)
    expect((await rollup(p.architect)).totals.bomValue.buildings).toBe(1)
    expect(JSON.stringify(await rollup(p.viewer))).not.toMatch(/bomValue/)
  }, 240000)
})

describe('Figures per person: the Org Admin and PM only (v2.2 §21.5)', () => {
  it('the workload matrix (member × building, task and overdue counts), team utilisation and survey completion by technician; other roles see counts without names', async () => {
    const ctx = t()
    const p = await team(ctx)
    const task = async (body) => expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send(body), 201)
    await task({ title: 'Label racks', buildingId: p.b001, assignedTo: p.ids.fe, deadline: addDays(p.today, -2) })
    await task({ title: 'Photos', buildingId: p.b002, assignedTo: p.ids.fe, deadline: addDays(p.today, 5) })
    await task({ title: 'Check B001', buildingId: p.b001, assignedTo: p.ids.feB001 })
    await task({ title: 'Project-wide review', assignedTo: p.ids.architect })
    await task({ title: 'MUC walk-through', buildingId: p.b101, assignedTo: p.ids.fe })

    const w = await get(p.admin.agent, `${p.base}/workload`)
    expect(codes(w.buildings)).toEqual(['B001', 'B002', 'B101'])
    const row = (who) => w.people.find((x) => x.userId === p.ids[who])
    expect(row('fe').cells).toEqual({ [p.b001]: { tasks: 1, overdue: 1 }, [p.b002]: { tasks: 1, overdue: 0 }, [p.b101]: { tasks: 1, overdue: 0 } })
    expect(row('fe')).toMatchObject({ openTasks: 3, overdueTasks: 1 })
    expect(row('fe').assigned.map((a) => a.code).sort()).toEqual(['B001', 'B002', 'B101'])
    expect(row('architect').projectWide).toEqual({ tasks: 1, overdue: 0 })
    expect(row('feB001').cells).toEqual({ [p.b001]: { tasks: 1, overdue: 0 } })
    expect(w.totals.byBuilding[p.b001]).toEqual({ tasks: 2, overdue: 1 })
    expect(w.totals).toMatchObject({ tasks: 5, overdue: 1, projectWide: { tasks: 1, overdue: 0 } })
    // A PM scoped to MUC: B101's column only, and only the tasks there (plus project-wide).
    const muc = await get(p.pmMuc, `${p.base}/workload`)
    expect(codes(muc.buildings)).toEqual(['B101'])
    expect(muc.people.find((x) => x.userId === p.ids.fe)).toMatchObject({ openTasks: 1, overdueTasks: 0, cells: { [p.b101]: { tasks: 1, overdue: 0 } } })
    // The B001-only Field Engineer reaches none of MUC's buildings and has no task there: not listed.
    expect(muc.people.some((x) => x.userId === p.ids.feB001)).toBe(false)
    expect(JSON.stringify(muc)).not.toMatch(new RegExp(`${p.b001}|${p.b002}`))

    // Team utilisation on the project dashboard: names for the Org Admin and PMs only.
    for (const agent of [p.admin.agent, p.pm]) {
      const d = await get(agent, `${p.base}/dashboard`)
      expect(d.team.personLevel).toBe(true)
      expect(d.team.people.find((x) => x.userId === p.ids.fe)).toMatchObject({ openTasks: 3, overdueTasks: 1 })
    }
    for (const k of ['architect', 'reviewer', 'viewer', 'fe']) {
      const d = await get(p[k], `${p.base}/dashboard`)
      expect(d.team).toMatchObject({ personLevel: false, openTasks: 5, overdueTasks: 1, members: expect.any(Number), active: 3 })
      expect(d.team.people).toBeUndefined()
      expect(JSON.stringify(d)).not.toMatch(new RegExp(`${p.ids.fe}|${p.ids.feB001}|${p.ids.architect}`))
    }
    // Cross-project utilisation on the organisation dashboard.
    const orgAdmin = await get(p.admin.agent, `${p.org}/dashboard`)
    expect(orgAdmin.utilisation.people.find((x) => x.userId === p.ids.fe)).toMatchObject({ projects: 1, openTasks: 3, overdueTasks: 1 })
    const orgViewer = await get(p.viewer, `${p.org}/dashboard`)
    expect(orgViewer.utilisation).toMatchObject({ people: [], active: 3 })
    expect(JSON.stringify(orgViewer)).not.toMatch(new RegExp(`${p.ids.fe}|${p.ids.feB001}`))
    // Regression: a PM here who is only a Viewer in a second project — the
    // Field Engineer's tasks there never reach the PM's named figures.
    const second = (await p.admin.agent.post(`${p.org}/projects`).send({ name: 'Second', code: 'SEC' }).expect(201)).body.project
    const secondBase = `${p.org}/projects/${second.id}`
    await projectMember(ctx, p.admin, { email: 'pm@example.com', role: 'viewer', projectId: second.id })
    await projectMember(ctx, p.admin, { email: 'fe@example.com', role: 'field_engineer', projectId: second.id })
    expectStatus(await p.admin.agent.post(`${secondBase}/tasks`).send({ title: 'Elsewhere', assignedTo: p.ids.fe, deadline: addDays(p.today, -3) }), 201)
    const orgPm = await get(p.pm, `${p.org}/dashboard`)
    expect(orgPm.utilisation.people.find((x) => x.userId === p.ids.fe)).toMatchObject({ projects: 1, openTasks: 3, overdueTasks: 1 })
    // The Org Admin sees both projects' tasks.
    expect((await get(p.admin.agent, `${p.org}/dashboard`)).utilisation.people.find((x) => x.userId === p.ids.fe)).toMatchObject({ projects: 2, openTasks: 4, overdueTasks: 2 })

    // Survey completion by technician (analytics): the submitter's tabs.
    await col('surveytabrecords').updateMany({ projectId: oid(p.projectId), buildingId: oid(p.b001) }, { $set: { submitted: { at: new Date(), by: oid(p.ids.feB001) } } })
    const a = await get(p.pm, `${p.base}/analytics`)
    expect(a.personLevel).toBe(true)
    expect(a.metrics.surveyCompletion.byTechnician).toEqual([expect.objectContaining({ userId: p.ids.feB001, name: 'field_engineer', verified: expect.any(Number), completionPct: 100 })])
    for (const k of ['architect', 'reviewer', 'viewer', 'feB001']) {
      const v = await get(p[k], `${p.base}/analytics`)
      expect(v.personLevel).toBe(false)
      expect(v.metrics.surveyCompletion.byTechnician).toBeUndefined()
      expect(v.metrics.surveyCompletion.verified).toBe(a.metrics.surveyCompletion.verified)
      expect(JSON.stringify(v)).not.toContain(p.ids.feB001)
    }
  }, 240000)
})

describe('Analytics: six metrics with trend lines; unknown dates left out and counted (v2.2 §21.9)', () => {
  it('phase duration, blockers, BOM variance, survey completion and approval turnaround — over the caller’s buildings', async () => {
    const ctx = t()
    const p = await team(ctx)
    const at = (d) => new Date(`${d}T10:00:00Z`)
    await scoped(p, async () => {
      await PhaseTarget.create([{ buildingId: oid(p.b001), phaseKey: 'cmo', startDate: '2026-06-01', setBy: oid(p.admin.userId) }])
      await PhaseHistory.insertMany(
        [
          { buildingId: oid(p.b001), phaseKey: 'cmo', event: 'completed', at: at('2026-06-10'), on: '2026-06-10', dateKnown: true, source: 'live' },
          { buildingId: oid(p.b001), phaseKey: 'survey', event: 'completed', at: at('2026-07-10'), on: '2026-07-10', dateKnown: true, source: 'live' },
          // Backfilled without evidence: the date is unknown — left out, counted.
          { buildingId: oid(p.b101), phaseKey: 'cmo', event: 'completed', at: null, on: null, dateKnown: false, source: 'derived' },
        ].map((h) => ({ ...h, ...p.tenant }))
      )
      await Blocker.create([
        { buildingId: oid(p.b001), phaseKey: 'survey', description: 'No access', raisedBy: oid(p.admin.userId), raisedAt: at('2026-08-01'), status: 'resolved', resolvedAt: at('2026-08-05') },
        { buildingId: oid(p.b101), phaseKey: 'cmo', description: 'Inventory missing', raisedBy: oid(p.admin.userId), raisedAt: at('2026-09-01') },
      ])
      await Approval.create([{ buildingId: oid(p.b101), phaseKey: 'hld', gate: 'hld_internal', submittedBy: oid(p.ids.architect), submittedAt: at('2026-09-01'), status: 'approved', decision: { value: 'approved', decidedAt: at('2026-09-03'), decidedBy: oid(p.ids.pm) } }])
    })
    // An approval decided without a recorded submission time (older data): excluded, counted.
    await col('approvals').insertOne({ ...p.tenant, buildingId: oid(p.b001), phaseKey: 'lld', gate: 'lld_internal', submittedBy: oid(p.ids.architect), submittedAt: null, status: 'approved', decision: { value: 'approved', decidedAt: at('2026-09-10') } })
    // Two procurement BOM versions of B001 (snapshots in file storage): 9 → 14 cables, one device added.
    const bomVersion = async (number, cables, extra = []) => {
      const fileId = new mongoose.Types.ObjectId()
      const storageKey = `files/${p.projectId}/${fileId}`
      const bytes = Buffer.from(JSON.stringify({ lines: [{ key: 'device:a', qty: 1 }, { key: 'cable:x', qty: cables }, ...extra] }))
      fs.mkdirSync(path.dirname(path.join(ctx.config.FILE_STORAGE_DIR, storageKey)), { recursive: true })
      fs.writeFileSync(path.join(ctx.config.FILE_STORAGE_DIR, storageKey), bytes)
      await scoped(p, async () => {
        await File.create({ _id: fileId, buildingId: oid(p.b001), attachedTo: { type: 'designVersion', id: new mongoose.Types.ObjectId() }, category: 'data_snapshot', fileName: `BOM-v${number}.json`, storageKey, mimeType: 'application/json', sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), uploadedBy: oid(p.admin.userId) })
        await DesignVersion.create({ buildingId: oid(p.b001), designType: 'bom', number, snapshotFileId: fileId, createdBy: oid(p.admin.userId), createdAt: at(number === 1 ? '2026-08-01' : '2026-09-15') })
      })
    }
    await bomVersion(1, 9)
    await bomVersion(2, 14, [{ key: 'device:b', qty: 1 }])

    const a = (await get(p.admin.agent, `${p.base}/analytics`)).metrics
    expect(a.phaseDuration).toMatchObject({ count: 2, excluded: 1, avgDays: 19.5 })
    expect(a.phaseDuration.phases.slice(0, 2)).toEqual([{ phaseKey: 'cmo', avgDays: 9, count: 1 }, { phaseKey: 'survey', avgDays: 30, count: 1 }])
    expect(a.phaseDuration.trend.map((x) => x.period)).toEqual(['2026-06', '2026-07'])
    expect(a.blockerFrequency).toMatchObject({ total: 2, byPhase: { survey: 1, cmo: 1 } })
    expect(a.blockerResolution).toMatchObject({ avgDays: 4, count: 1, open: 1 })
    // BOM revision count (addendum v2.3 Q15): one re-approval, the final 60% from the first.
    expect(a.bomRevisions).toMatchObject({ avgRevisions: 1, totalRevisions: 1, avgChangePct: 60, changed: 1, excluded: 0, buildings: [{ code: 'B001', versions: 2, revisions: 1, changePct: 60 }] })
    expect(a.bomRevisions.trend).toEqual([{ period: '2026-09', value: 1, count: 1 }])
    // BOM accuracy: an approved BOM but the deployment not finished.
    expect(a.bomAccuracy).toMatchObject({ count: 0, inProgress: 1 })
    // The HLD approval of the fixture plus the MUC one; the one without a submission time is excluded.
    expect(a.approvalTurnaround).toMatchObject({ count: 2, excluded: 1 })
    expect(a.approvalTurnaround.trend.map((x) => x.period)).toContain('2026-09')
    // markSurveyVerified writes verified tabs without a verification date: in the rate, not in the trend.
    expect(a.surveyCompletion.verified).toBeGreaterThan(0)
    expect(a.surveyCompletion.excluded).toBe(a.surveyCompletion.verified)

    // The PM scoped to MUC: B101's rows only.
    const m = (await get(p.pmMuc, `${p.base}/analytics`)).metrics
    expect(m.phaseDuration).toMatchObject({ count: 0, excluded: 1 })
    expect(m.blockerFrequency).toMatchObject({ total: 1, byPhase: { cmo: 1 } })
    expect(m.bomRevisions).toMatchObject({ count: 0, buildings: [] })
    expect(m.approvalTurnaround).toMatchObject({ count: 1, excluded: 0, avgDays: 2 })
    expect(m.surveyCompletion).toMatchObject({ verified: 0 })
    // The B001 Field Engineer: B001's.
    const f = (await get(p.feB001, `${p.base}/analytics`)).metrics
    expect(f.blockerFrequency.total).toBe(1)
    expect(f.approvalTurnaround).toMatchObject({ count: 1, excluded: 1 })
  }, 240000)
})

// The report documents: requested, processed, downloaded.
async function report(ctx, p, agent, typeKey, format = 'csv', options = {}, status = 202) {
  const res = expectStatus(await agent.post(`${p.base}/documents`).send({ typeKey, format, options }), status)
  if (status !== 202) return res
  await ctx.app.__documents.process()
  const doc = (await get(agent, `${p.base}/documents/${res.body.document.id}`)).document
  expect(doc.status, doc.error).toBe('ready')
  const bytes = (await binary(agent.get(`${p.base}/documents/${doc.id}/download`)).expect(200)).body
  return { doc, bytes, text: format === 'xlsx' ? XLSX.read(bytes).SheetNames.map((n) => XLSX.utils.sheet_to_csv(XLSX.read(bytes).Sheets[n])).join('\n') : bytes.toString('utf8') }
}

describe('The seven standard reports in the document engine (v2.2 §21.9)', () => {
  it('each is generated as CSV and Excel with the requester’s scope: a scoped PM’s report has no out-of-scope building', async () => {
    const ctx = t()
    const p = await team(ctx)
    for (const r of REPORTS) {
      const all = await report(ctx, p, p.pm, r.key, 'csv')
      expect(all.doc).toMatchObject({ typeKey: r.key, format: 'csv', buildingId: null })
      expect(all.text, r.key).toMatch(/Covers 3 building\(s\) — the whole project/)
      const muc = await report(ctx, p, p.pmMuc, r.key, 'csv')
      expect(muc.text, r.key).toMatch(/Covers 1 building\(s\) — the buildings in your scope/)
      expect(muc.text, r.key).not.toMatch(/B001|B002/)
      const fe = await report(ctx, p, p.feB001, r.key === 'resource-utilisation' ? 'weekly-status' : r.key, 'xlsx')
      expect(fe.text, r.key).not.toMatch(/B002|B101/)
    }
    // Every format of the engine for a report (PDF is rendered in api.m7a3-pdf.test.js).
    expect((await get(p.pm, `${p.base}/documents`)).types.filter((x) => REPORTS.some((r) => r.key === x.key)).map((x) => [x.scope, x.formats.join()])).toEqual(REPORTS.map(() => ['project', 'pdf,csv,xlsx']))
    // Scope: the weekly status lists the PM's buildings; the MUC PM's lists B101 only.
    expect((await report(ctx, p, p.pm, 'weekly-status', 'xlsx')).text).toMatch(/B001[\s\S]*B002[\s\S]*B101/)
    expect((await report(ctx, p, p.pmMuc, 'weekly-status', 'xlsx')).text).toMatch(/B101/)
  }, 300000)

  it('figures per person only for the Org Admin and PM; BOM Summary prices by the price rules; cost only in internal documents; each report its requester’s own', async () => {
    const ctx = t()
    const p = await team(ctx)
    // Resource Utilisation: 403 for every other role.
    for (const k of ['architect', 'reviewer', 'fe', 'viewer']) expectStatus(await p[k].post(`${p.base}/documents`).send({ typeKey: 'resource-utilisation', format: 'csv' }), 403)
    const util = await report(ctx, p, p.pm, 'resource-utilisation', 'csv')
    expect(util.text).toMatch(/Resource Utilisation Report[\s\S]*Person,Role,Buildings with work/)
    // Survey Progress: "By technician" only in the Org Admin's and PM's copy.
    await col('surveytabrecords').updateMany({ projectId: oid(p.projectId) }, { $set: { submitted: { at: new Date(), by: oid(p.ids.fe) } } })
    expect((await report(ctx, p, p.pm, 'survey-progress', 'csv')).text).toMatch(/Technicians\r\nTechnician,Submitted,Verified[\s\S]*field_engineer/)
    for (const k of ['viewer', 'architect']) expect((await report(ctx, p, p[k], 'survey-progress', 'csv')).text).not.toMatch(/By technician|Technician/)

    // BOM Summary: no prices for anyone by default; client price only for those who may see prices.
    const plain = await report(ctx, p, p.viewer, 'bom-summary', 'csv')
    expect(plain.text).toMatch(/B001/)
    expect(plain.text).not.toMatch(/Value|EUR/)
    expect(plain.text).not.toMatch(/price|cost/i)
    for (const k of ['viewer', 'architect', 'fe']) expectStatus(await p[k].post(`${p.base}/documents`).send({ typeKey: 'bom-summary', format: 'csv', options: { prices: 'sell' } }), 403)
    const sell = await report(ctx, p, p.reviewer, 'bom-summary', 'csv', { prices: 'sell' })
    expect(sell.text).toMatch(/Value — client price \(EUR\)/)
    expect(sell.text).not.toMatch(/cost/i)
    // Cost prices: internal documents only — Org Admin, PM, Reviewer; marked on the first row.
    expectStatus(await p.architect.post(`${p.base}/documents`).send({ typeKey: 'bom-summary', format: 'csv', options: { prices: 'cost' } }), 403)
    const cost = await report(ctx, p, p.pm, 'bom-summary', 'csv', { prices: 'cost' })
    expect(cost.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('INTERNAL — cost prices')
    const costXlsx = await report(ctx, p, p.pm, 'bom-summary', 'xlsx', { prices: 'cost' })
    expect(costXlsx.text.split('\n')[0]).toMatch(/INTERNAL — cost prices/)
    // A cost report never reaches a client: no download link takes a project-level document.
    expectStatus(await p.pm.post(`${p.base}/documents/share-links`).send({ buildingId: p.b001, documentIds: [cost.doc.id] }), 404)
    // Architects allowed to see prices may ask for the client price, still not cost.
    expectStatus(await p.admin.agent.patch(`${p.org}/settings`).send({ architectsSeePrices: true }), 200)
    expect((await report(ctx, p, p.architect, 'bom-summary', 'csv', { prices: 'sell' })).text).toMatch(/client price/)

    // Each report is its requester's own: not listed, not opened or downloaded by anyone else — the Org Admin included.
    for (const agent of [p.admin.agent, p.reviewer, p.pmMuc]) {
      expect((await get(agent, `${p.base}/documents`)).documents.map((d) => d.id)).not.toContain(util.doc.id)
      expectStatus(await agent.get(`${p.base}/documents/${util.doc.id}`), 404)
      expectStatus(await agent.get(`${p.base}/documents/${util.doc.id}/download`), 404)
    }
    expect((await get(p.pm, `${p.base}/documents?typeKey=resource-utilisation`)).documents.map((d) => d.id)).toContain(util.doc.id)
  }, 300000)
})

describe('Scheduled reports (v2.2 §21.9): members only, a sign-in link never the file, stopped when access goes, sent at local time', () => {
  const schedule = (p, body, agent = p.pm) => agent.post(`${p.base}/report-schedules`).send({ typeKey: 'weekly-status', format: 'csv', frequency: 'weekly', weekday: 1, time: '07:00', ...body })
  const outbox = async (p) => col('emailoutboxes').find({ organisationId: oid(p.admin.orgId), kind: 'report' }).sort({ createdAt: 1 }).toArray()

  it('recipients are active members with access chosen by id: a non-member, a free-text email, a revoked member or someone not allowed the report is refused', async () => {
    const ctx = t()
    const p = await team(ctx)
    const ok = expectStatus(await schedule(p, { recipientIds: [p.ids.viewer, p.ids.feB001, p.admin.userId] }), 201).body.schedule
    expect(ok.recipients.map((r) => r.userId).sort()).toEqual([p.ids.viewer, p.ids.feB001, p.admin.userId].sort())
    expect(ok).toMatchObject({ description: 'Weekly on Monday at 07:00', nextOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    // Another organisation's user, an unknown id, a free-text address.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    for (const recipientIds of [[other.userId], [new mongoose.Types.ObjectId().toString()], [p.ids.viewer, other.userId]]) {
      expect(expectStatus(await schedule(p, { recipientIds }), 400).body.error.message).toMatch(/active member of this organisation with access to this project/)
    }
    expectStatus(await schedule(p, { recipientIds: [p.ids.viewer], emails: ['someone@example.com'] }), 400)
    expectStatus(await schedule(p, { recipientIds: ['someone@example.com'] }), 400)
    expectStatus(await schedule(p, { recipientIds: [] }), 400)
    // A member of another project of this organisation has no access to this one.
    const second = (await p.admin.agent.post(`${p.org}/projects`).send({ name: 'Second', code: 'SEC' }).expect(201)).body.project
    const outsider = await projectMember(ctx, p.admin, { email: 'outsider@example.com', role: 'viewer', projectId: second.id })
    expectStatus(await schedule(p, { recipientIds: [await me(outsider)] }), 400)
    // Someone who may not receive this report: figures per person, prices.
    expect(expectStatus(await schedule(p, { typeKey: 'resource-utilisation', recipientIds: [p.ids.viewer] }), 400).body.error.message).toMatch(/cannot receive this report/)
    expectStatus(await schedule(p, { typeKey: 'bom-summary', prices: 'sell', recipientIds: [p.ids.architect] }), 400)
    expectStatus(await schedule(p, { typeKey: 'bom-summary', prices: 'cost', recipientIds: [p.ids.reviewer, p.ids.pm] }), 201)
    // A weekly schedule needs its weekday; a monthly one its day.
    expectStatus(await p.pm.post(`${p.base}/report-schedules`).send({ typeKey: 'weekly-status', format: 'csv', frequency: 'monthly', recipientIds: [p.ids.viewer] }), 400)
    // The recipients list: Org Admins and members of this project, never the outsider.
    const list = (await get(p.pm, `${p.base}/report-schedules/recipients`)).recipients
    expect(list.map((r) => r.userId)).toEqual(expect.arrayContaining([p.ids.viewer, p.ids.fe, p.admin.userId]))
    expect(list.map((r) => r.userId)).not.toContain(await me(outsider))
    // A revoked member is refused from then on.
    const m = await col('memberships').findOne({ userId: oid(p.ids.fe), projectId: oid(p.projectId), active: true })
    expectStatus(await p.admin.agent.delete(`${p.org}/memberships/${m._id}`), 200)
    expectStatus(await schedule(p, { recipientIds: [p.ids.fe] }), 400)
    // Changing the price mode re-checks everyone; so does adding a recipient.
    const bom = expectStatus(await schedule(p, { typeKey: 'bom-summary', recipientIds: [p.ids.viewer] }), 201).body.schedule
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${bom.id}`).send({ prices: 'sell' }), 400)
    const cost = (await get(p.pm, `${p.base}/report-schedules`)).schedules.find((s) => s.prices === 'cost')
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${cost.id}`).send({ recipientIds: [p.ids.reviewer, p.ids.viewer] }), 400)
    // The report type is fixed once scheduled (a different report is a new schedule).
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${ok.id}`).send({ typeKey: 'bom-summary' }), 400)
    // Audited.
    expect(await col('auditentries').countDocuments({ action: 'report_schedule.created' })).toBe(3)
  }, 240000)

  it('sent once at the organisation’s local time (Berlin across DST, then New York); each recipient’s own report in their scope; the email links to it and carries no file; the link needs sign-in', async () => {
    const ctx = t()
    const p = await team(ctx)
    const s = expectStatus(await schedule(p, { recipientIds: [p.ids.feB001, p.ids.pmMuc, p.ids.viewer] }), 201).body.schedule
    const documents = ctx.app.__documents
    // Monday 2026-10-19 (CEST, UTC+2): 07:00 local is 05:00Z.
    expect(await sendScheduledReports({ now: new Date('2026-10-19T04:59:00Z'), documents })).toMatchObject({ schedules: 0, reports: 0 })
    expect(await sendScheduledReports({ now: new Date('2026-10-19T05:00:00Z'), documents })).toMatchObject({ schedules: 1, reports: 3 })
    expect(await sendScheduledReports({ now: new Date('2026-10-19T05:15:00Z'), documents })).toMatchObject({ schedules: 0, reports: 0 })
    // Tuesday: not its day.
    expect(await sendScheduledReports({ now: new Date('2026-10-20T06:00:00Z'), documents })).toMatchObject({ schedules: 0 })
    // Monday 2026-10-26 (CET, UTC+1 after the change): 07:00 local is 06:00Z, not 05:00Z.
    expect(await sendScheduledReports({ now: new Date('2026-10-26T05:30:00Z'), documents })).toMatchObject({ schedules: 0 })
    expect(await sendScheduledReports({ now: new Date('2026-10-26T06:00:00Z'), documents })).toMatchObject({ schedules: 1, reports: 3 })

    const mails = await outbox(p)
    expect(mails).toHaveLength(6)
    await documents.process()
    for (const mail of mails) {
      // A sign-in link to the recipient's own copy; never the file.
      const m = mail.text.match(/http:\/\/localhost:5173\/orgs\/([a-f0-9]+)\/projects\/([a-f0-9]+)\/reports\?document=([a-f0-9]{24})/)
      expect(m, mail.text).not.toBeNull()
      expect(mail.text).toMatch(/sign-in required/)
      // None of the report's content is in the email.
      expect(mail.text).not.toMatch(/Covers \d|Current phase|Open blockers|B00\d|B101/)
      expect(Object.keys(mail)).not.toContain('attachments')
      const doc = await col('generateddocuments').findOne({ _id: oid(m[3]) })
      expect(String(doc.requestedBy)).toBe(String(mail.userId))
    }
    // Each copy in its recipient's scope: the B001 Field Engineer's has B001 only, the MUC PM's B101 only.
    const docOf = async (agent, userId) => {
      const mail = mails.find((x) => String(x.userId) === userId)
      const id = mail.text.match(/document=([a-f0-9]{24})/)[1]
      return (await binary(agent.get(`${p.base}/documents/${id}/download`)).expect(200)).body.toString('utf8')
    }
    const feText = await docOf(p.feB001, p.ids.feB001)
    expect(feText).toMatch(/B001/)
    expect(feText).not.toMatch(/B002|B101/)
    const mucText = await docOf(p.pmMuc, p.ids.pmMuc)
    expect(mucText).toMatch(/B101/)
    expect(mucText).not.toMatch(/B001|B002/)
    // The link needs sign-in: signed out 401; another member (the Org Admin too) 404.
    const id = mails[0].text.match(/document=([a-f0-9]{24})/)[1]
    expectStatus(await ctx.agent().get(`${p.base}/documents/${id}/download`), 401)
    expectStatus(await ctx.agent().get(`${p.base}/documents/${id}`), 401)
    for (const agent of [p.admin.agent, p.pm]) expectStatus(await agent.get(`${p.base}/documents/${id}/download`), 404)
    // The outbox sends the text as it is: no attachment reaches the mailer.
    await deliverOutbox({ mailer: ctx.mailer, now: new Date() })
    const sent = ctx.mailer.sent.filter((x) => /scheduled Weekly Status report/.test(x.text))
    expect(sent).toHaveLength(6)
    for (const x of sent) expect(Object.keys(x).sort()).toEqual(['subject', 'text', 'to'])

    // New York: Monday 2026-11-02 (EST, UTC−5) at 07:00 local is 12:00Z.
    expectStatus(await p.admin.agent.patch(`${p.org}/settings`).send({ timeZone: 'America/New_York' }), 200)
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${s.id}`).send({ time: '07:00' }), 200)
    expect(await sendScheduledReports({ now: new Date('2026-11-02T06:00:00Z'), documents })).toMatchObject({ schedules: 0 })
    expect(await sendScheduledReports({ now: new Date('2026-11-02T11:59:00Z'), documents })).toMatchObject({ schedules: 0 })
    expect(await sendScheduledReports({ now: new Date('2026-11-02T12:00:00Z'), documents })).toMatchObject({ schedules: 1, reports: 3 })
    // Paused: nothing.
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${s.id}`).send({ paused: true }), 200)
    expect(await sendScheduledReports({ now: new Date('2026-11-09T12:00:00Z'), documents })).toMatchObject({ schedules: 0 })
  }, 300000)

  it('a recipient who loses access is stopped for good (audited); the others still receive it; re-adding them after access is back starts them again', async () => {
    const ctx = t()
    const p = await team(ctx)
    const documents = ctx.app.__documents
    const s = expectStatus(await schedule(p, { typeKey: 'survey-progress', recipientIds: [p.ids.viewer, p.ids.fe, p.ids.pm] }), 201).body.schedule
    expect(await sendScheduledReports({ now: new Date('2026-10-26T06:00:00Z'), documents })).toMatchObject({ reports: 3, stopped: 0 })
    // The Viewer's membership is revoked; the PM becomes a Viewer (survey progress is still allowed).
    const m = await col('memberships').findOne({ userId: oid(p.ids.viewer), projectId: oid(p.projectId), active: true })
    expectStatus(await p.admin.agent.delete(`${p.org}/memberships/${m._id}`), 200)
    expect(await sendScheduledReports({ now: new Date('2026-11-02T06:00:00Z'), documents })).toMatchObject({ reports: 2, stopped: 1 })
    let view = (await get(p.pm, `${p.base}/report-schedules`)).schedules.find((x) => x.id === s.id)
    expect(view.recipients.find((r) => r.userId === p.ids.viewer)).toMatchObject({ stopped: true, stopReason: 'access_removed' })
    expect(view.recipients.filter((r) => !r.stopped).map((r) => r.userId).sort()).toEqual([p.ids.fe, p.ids.pm].sort())
    expect(await col('auditentries').countDocuments({ action: 'report_schedule.recipient_stopped' })).toBe(1)
    // Stopped for good: even with access back, nothing until someone re-adds them.
    await projectMember(ctx, p.admin, { email: 'viewer2@example.com', role: 'viewer', projectId: p.projectId })
    await col('memberships').updateOne({ _id: m._id }, { $set: { active: true, revokedAt: null } })
    expect(await sendScheduledReports({ now: new Date('2026-11-09T06:00:00Z'), documents })).toMatchObject({ reports: 2, stopped: 0 })
    const mails = (await outbox(p)).filter((x) => String(x.userId) === p.ids.viewer)
    expect(mails).toHaveLength(1)
    expectStatus(await p.pm.patch(`${p.base}/report-schedules/${s.id}`).send({ recipientIds: [p.ids.viewer, p.ids.fe, p.ids.pm] }), 200)
    view = (await get(p.pm, `${p.base}/report-schedules`)).schedules.find((x) => x.id === s.id)
    expect(view.recipients.every((r) => !r.stopped)).toBe(true)
    expect(await sendScheduledReports({ now: new Date('2026-11-16T06:00:00Z'), documents })).toMatchObject({ reports: 3 })
    // A recipient whose role no longer allows the report is stopped too (not_allowed).
    const util = expectStatus(await schedule(p, { typeKey: 'resource-utilisation', recipientIds: [p.ids.pm] }), 201).body.schedule
    await col('memberships').updateOne({ userId: oid(p.ids.pm), projectId: oid(p.projectId), active: true }, { $set: { role: 'viewer' } })
    expect(await sendScheduledReports({ now: new Date('2026-11-23T06:00:00Z'), documents })).toMatchObject({ stopped: 1 })
    view = (await get(p.admin.agent, `${p.base}/report-schedules`)).schedules.find((x) => x.id === util.id)
    expect(view.recipients[0]).toMatchObject({ stopped: true, stopReason: 'not_allowed' })
  }, 300000)
})
