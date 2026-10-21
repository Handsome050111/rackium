import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { localDate, localTime, addDays, startOfLocalDay } from '@rackium/shared/timeZone.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
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
// The instant a local day reaches a local clock time (DST-safe: searched minute by minute).
function localAt(date, hhmm, tz = 'Europe/Berlin') {
  const start = startOfLocalDay(date, tz).getTime()
  for (let k = 0; k < 26 * 60; k++) {
    const at = new Date(start + k * 60000)
    if (localDate(at, tz) === date && localTime(at, tz) === hhmm) return at
  }
  throw new Error(`${date} ${hhmm} does not exist in ${tz}`)
}

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
    // Sent at the organisation's local morning time (07:00 by default), not before.
    const at = (hhmm) => localAt(today(), hhmm)
    expect(await runAlerts(at('06:59'))).toEqual({ phaseOverdue: 0, slaAtRisk: 0, slaBreached: 0 })
    expect(await notes()).toEqual([])
    expect(await runAlerts(at('07:00'))).toEqual({ phaseOverdue: 1, slaAtRisk: 1, slaBreached: 1 })
    const first = await notes()
    // One notification per recipient and alert.
    expect(new Set(first.map((n) => n.join())).size).toBe(first.length)
    const to = (type) => first.filter((n) => n[0] === type).map((n) => n[1]).sort()
    // B001's PMs (the unscoped ones and the one scoped to B001) and its primary Field Engineer.
    expect(to('phase_overdue')).toEqual([ids.admin, ids.pm2, ids.pmB001, ids.fe].sort())
    expect(to('sla_at_risk')).toEqual([ids.admin, ids.pm2, ids.pmB001].sort())
    // Project-wide: every PM in the project, and the Org Admins (one not a project member).
    expect(to('sla_breached')).toEqual([ids.admin, ids.pm2, ids.pmB001, ids.admin2].sort())
    // Once only: the job runs again (every 15 minutes) and sends nothing more.
    expect(await runAlerts(at('07:15'))).toEqual({ phaseOverdue: 0, slaAtRisk: 0, slaBreached: 0 })
    expect(await runAlerts(at('23:45'))).toEqual({ phaseOverdue: 0, slaAtRisk: 0, slaBreached: 0 })
    expect(await notes()).toEqual(first)
    // A new due date re-arms them; edits and deletes are audited.
    expectStatus(await p.admin.agent.patch(`${p.s}/slas/${atRisk.id}`).send({ dueDate: day(11) }), 200)
    expect((await runAlerts(at('08:00'))).slaAtRisk).toBe(1)
    expectStatus(await p.admin.agent.delete(`${p.s}/slas/${breached.id}`), 200)
    expect((await col('auditentries').find({ action: /^schedule\.sla\./ }).toArray()).map((a) => a.action)).toEqual(['schedule.sla.created', 'schedule.sla.created', 'schedule.sla.updated', 'schedule.sla.deleted'])
    expect(await col('auditentries').countDocuments({ action: 'building.assignees.updated' })).toBe(1)
  })

  it("deadlines follow the organisation's time zone across DST: overdue / breached from local midnight, told at the local morning time (Berlin autumn and spring, New York, a later morning time)", async () => {
    const p = await project()
    const run = (iso) => scheduleAlerts({ now: new Date(iso), forEachProject })
    const breachedAt = async (name) => (await col('slas').findOne({ name })).breachedNotifiedAt
    const target = (buildingId, startDate, targetDate) => p.admin.agent.put(`${p.s}/targets`).send({ targets: [{ buildingId, phaseKey: 'hld', startDate, targetDate }] }).expect(200)
    const sla = (name, startDate, dueDate) => p.admin.agent.post(`${p.s}/slas`).send({ name, startDate, dueDate }).expect(201)

    // Berlin, autumn: CEST → CET on Sunday 2026-10-25. B001's HLD was due on the
    // 24th: overdue on the 25th (the DST day), told at 07:00 CET = 06:00Z.
    await target(p.b1, '2026-10-01', '2026-10-24')
    await sla('Autumn', '2026-10-01', '2026-10-25')
    expect((await run('2026-10-24T21:59:00Z')).phaseOverdue).toBe(0) // 23:59 CEST on the target day: not overdue
    expect((await run('2026-10-25T05:59:00Z')).phaseOverdue).toBe(0) // 06:59 CET: overdue, before the morning
    expect((await run('2026-10-25T06:00:00Z')).phaseOverdue).toBe(1) // 07:00 CET
    expect((await run('2026-10-25T21:59:00Z')).slaBreached).toBe(0) // 22:59 CET on the due day
    expect((await run('2026-10-25T23:00:00Z')).slaBreached).toBe(0) // 00:00 CET on the 26th: breached, still night
    expect((await run('2026-10-26T05:59:00Z')).slaBreached).toBe(0) // 06:59 CET
    expect((await run('2026-10-26T06:00:00Z')).slaBreached).toBe(1) // 07:00 CET
    expect(await breachedAt('Autumn')).toEqual(new Date('2026-10-26T06:00:00Z'))

    // Berlin, spring: CET → CEST on Sunday 2027-03-28. B002's HLD due on the
    // 27th: told at 07:00 CEST = 05:00Z on the DST day.
    await target(p.b2, '2027-03-01', '2027-03-27')
    await sla('Spring', '2027-03-01', '2027-03-28')
    expect((await run('2027-03-28T04:59:00Z')).phaseOverdue).toBe(0) // 06:59 CEST
    expect((await run('2027-03-28T05:00:00Z')).phaseOverdue).toBe(1) // 07:00 CEST
    expect((await run('2027-03-29T04:59:00Z')).slaBreached).toBe(0)
    expect((await run('2027-03-29T05:00:00Z')).slaBreached).toBe(1)
    expect(await breachedAt('Spring')).toEqual(new Date('2027-03-29T05:00:00Z'))

    // New York (EDT → EST on Sunday 2026-11-01): the organisation's own zone.
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ timeZone: 'America/New_York' }).expect(200)
    await sla('New York', '2026-10-01', '2026-10-25')
    expect((await run('2026-10-26T06:00:00Z')).slaBreached).toBe(0) // 07:00 in Berlin is 02:00 EDT
    expect((await run('2026-10-26T10:59:00Z')).slaBreached).toBe(0) // 06:59 EDT
    expect((await run('2026-10-26T11:00:00Z')).slaBreached).toBe(1) // 07:00 EDT
    expect(await breachedAt('New York')).toEqual(new Date('2026-10-26T11:00:00Z'))
    // B101's HLD due on 31 October: told at 07:00 EST = 12:00Z on the DST day.
    await target(p.b101, '2026-10-01', '2026-10-31')
    expect((await run('2026-11-01T11:59:00Z')).phaseOverdue).toBe(0) // 06:59 EST
    expect((await run('2026-11-01T12:00:00Z')).phaseOverdue).toBe(1) // 07:00 EST

    // A later morning time (the organisation's digest time) moves the alerts with it.
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ digestTime: '09:30' }).expect(200)
    await sla('Late morning', '2026-11-01', '2026-11-05')
    expect((await run('2026-11-06T14:29:00Z')).slaBreached).toBe(0) // 09:29 EST
    expect((await run('2026-11-06T14:30:00Z')).slaBreached).toBe(1) // 09:30 EST
    expect(await col('notifications').countDocuments({ type: 'sla_breached' })).toBeGreaterThan(0)
    expect(await col('notifications').countDocuments({ type: 'phase_overdue' })).toBeGreaterThan(0)
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
    const once = await rows()
    expect((await run()).written).toBe(0)
    expect(await rows()).toEqual(once) // no duplicates
    const derived = once.filter((r) => r.source === 'derived').map((r) => [String(r.buildingId), r.phaseKey, r.event, r.dateKnown, r.on, r.evidence?.action ?? null])
    expect(derived.sort()).toEqual([[p.b1, 'cmo', 'completed', true, today(), 'cmo.import.committed'], [p.b101, 'cmo', 'completed', false, null, null]].sort())
    // Shown as such: B001 dated, B101 done with an unknown date (nothing invented).
    view = await p.view()
    expect(p.bar(view, p.b1, 'cmo')).toMatchObject({ completedOn: today(), dateKnown: true })
    expect(p.bar(view, p.b101, 'cmo')).toMatchObject({ status: 'completed', completedOn: null, dateKnown: false })
    // An Unassigned device blocks ERL's buildings: their CMO is no longer done → reopened.
    await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: salErl, rows: [cmoRow(0, { hostname: 'SW-X', serial: 'SX' })] }).expect(201)
    await p.view()
    expect((await rows()).filter((r) => r.event === 'reopened').map((r) => String(r.buildingId)).sort()).toEqual([p.b1, p.b2].sort())
    // Append-only.
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => PhaseHistory.updateOne({}, { $set: { on: '2000-01-01' } }))).rejects.toThrow('append-only')
    await expect(runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => PhaseHistory.deleteMany({}))).rejects.toThrow('append-only')
  })
})

describe('Access to every schedule endpoint', () => {
  it('a wrong role gets 403; a PM scoped to B001 gets 404 for B002 and 403 for project-wide items; a non-member and another organisation get 404; refusals change and audit nothing', async () => {
    const p = await project()
    const ctx = p.ctx
    // What the calls act on: B002's and project-wide items, made by the Org Admin.
    const created = async (path, body, key) => expectStatus(await p.admin.agent.post(`${p.s}${path}`).send(body), 201).body[key].id
    const mB2 = await created('/milestones', { buildingId: p.b2, name: 'B002 keys', dueDate: day(5) }, 'milestone')
    const mP = await created('/milestones', { name: 'Project review', dueDate: day(6) }, 'milestone')
    const sB2 = await created('/slas', { name: 'B002 SLA', buildingId: p.b2, dueDate: day(20) }, 'sla')
    const sP = await created('/slas', { name: 'Project SLA', dueDate: day(20) }, 'sla')
    const dep = await created('/dependencies', { from: { buildingId: p.b1, phaseKey: 'cmo' }, to: { buildingId: p.b2, phaseKey: 'survey' } }, 'dependency')
    const audited = () => col('auditentries').countDocuments({ action: { $regex: '^(schedule\\.|building\\.assignees)' } })
    const auditsBefore = await audited()

    const buildingWrites = {
      'PUT targets': ['put', '/targets', { targets: [{ buildingId: p.b2, phaseKey: 'survey', targetDate: day(5) }] }],
      'PUT milestones/standard': ['put', '/milestones/standard', { buildingId: p.b2, standardKey: 'hld_approved', dueDate: day(9) }],
      'POST milestones': ['post', '/milestones', { buildingId: p.b2, name: 'New', dueDate: day(3) }],
      'PATCH milestones/:id': ['patch', `/milestones/${mB2}`, { name: 'Renamed' }],
      'DELETE milestones/:id': ['delete', `/milestones/${mB2}`],
      'POST dependencies': ['post', '/dependencies', { from: { buildingId: p.b1, phaseKey: 'hld' }, to: { buildingId: p.b2, phaseKey: 'lld' } }],
      'DELETE dependencies/:id': ['delete', `/dependencies/${dep}`],
      'POST slas': ['post', '/slas', { name: 'New SLA', buildingId: p.b2, dueDate: day(9) }],
      'PATCH slas/:id': ['patch', `/slas/${sB2}`, { name: 'Renamed' }],
      'DELETE slas/:id': ['delete', `/slas/${sB2}`],
      'PATCH buildings/:id/assignees': ['patch', `/buildings/${p.b2}/assignees`, { primaryArchitectId: null }],
    }
    const projectWrites = {
      'PUT settings': ['put', '/settings', { riskElapsedPct: 70 }],
      'POST milestones (project)': ['post', '/milestones', { name: 'New', dueDate: day(3) }],
      'PATCH milestones/:id (project)': ['patch', `/milestones/${mP}`, { name: 'Renamed' }],
      'DELETE milestones/:id (project)': ['delete', `/milestones/${mP}`],
      'POST slas (project)': ['post', '/slas', { name: 'New SLA', dueDate: day(9) }],
      'PATCH slas/:id (project)': ['patch', `/slas/${sP}`, { name: 'Renamed' }],
      'DELETE slas/:id (project)': ['delete', `/slas/${sP}`],
    }
    const reads = { 'GET schedule': ['get', ''], 'GET slas/:id/burndown': ['get', `/slas/${sB2}/burndown`] }
    const all = { ...buildingWrites, ...projectWrites, ...reads }
    const send = (agent, [method, path, body], base) => {
      const req = agent[method](`${base ?? p.s}${path}`)
      return body ? req.send(body) : req
    }
    const expectEach = async (who, agent, calls, status, base) => {
      for (const [name, call] of Object.entries(calls)) expect((await send(agent, call, base)).status, `${who}: ${name}`).toBe(status)
    }

    // Architect, Field Engineer, Viewer: no planning rights — every write 403; they read.
    for (const [who, agent] of [['architect', p.architect], ['field engineer', p.fe], ['viewer', p.viewer]]) {
      await expectEach(who, agent, { ...buildingWrites, ...projectWrites }, 403)
      await expectEach(who, agent, reads, 200)
    }
    // A PM scoped to B001: B002's items are not found; project-wide ones are forbidden.
    await expectEach('PM scoped to B001', p.pmB001, buildingWrites, 404)
    await expectEach('PM scoped to B001', p.pmB001, projectWrites, 403)
    // A Viewer scoped to B001 cannot read B002's SLA.
    await expectEach('Viewer scoped to B001', p.viewerB001, { 'GET slas/:id/burndown': reads['GET slas/:id/burndown'] }, 404)
    // A member of the organisation who is not in this project (a PM of another one).
    const second = expectStatus(await p.admin.agent.post(`/api/v1/orgs/${p.admin.orgId}/projects`).send({ name: 'Second', code: 'SEC' }), 201).body.project.id
    const outsider = await projectMember(ctx, p.admin, { email: 'pm-elsewhere@example.com', role: 'pm', projectId: second })
    await expectEach('non-member', outsider, all, 404)
    // Another organisation: this project's URLs, and its own project's URLs with these ids.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    await expectEach('other organisation', other.agent, all, 404)
    const foreign = expectStatus(await other.agent.post(`/api/v1/orgs/${other.orgId}/projects`).send({ name: 'Other', code: 'OTH' }), 201).body.project.id
    await expectEach('other organisation (own project)', other.agent, { ...buildingWrites, 'GET slas/:id/burndown': reads['GET slas/:id/burndown'] }, 404, `/api/v1/orgs/${other.orgId}/projects/${foreign}/schedule`)

    // Nothing changed and nothing was audited.
    expect(await audited()).toBe(auditsBefore)
    const view = await p.view()
    expect(view.milestones.filter((m) => m.custom).map((m) => m.name).sort()).toEqual(['B002 keys', 'Project review'])
    expect(view.slas.map((s) => s.name).sort()).toEqual(['B002 SLA', 'Project SLA'])
    expect(view.dependencies.map((d) => d.id)).toEqual([dep])
    expect(view.settings.riskElapsedPct).toBe(80)
    expect(p.bar(view, p.b2, 'survey').target).toBeNull()
    expect(view.milestones.find((m) => m.buildingId === p.b2 && m.standardKey === 'hld_approved').dueDate).toBeNull()
  })

  it('every change of a target, milestone, dependency, SLA, setting or assignee writes an audit entry with who and what', async () => {
    const p = await project()
    const s = p.s
    await p.admin.agent.put(`${s}/targets`).send({ targets: [{ buildingId: p.b1, phaseKey: 'survey', targetDate: day(10) }] }).expect(200)
    await p.admin.agent.put(`${s}/milestones/standard`).send({ buildingId: p.b1, standardKey: 'hld_approved', dueDate: day(30) }).expect(200)
    const m = (await p.admin.agent.post(`${s}/milestones`).send({ buildingId: p.b1, name: 'Keys', dueDate: day(4) }).expect(201)).body.milestone
    await p.admin.agent.patch(`${s}/milestones/${m.id}`).send({ dueDate: day(5) }).expect(200)
    await p.admin.agent.delete(`${s}/milestones/${m.id}`).expect(200)
    const d = (await p.admin.agent.post(`${s}/dependencies`).send({ from: { buildingId: p.b1, phaseKey: 'survey' }, to: { buildingId: p.b2, phaseKey: 'hld' } }).expect(201)).body.dependency
    await p.admin.agent.delete(`${s}/dependencies/${d.id}`).expect(200)
    const sla = (await p.admin.agent.post(`${s}/slas`).send({ name: 'Design', buildingId: p.b1, dueDate: day(20) }).expect(201)).body.sla
    await p.admin.agent.patch(`${s}/slas/${sla.id}`).send({ dueDate: day(25) }).expect(200)
    await p.admin.agent.delete(`${s}/slas/${sla.id}`).expect(200)
    await p.admin.agent.put(`${s}/settings`).send({ riskProgressPct: 40 }).expect(200)
    const feId = (await p.fe.get('/api/v1/me').expect(200)).body.user.id
    await p.admin.agent.patch(`${s}/buildings/${p.b1}/assignees`).send({ primaryFieldEngineerId: feId }).expect(200)
    const entries = await col('auditentries').find({ action: { $regex: '^(schedule\\.|building\\.assignees)' } }).sort({ occurredAt: 1, _id: 1 }).toArray()
    expect(entries.map((e) => e.action)).toEqual([
      'schedule.targets.updated',
      'schedule.milestone.updated',
      'schedule.milestone.created',
      'schedule.milestone.updated',
      'schedule.milestone.deleted',
      'schedule.dependency.created',
      'schedule.dependency.deleted',
      'schedule.sla.created',
      'schedule.sla.updated',
      'schedule.sla.deleted',
      'schedule.settings.updated',
      'building.assignees.updated',
    ])
    for (const e of entries) {
      expect(String(e.actor.userId), e.action).toBe(p.admin.userId)
      expect(String(e.projectId), e.action).toBe(p.projectId)
    }
    expect(entries[0].changes).toEqual([expect.objectContaining({ field: 'survey.targetDate', before: null, after: day(10) })])
    expect(entries.find((e) => e.action === 'schedule.sla.updated').changes).toEqual([expect.objectContaining({ field: 'dueDate', before: day(20), after: day(25) })])
    expect(entries.at(-1).changes).toEqual([expect.objectContaining({ field: 'primaryFieldEngineerId', before: null, after: feId })])
  })
})
