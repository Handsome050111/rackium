import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { localDate, addDays } from '@rackium/shared/timeZone.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember } from './helpers/app.js'
import { surveyProject } from './helpers/survey.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { scheduleAlerts, backfillPhaseHistory } from '../src/schedule/service.js'
import { forEachProject } from '../src/notifications/jobs.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { PhaseHistory } from '../src/models/phaseHistory.js'

// M7a-1: the schedule — targets, Gantt bars and risk, milestones, cross-building
// dependencies, SLAs, alerts and the phase history (DATA-MODEL §5.10 as built).
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
const today = () => localDate(new Date(), 'Europe/Berlin')
const day = (n) => addDays(today(), n)

function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}

// B001, B002 (SAL ERL) and B101 (SAL MUC); CMO, survey, HLD and LLD active;
// a PM and a Viewer scoped to B001.
async function project(ctx = t()) {
  const p = await surveyProject(ctx)
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld'] }).expect(200)
  p.ctx = ctx
  p.s = `${p.base}/schedule`
  p.b1 = p.building('B001').id
  p.b2 = p.building('B002').id
  p.b101 = p.building('B101').id
  p.pmB001 = await projectMember(ctx, p.admin, { email: 'pm-b001@example.com', role: 'pm', projectId: p.projectId, scopes: [{ type: 'building', refId: p.b1 }] })
  p.viewerB001 = await projectMember(ctx, p.admin, { email: 'viewer-b001@example.com', role: 'viewer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.b1 }] })
  p.view = async (agent = p.admin.agent) => (await agent.get(p.s).expect(200)).body
  p.bar = (view, buildingId, phaseKey) => view.bars.find((b) => b.buildingId === buildingId && b.phaseKey === phaseKey)
  return p
}
const cmoRow = (i, fields) => ({ rowIndex: i, hostname: null, vendor: null, model: 'C9300', serial: null, mac: null, building: null, floor: null, room: null, rack: null, ru: null, ...fields })

describe('Phase targets (v2.2 §21.1)', () => {
  it('the Org Admin and PM set start and target dates (local, audited per building); others cannot; a scoped PM only within scope', async () => {
    const p = await project()
    const res = expectStatus(await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', startDate: day(-10), targetDate: day(10) }, { buildingId: p.b1, phaseKey: 'hld', targetDate: day(30) }, { buildingId: p.b2, phaseKey: 'survey', targetDate: day(5) }] }), 200)
    expect(res.body.updated).toBe(3)
    for (const agent of [p.architect, p.fe, p.viewer]) expectStatus(await agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', targetDate: day(1) }] }), 403)
    expectStatus(await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', targetDate: '2026-02-30' }] }), 400)
    expectStatus(await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'bom', targetDate: day(1) }] }), 400)
    expectStatus(await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', startDate: day(3), targetDate: day(1) }] }), 400)
    // A PM scoped to B001: B001 yes, B002 is not found.
    expectStatus(await p.pmB001.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', targetDate: day(12) }] }), 200)
    expectStatus(await p.pmB001.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b2, phaseKey: 'survey', targetDate: day(12) }] }), 404)
    const audits = await col('auditentries').find({ action: 'schedule.targets.updated' }).sort({ occurredAt: 1 }).toArray()
    expect(audits.map((a) => a.changes.map((c) => [c.field, c.before, c.after]))).toEqual([
      [['survey.startDate', null, day(-10)], ['survey.targetDate', null, day(10)], ['hld.targetDate', null, day(30)]],
      [['survey.targetDate', null, day(5)]],
      [['survey.targetDate', day(10), day(12)]],
    ])
    // The bars: HLD starts at the survey target; the scoped PM sees B001 only.
    const view = await p.view()
    expect(p.bar(view, p.b1, 'hld')).toMatchObject({ start: day(12), target: day(30), startDate: null, risk: 'on_track' })
    expect((await p.view(p.pmB001)).buildings.map((b) => b.code)).toEqual(['B001'])
  })
})

describe('Gantt: risk, dependencies and the critical path (v2.2 §21.2, §21.4, §21.7)', () => {
  it('overdue and at-risk bars; a cross-building dependency (no loops, not the same building, both in scope) blocks and sets the critical path', async () => {
    const p = await project()
    // The survey runs alongside the CMO here (otherwise it waits for it: blocked).
    await p.admin.agent.put(`${p.s}/settings`).send({ parallelPhases: ['survey'] }).expect(200)
    await p.admin.agent.put(`${p.s}/targets`).send({ targets: [
      { buildingId: p.b1, phaseKey: 'survey', startDate: day(-20), targetDate: day(-1) },
      { buildingId: p.b1, phaseKey: 'hld', targetDate: day(40) },
      { buildingId: p.b2, phaseKey: 'survey', startDate: day(-9), targetDate: day(1) },
      { buildingId: p.b2, phaseKey: 'hld', startDate: day(-5), targetDate: day(60) },
    ] }).expect(200)
    let view = await p.view()
    expect(p.bar(view, p.b1, 'survey').risk).toBe('overdue')
    // 9 of 10 days used, nothing done: at risk.
    expect(p.bar(view, p.b2, 'survey').risk).toBe('at_risk')
    const dep = (from, to) => ({ from, to })
    const created = expectStatus(await p.admin.agent.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b1, phaseKey: 'hld' }, { buildingId: p.b2, phaseKey: 'hld' })), 201).body.dependency
    expect((await p.admin.agent.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b1, phaseKey: 'hld' }, { buildingId: p.b2, phaseKey: 'hld' })).expect(409)).body.error.code).toBe('dependency_exists')
    expect((await p.admin.agent.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b2, phaseKey: 'hld' }, { buildingId: p.b1, phaseKey: 'survey' })).expect(409)).body.error.code).toBe('dependency_cycle')
    expectStatus(await p.admin.agent.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b1, phaseKey: 'cmo' }, { buildingId: p.b1, phaseKey: 'lld' })), 400)
    expectStatus(await p.pmB001.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b1, phaseKey: 'cmo' }, { buildingId: p.b2, phaseKey: 'lld' })), 404)
    expectStatus(await p.architect.post(`${p.s}/dependencies`).send(dep({ buildingId: p.b1, phaseKey: 'cmo' }, { buildingId: p.b2, phaseKey: 'lld' })), 403)
    view = await p.view()
    const b2hld = p.bar(view, p.b2, 'hld')
    expect(b2hld.predecessors).toContain(`${p.b1}|hld`)
    // B002 HLD should have started; B001 HLD is not done: blocked.
    expect(b2hld.risk).toBe('blocked')
    expect(view.critical[0]).toBe(`${p.b2}|hld`)
    expect(view.end).toBe(day(60))
    // A B001-only viewer does not see a dependency reaching B002.
    expect((await p.view(p.viewerB001)).dependencies).toEqual([])
    expectStatus(await p.pmB001.delete(`${p.s}/dependencies/${created.id}`), 404)
    expectStatus(await p.admin.agent.delete(`${p.s}/dependencies/${created.id}`), 200)
    expect((await col('auditentries').find({ action: { $in: ['schedule.dependency.created', 'schedule.dependency.deleted'] } }).toArray()).map((a) => a.action)).toEqual(['schedule.dependency.created', 'schedule.dependency.deleted'])
  })

  it('parallel phases and risk thresholds are settings of the unscoped PM or Org Admin', async () => {
    const p = await project()
    expectStatus(await p.pmB001.put(`${p.s}/settings`).send({ parallelPhases: ['hld'] }), 403)
    expectStatus(await p.admin.agent.put(`${p.s}/settings`).send({ parallelPhases: ['bom'] }), 400)
    expect(expectStatus(await p.admin.agent.put(`${p.s}/settings`).send({ parallelPhases: ['hld'], riskElapsedPct: 60 }), 200).body.settings).toEqual({ riskElapsedPct: 60, riskProgressPct: 50, parallelPhases: ['hld'] })
    const view = await p.view()
    expect(p.bar(view, p.b1, 'hld').predecessors).toEqual([])
    expect(await col('auditentries').countDocuments({ action: 'schedule.settings.updated' })).toBe(1)
  })
})

describe('Milestones (v2.2 §21.3)', () => {
  it('standard milestones from the phase targets (movable), custom ones per building or project; the dashboard shows the next; scope applies', async () => {
    const p = await project()
    await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', targetDate: day(20) }, { buildingId: p.b1, phaseKey: 'hld', targetDate: day(40) }] }).expect(200)
    let view = await p.view()
    const b1 = view.milestones.filter((m) => m.buildingId === p.b1)
    expect(b1.map((m) => [m.standardKey, m.dueDate])).toEqual([['survey_complete', day(20)], ['hld_approved', day(40)], ['lld_approved', null]])
    expectStatus(await p.admin.agent.put(`${p.s}/milestones/standard`).send({ buildingId: p.b1, standardKey: 'hld_approved', dueDate: day(35) }), 200)
    const kickoff = expectStatus(await p.admin.agent.post(`${p.s}/milestones`).send({ name: 'Kick-off on site', dueDate: day(7) }), 201).body.milestone
    expectStatus(await p.admin.agent.post(`${p.s}/milestones`).send({ buildingId: p.b2, name: 'B002 access granted', dueDate: day(3) }), 201)
    // The scoped PM: no project-wide milestone; B002 not found.
    expectStatus(await p.pmB001.post(`${p.s}/milestones`).send({ name: 'Whole project', dueDate: day(9) }), 403)
    expectStatus(await p.pmB001.post(`${p.s}/milestones`).send({ buildingId: p.b2, name: 'Other', dueDate: day(9) }), 404)
    view = await p.view()
    expect(view.milestones.find((m) => m.standardKey === 'hld_approved' && m.buildingId === p.b1).dueDate).toBe(day(35))
    expect(view.next.name).toBe('B002 access granted')
    // B001's dashboard: the project-wide kick-off is next for it.
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b1}`).expect(200)).body
    expect(dash.nextMilestone).toEqual({ name: 'Kick-off on site', dueDate: day(7), buildingId: null })
    // A B001-only viewer sees the project-wide and B001's, not B002's.
    expect((await p.view(p.viewerB001)).milestones.filter((m) => m.custom).map((m) => m.name)).toEqual(['Kick-off on site'])
    expectStatus(await p.admin.agent.patch(`${p.s}/milestones/${kickoff.id}`).send({ completedOn: day(0) }), 200)
    expect((await p.view()).milestones.find((m) => m.id === kickoff.id)).toMatchObject({ done: true, doneOn: day(0) })
    expectStatus(await p.admin.agent.delete(`${p.s}/milestones/${kickoff.id}`), 200)
    expect((await col('auditentries').find({ action: /^schedule\.milestone\./ }).toArray()).map((a) => a.action)).toEqual(['schedule.milestone.updated', 'schedule.milestone.created', 'schedule.milestone.created', 'schedule.milestone.updated', 'schedule.milestone.deleted'])
  })
})

describe('SLAs and alerts (v2.2 §21.8)', () => {
  it('status, projection and burn-down over the caller’s scope; created by the Org Admin or PM; alerts once: overdue phase → PM and primary person, SLA at risk → PM, breached → PM and the Org Admins', async () => {
    const p = await project()
    const pm2 = await projectMember(p.ctx, p.admin, { email: 'pm2@example.com', role: 'pm', projectId: p.projectId })
    const orgAdmin2 = await projectMember(p.ctx, p.admin, { email: 'admin2@example.com', role: 'org_admin' })
    const userId = async (agent) => (await agent.get('/api/v1/me').expect(200)).body.user.id
    const ids = { admin: p.admin.userId, pm2: await userId(pm2), pmB001: await userId(p.pmB001), admin2: await userId(orgAdmin2), fe: await userId(p.fe), architect: await userId(p.architect) }
    // B001's primary Field Engineer gets B001's overdue survey too.
    expectStatus(await p.admin.agent.patch(`${p.s}/buildings/${p.b1}/assignees`).send({ primaryFieldEngineerId: ids.architect }), 400)
    expectStatus(await p.admin.agent.patch(`${p.s}/buildings/${p.b1}/assignees`).send({ primaryFieldEngineerId: ids.fe, primaryArchitectId: ids.architect }), 200)
    await p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', startDate: day(-30), targetDate: day(-2) }] }).expect(200)
    const breached = expectStatus(await p.admin.agent.post(`${p.s}/slas`).send({ name: 'Survey contract', phaseKey: 'survey', startDate: day(-30), dueDate: day(-1) }), 201).body.sla
    const atRisk = expectStatus(await p.admin.agent.post(`${p.s}/slas`).send({ name: 'B001 design', buildingId: p.b1, phaseKey: 'hld', startDate: day(-20), dueDate: day(10) }), 201).body.sla
    expectStatus(await p.pmB001.post(`${p.s}/slas`).send({ name: 'Project-wide', dueDate: day(10) }), 403)
    expectStatus(await p.admin.agent.post(`${p.s}/slas`).send({ name: 'Backwards', startDate: day(2), dueDate: day(1) }), 400)
    const view = await p.view()
    expect(view.slas.map((s) => [s.name, s.status, s.total, s.remaining])).toEqual([['Survey contract', 'breached', 3, 3], ['B001 design', 'at_risk', 1, 1]])
    // The B001 viewer: the project-wide SLA over their building only, marked.
    expect((await p.view(p.viewerB001)).slas.map((s) => [s.name, s.total, s.scopeLimited])).toEqual([['Survey contract', 1, true], ['B001 design', 1, false]])
    const burn = (await p.admin.agent.get(`${p.s}/slas/${breached.id}/burndown`).expect(200)).body
    expect(burn.series[0]).toEqual({ date: day(-30), ideal: 3, actual: 3 })
    expect(burn.series.at(-1)).toMatchObject({ date: day(0), ideal: 0, actual: 3 })

    const notes = async () => (await col('notifications').find({ type: { $in: ['phase_overdue', 'sla_at_risk', 'sla_breached'] } }).toArray()).map((n) => [n.type, String(n.recipientId)])
    expect(await runAlerts()).toEqual({ phaseOverdue: 1, slaAtRisk: 1, slaBreached: 1 })
    const first = await notes()
    const to = (type) => first.filter((n) => n[0] === type).map((n) => n[1]).sort()
    // B001's PMs (the unscoped ones and the one scoped to B001) and its primary Field Engineer.
    expect(to('phase_overdue')).toEqual([ids.admin, ids.pm2, ids.pmB001, ids.fe].sort())
    expect(to('sla_at_risk')).toEqual([ids.admin, ids.pm2, ids.pmB001].sort())
    // Project-wide: every PM in the project, and the Org Admins (one not a project member).
    expect(to('sla_breached')).toEqual([ids.admin, ids.pm2, ids.pmB001, ids.admin2].sort())
    // Once only.
    expect(await runAlerts()).toEqual({ phaseOverdue: 0, slaAtRisk: 0, slaBreached: 0 })
    expect((await notes()).length).toBe(first.length)
    // A new due date re-arms them; edits and deletes are audited.
    expectStatus(await p.admin.agent.patch(`${p.s}/slas/${atRisk.id}`).send({ dueDate: day(11) }), 200)
    expect((await runAlerts()).slaAtRisk).toBe(1)
    expectStatus(await p.admin.agent.delete(`${p.s}/slas/${breached.id}`), 200)
    expect((await col('auditentries').find({ action: /^schedule\.sla\./ }).toArray()).map((a) => a.action)).toEqual(['schedule.sla.created', 'schedule.sla.created', 'schedule.sla.updated', 'schedule.sla.deleted'])
    expect(await col('auditentries').countDocuments({ action: 'building.assignees.updated' })).toBe(1)
  })

  it("deadlines follow the organisation's time zone, also across DST: breached from local midnight (Berlin autumn and spring, New York)", async () => {
    const p = await project()
    const breaches = async (iso) => (await scheduleAlerts({ now: new Date(iso), forEachProject })).slaBreached
    const breachedAt = async (name) => (await col('slas').findOne({ name })).breachedNotifiedAt
    await p.admin.agent.post(`${p.s}/slas`).send({ name: 'Autumn', startDate: '2026-10-01', dueDate: '2026-10-25' }).expect(201)
    expect(await breaches('2026-10-25T22:59:00Z')).toBe(0) // 23:59 CET on the due day
    expect(await breaches('2026-10-25T23:00:00Z')).toBe(1) // 00:00 CET the next day
    expect(await breachedAt('Autumn')).toEqual(new Date('2026-10-25T23:00:00Z'))
    await p.admin.agent.post(`${p.s}/slas`).send({ name: 'Spring', startDate: '2027-03-01', dueDate: '2027-03-28' }).expect(201)
    expect(await breaches('2027-03-28T21:59:00Z')).toBe(0) // 23:59 CEST
    expect(await breaches('2027-03-28T22:00:00Z')).toBe(1)
    expect(await breachedAt('Spring')).toEqual(new Date('2027-03-28T22:00:00Z'))
    // The same rule in another zone.
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ timeZone: 'America/New_York' }).expect(200)
    await p.admin.agent.post(`${p.s}/slas`).send({ name: 'New York', startDate: '2026-10-01', dueDate: '2026-10-25' }).expect(201)
    expect(await breaches('2026-10-26T03:59:00Z')).toBe(0) // 23:59 EDT
    expect(await breaches('2026-10-26T04:00:00Z')).toBe(1)
    expect(await breachedAt('New York')).toEqual(new Date('2026-10-26T04:00:00Z'))
    expect(await col('notifications').countDocuments({ type: 'sla_breached' })).toBeGreaterThan(0)
  })
})

async function runAlerts(now = new Date()) {
  return scheduleAlerts({ now, forEachProject })
}

describe('Phase history (append-only; live and backfill)', () => {
  it('records completions after tracking starts with their evidence date; earlier ones only by the idempotent backfill (derived, unknown when there is no evidence); reopenings; never edited', async () => {
    const p = await project()
    const salErl = p.sal('ERL').id
    const salMuc = p.sal('MUC').id
    // Before tracking: B001's and B101's CMO complete.
    await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: salErl, rows: [cmoRow(0, { hostname: 'SW-1', serial: 'S1', building: 'B001' })] }).expect(201)
    await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: salMuc, rows: [cmoRow(0, { hostname: 'SW-9', serial: 'S9', building: 'B101' })] }).expect(201)
    // B101's evidence is gone: the backfill must not invent a date.
    await col('auditentries').deleteMany({ action: 'cmo.import.committed', buildingId: new mongoose.Types.ObjectId(p.b101) })
    const rows = () => col('phasehistory').find({}).sort({ recordedAt: 1, _id: 1 }).toArray()
    let view = await p.view() // tracking starts here
    expect(await rows()).toEqual([])
    expect(p.bar(view, p.b1, 'cmo')).toMatchObject({ status: 'completed', risk: 'done', completedOn: null })
    // After tracking: B002's CMO completes → a live row with its evidence date.
    await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: salErl, rows: [cmoRow(0, { hostname: 'SW-2', serial: 'S2', building: 'B002' })] }).expect(201)
    view = await p.view()
    expect((await rows()).map((r) => [String(r.buildingId), r.phaseKey, r.event, r.source, r.dateKnown, r.evidence?.action])).toEqual([[p.b2, 'cmo', 'completed', 'live', true, 'cmo.import.committed']])
    expect(p.bar(view, p.b2, 'cmo').completedOn).toBe(today())
    // The backfill: B001 dated by its audit entry, B101 with no date; once.
    const run = () => backfillPhaseHistory({ forEachProject })
    expect((await run()).written).toBe(2)
    expect((await run()).written).toBe(0)
    const derived = (await rows()).filter((r) => r.source === 'derived').map((r) => [String(r.buildingId), r.dateKnown, r.on, r.evidence?.action ?? null])
    expect(derived).toEqual(expect.arrayContaining([[p.b1, true, today(), 'cmo.import.committed'], [p.b101, false, null, null]]))
    // An Unassigned device blocks ERL's buildings: their CMO is no longer done → reopened.
    await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: salErl, rows: [cmoRow(0, { hostname: 'SW-X', serial: 'SX' })] }).expect(201)
    await p.view()
    expect((await rows()).filter((r) => r.event === 'reopened').map((r) => String(r.buildingId)).sort()).toEqual([p.b1, p.b2].sort())
    // Append-only.
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => PhaseHistory.updateOne({}, { $set: { on: '2000-01-01' } }))).rejects.toThrow('append-only')
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => PhaseHistory.deleteMany({}))).rejects.toThrow('append-only')
  })
})
