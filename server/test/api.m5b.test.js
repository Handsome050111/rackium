import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { hldProject } from './helpers/hld.js'
import { approvedLld } from './helpers/lld.js'
import { readyPackage, submitPackage, clientDecides } from './helpers/m5a.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { deliverOutbox, taskReminders, dailyDigest } from '../src/notifications/jobs.js'
import { notifyDguvExpiry, notifyMention } from '../src/notifications/notify.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { createScheduler } from '../src/jobs/scheduler.js'
import { localDate, localTime, startOfLocalDay } from '@rackium/shared/timeZone.js'
import { fillTab, transition } from './helpers/survey.js'
import { BUILDING_TABS } from '@rackium/shared/surveyForm.js'

// M5b: tasks, notifications (fan-out, preferences, digest, reminders) and the
// audit log screen.
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
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const userIdOf = async (agent) => (await agent.get('/api/v1/me').expect(200)).body.user.id
const org = (p) => `/api/v1/orgs/${p.admin.orgId}`
const bell = async (agent, p, query = '') => (await agent.get(`${org(p)}/notifications${query}`).expect(200)).body
const types = async (agent, p) => (await bell(agent, p)).items.map((n) => n.type)
const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10)

// A survey/HLD project (helpers/hld.js) plus a Reviewer scoped to B002 and the user ids.
async function project(ctx = t()) {
  const p = await hldProject(ctx)
  p.ctx = ctx
  p.b002 = p.building('B002').id
  p.reviewerB002 = await projectMember(ctx, p.admin, { email: 'reviewer-b002@example.com', role: 'reviewer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.b002 }] })
  p.ids = {}
  for (const k of ['architect', 'fe', 'feB001', 'viewer', 'reviewer', 'reviewerB002']) p.ids[k] = await userIdOf(p[k])
  p.ids.admin = p.admin.userId
  return p
}

describe('Tasks', () => {
  it('a PM assigns; the assignee is notified, moves it forward and completes it; the assigner or a PM reopens; audited', async () => {
    const p = await project()
    expectStatus(await p.viewer.post(`${p.base}/tasks`).send({ title: 'x', assignedTo: p.ids.fe }), 403)
    const task = expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Photograph the rack fronts', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: day(3), notes: 'Both rooms' }), 201).body.task
    expect(task).toMatchObject({ status: 'not_started', relatedLabel: 'Building B001', buildingId: p.b001, assignedTo: p.ids.fe, assignedToName: 'field_engineer', deadline: day(3), overdue: false })
    // The assignee (only) is notified, with a link to the task.
    const fe = await bell(p.fe, p)
    expect(fe.items).toEqual([expect.objectContaining({ type: 'task_assigned', title: 'Task assigned: Photograph the rack fronts', read: false, link: `/orgs/${p.admin.orgId}/projects/${p.projectId}/tasks?task=${task.id}` })])
    expect(fe.unread).toBe(1)
    expect(await types(p.admin.agent, p)).toEqual([])
    expect(await types(p.architect, p)).toEqual([])
    // My tasks.
    expect((await p.fe.get(`${org(p)}/tasks/mine`).expect(200)).body.tasks).toEqual([expect.objectContaining({ id: task.id, projectName: 'Survey' })])
    // Somebody else cannot move it; the assignee can.
    expect((await p.architect.patch(`${p.base}/tasks/${task.id}`).send({ status: 'in_progress' }).expect(403)).body.error.message).toBe('Only the assignee or a PM moves a task forward')
    expectStatus(await p.fe.patch(`${p.base}/tasks/${task.id}`).send({ status: 'in_progress' }), 200)
    expectStatus(await p.fe.patch(`${p.base}/tasks/${task.id}`).send({ title: 'Mine now' }), 403)
    const done = expectStatus(await p.fe.patch(`${p.base}/tasks/${task.id}`).send({ status: 'complete' }), 200).body.task
    expect(done.status).toBe('complete')
    expect(done.completedAt).toBeTruthy()
    expect((await p.fe.get(`${org(p)}/tasks/mine`).expect(200)).body.tasks).toEqual([])
    // Reopen: not by the assignee; by the assigner.
    expectStatus(await p.fe.patch(`${p.base}/tasks/${task.id}`).send({ status: 'not_started' }), 403)
    expectStatus(await p.admin.agent.patch(`${p.base}/tasks/${task.id}`).send({ status: 'not_started' }), 200)
    const audit = (await p.admin.agent.get(`${org(p)}/audit?projectId=${p.projectId}&action=task`).expect(200)).body.entries.map((e) => e.action)
    expect(audit).toEqual(['task.updated', 'task.completed', 'task.updated', 'task.created'])
    // Visible on its related object.
    expect((await p.viewer.get(`${p.base}/tasks?relatedObjectType=building&relatedObjectId=${p.b001}`).expect(200)).body.tasks.map((x) => x.id)).toEqual([task.id])
  })

  it('scope: an assignee whose scope misses the building is refused; a scoped member sees only their buildings’ tasks; reassigning notifies the new assignee', async () => {
    const p = await project()
    // feB001 cannot take a B002 task.
    expect((await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'B002 work', relatedObjectType: 'building', relatedObjectId: p.b002, assignedTo: p.ids.feB001 }).expect(400)).body.error.message).toMatch(/scope covers the building/)
    const outsider = await signedInOrgAdmin(p.ctx, { email: 'other@example.com', organisationName: 'Other' })
    expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'x', assignedTo: outsider.userId }), 400)
    const b002 = expectStatus(await p.architect.post(`${p.base}/tasks`).send({ title: 'B002 work', relatedObjectType: 'building', relatedObjectId: p.b002, assignedTo: p.ids.fe, deadline: day(-2) }), 201).body.task
    const b001 = expectStatus(await p.architect.post(`${p.base}/tasks`).send({ title: 'B001 work', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.feB001 }), 201).body.task
    expect((await p.feB001.get(`${p.base}/tasks`).expect(200)).body.tasks.map((x) => x.id)).toEqual([b001.id])
    await p.feB001.patch(`${p.base}/tasks/${b002.id}`).send({ status: 'in_progress' }).expect(404)
    // Overdue filter and flag.
    expect((await p.admin.agent.get(`${p.base}/tasks?overdue=true`).expect(200)).body.tasks).toEqual([expect.objectContaining({ id: b002.id, overdue: true })])
    // Reassigned: the new assignee is told.
    expectStatus(await p.architect.patch(`${p.base}/tasks/${b001.id}`).send({ assignedTo: p.ids.fe }), 200)
    expect(await types(p.fe, p)).toEqual(['task_assigned', 'task_assigned'])
    // Other organisations see nothing.
    await outsider.agent.get(`${org(p)}/tasks/mine`).expect(404)
    await outsider.agent.get(`${p.base}/tasks`).expect(404)
    // The assignee picker lists members covering the building.
    const names = (await p.architect.get(`${p.base}/tasks/assignees?buildingId=${p.b002}`).expect(200)).body.assignees.map((a) => a.email)
    expect(names).toContain('fe@example.com')
    expect(names).not.toContain('fe-b001@example.com')
  })

  it('reminders (Europe/Berlin): due within 24 hours once to the assignee; overdue once to the assignee and the assigner', async () => {
    const p = await project()
    const soon = expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Due today', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: '2030-06-10' }), 201).body.task
    const late = expectStatus(await p.architect.post(`${p.base}/tasks`).send({ title: 'Was due', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: '2030-06-09' }), 201).body.task
    expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Later', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: '2030-06-20' }), 201)
    const now = new Date('2030-06-10T12:00:00Z') // 14:00 in Berlin
    expect(await taskReminders({ now })).toEqual({ dueSoon: 1, overdue: 1 })
    expect(await taskReminders({ now })).toEqual({ dueSoon: 0, overdue: 0 })
    const fe = (await bell(p.fe, p)).items
    expect(fe.filter((n) => n.type === 'task_due_soon').map((n) => n.relatedObjectId)).toEqual([soon.id])
    expect(fe.filter((n) => n.type === 'task_overdue').map((n) => n.relatedObjectId)).toEqual([late.id])
    expect(await types(p.architect, p)).toEqual(['task_overdue'])
    expect(await types(p.admin.agent, p)).toEqual([])
  })

  it('the organisation time zone decides "overdue": local midnight, near midnight and across DST; the Org Admin changes it, audited', async () => {
    const p = await project()
    const settings = `${org(p)}/settings`
    expect((await p.admin.agent.get(settings).expect(200)).body.settings).toMatchObject({ timeZone: 'Europe/Berlin', digestTime: '07:00', defaultTimeZone: 'Europe/Berlin' })
    // 25 October 2030 is the day Berlin's clocks go back (a 25-hour day).
    const task = expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Patch on the DST day', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: '2030-10-27' }), 201).body.task
    // 2030-10-27 ends at local midnight = 23:00 UTC (CET). One minute before: not overdue.
    expect(await taskReminders({ now: new Date('2030-10-27T22:59:00Z') })).toEqual({ dueSoon: 1, overdue: 0 })
    expect(await taskReminders({ now: new Date('2030-10-27T23:00:00Z') })).toEqual({ dueSoon: 0, overdue: 1 })
    // In New York the same deadline ends at 04:00 UTC the next day.
    await p.architect.patch(settings).send({ timeZone: 'America/New_York' }).expect(403)
    await p.admin.agent.patch(settings).send({ timeZone: 'Mars/Base' }).expect(400)
    await p.admin.agent.patch(settings).send({ timeZone: 'America/New_York', digestTime: '06:30' }).expect(200)
    const ny = expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'New York deadline', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe, deadline: '2030-10-27' }), 201).body.task
    expect(await taskReminders({ now: new Date('2030-10-28T03:59:00Z') })).toEqual({ dueSoon: 1, overdue: 0 })
    expect(await taskReminders({ now: new Date('2030-10-28T04:00:00Z') })).toEqual({ dueSoon: 0, overdue: 1 })
    expect((await bell(p.architect, p)).items).toEqual([])
    // The assigner's two overdue reminders (the job, in one building) are one notification.
    expect((await bell(p.admin.agent, p)).items.map((n) => [n.type, n.title, n.count])).toEqual([['task_overdue', '2 tasks overdue (B001)', 2]])
    expect(task.id).not.toBe(ny.id)
    const audit = await col('auditentries').find({ action: 'organisation.settings.updated' }).sort({ occurredAt: -1 }).limit(1).next()
    expect(audit.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['timeZone', 'Europe/Berlin', 'America/New_York'],
      ['digestTime', '07:00', '06:30'],
    ])
  })

  it('Bill of Resources → one task per room and task kind, assigned; a second run skips what exists', async () => {
    const d = await approvedLld(t())
    const { p } = d
    const assignee = await userIdOf(p.architect)
    const res = expectStatus(await p.admin.agent.post(`${p.base}/tasks/from-resources`).send({ buildingId: p.b001, assignedTo: assignee, deadline: day(7), taskIds: ['install-device', 'patch-fibre'] }), 201).body
    expect(res.tasks.length).toBeGreaterThanOrEqual(2)
    expect(res.tasks.every((x) => x.relatedObjectType === 'room' && /^(Install device|Patch fibre cable) × \d+ — /.test(x.title) && /Bill of Resources: \d+ × \d+ min = [\d.]+ h/.test(x.notes))).toBe(true)
    const again = expectStatus(await p.admin.agent.post(`${p.base}/tasks/from-resources`).send({ buildingId: p.b001, assignedTo: assignee, taskIds: ['install-device', 'patch-fibre'] }), 201).body
    expect(again.tasks).toEqual([])
    expect(again.skipped).toHaveLength(res.tasks.length)
    expect((await p.admin.agent.post(`${p.base}/tasks/from-resources`).send({ buildingId: p.b001, assignedTo: assignee, taskIds: ['no-such-task'] }).expect(409)).body.error.code).toBe('nothing_to_create')
  })
})

describe('Notifications: who is told', () => {
  it('HLD submitted → PMs and Reviewers in scope (never the actor, never others); decided → the submitter', async () => {
    const p = await project()
    const hld = (await p.architect.get(`${p.hld}/buildings/${p.b001}`).expect(200)).body
    await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: hld.design.revision }).expect(201)
    const rev = (await p.architect.get(`${p.hld}/buildings/${p.b001}`).expect(200)).body.design.revision
    expectStatus(await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision: rev }), 201)
    expect(await types(p.admin.agent, p)).toEqual(['hld_submitted'])
    expect(await types(p.reviewer, p)).toEqual(['hld_submitted'])
    expect(await types(p.reviewerB002, p)).toEqual([])
    expect(await types(p.architect, p)).toEqual([])
    expect(await types(p.fe, p)).toEqual([])
    expect(await types(p.viewer, p)).toEqual([])
    const n = (await bell(p.reviewer, p)).items[0]
    expect(n).toMatchObject({ title: 'HLD v1 of B001 submitted for approval', actorName: 'architect', link: `/orgs/${p.admin.orgId}/projects/${p.projectId}/buildings/${p.b001}/hld` })
    await p.reviewer.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested', comment: 'Add a second edge' }).expect(200)
    expect((await bell(p.architect, p)).items).toEqual([expect.objectContaining({ type: 'hld_changes_requested', body: 'Add a second edge', actorName: 'reviewer' })])
    expect(await types(p.admin.agent, p)).toEqual(['hld_submitted'])
  })

  it('survey: submitted → Architects; rejected → whoever submitted', async () => {
    const p = await project()
    const { fillTab, transition } = await import('./helpers/survey.js')
    // (B001's survey is already verified by the helper; B002's is not.)
    const target = { buildingId: p.b002, roomId: null, tab: 'SSID' }
    await fillTab(p.fe, p.base, target)
    await transition(p.fe, p.base, target, 'submit').expect(200)
    expect(await types(p.architect, p)).toEqual(['survey_submitted'])
    expect(await types(p.admin.agent, p)).toEqual([])
    await transition(p.architect, p.base, target, 'reject', 'Missing SSID names').expect(200)
    expect((await bell(p.fe, p)).items).toEqual([expect.objectContaining({ type: 'survey_rejected', body: 'Missing SSID names', title: 'Survey tab rejected: SSID — B002' })])
    expect(await types(p.reviewerB002, p)).toEqual([])
  })

  it('blockers: raised → PMs and the owner; assigned → the new owner; resolved → whoever raised it', async () => {
    const p = await project()
    const blocker = expectStatus(await p.fe.post(`${p.base}/blockers`).send({ buildingId: p.b001, phaseKey: 'survey', description: 'Locked room', priority: 'high', ownerId: p.ids.architect }), 201).body.blocker
    expect(await types(p.admin.agent, p)).toEqual(['blocker_raised'])
    expect(await types(p.architect, p)).toEqual(['blocker_raised'])
    expect(await types(p.fe, p)).toEqual([])
    await p.admin.agent.patch(`${p.base}/blockers/${blocker.id}`).send({ ownerId: p.ids.feB001 }).expect(200)
    expect(await types(p.feB001, p)).toEqual(['blocker_assigned'])
    await p.feB001.patch(`${p.base}/blockers/${blocker.id}`).send({ status: 'resolved' }).expect(200)
    expect(await types(p.fe, p)).toEqual(['blocker_resolved'])
  })

  it('hooks: DGUV expiry → PMs; a mention → the members mentioned, never outsiders', async () => {
    const p = await project()
    const outsider = await signedInOrgAdmin(p.ctx, { email: 'x@example.com', organisationName: 'X' })
    await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, async () => {
      await notifyDguvExpiry({ projectId: p.projectId, buildingId: p.b001, deviceLabel: 'UPS-1', expiresOn: '2026-11-30' })
      await notifyMention({ projectId: p.projectId, buildingId: p.b001, mentionedUserIds: [p.ids.fe, outsider.userId], actorId: p.ids.architect, excerpt: '@fe please check' })
    })
    expect(await types(p.admin.agent, p)).toEqual(['dguv_expiry'])
    expect((await bell(p.fe, p, '?tab=mentions')).items.map((n) => n.type)).toEqual(['mention'])
    expect((await bell(p.architect, p, '?tab=mentions')).items).toEqual([])
    expect(await col('notifications').countDocuments({ recipientId: new mongoose.Types.ObjectId(outsider.userId) })).toBe(0)
  })
})

describe('Notifications: delivery events', () => {
  it('Solution Package sent and approved by the client, procurement status, change request submitted / sent / decided — each to its people', async () => {
    const ctx = t()
    const d = await approvedLld(ctx)
    const { p } = d
    const items = async (agent) => (await agent.get(`/api/v1/orgs/${p.admin.orgId}/notifications?limit=100`).expect(200)).body.items
    const seen = new Map()
    // Only what arrived since the last look, newest first.
    const fresh = async (agent, who) => {
      const all = await items(agent)
      const known = seen.get(who) ?? new Set()
      seen.set(who, new Set(all.map((n) => n.id)))
      return all.filter((n) => !known.has(n.id))
    }
    await fresh(p.admin.agent, 'pm')
    await fresh(p.architect, 'architect')
    await readyPackage(p)
    const link = await submitPackage(p)
    // Sent by the PM: the Architects are told (never the PM who sent it).
    expect((await fresh(p.architect, 'architect')).map((n) => n.type)).toEqual(['sp_sent'])
    expect((await fresh(p.admin.agent, 'pm')).map((n) => n.type)).toEqual([])
    expectStatus(await clientDecides(ctx, link), 200)
    const approved = await fresh(p.admin.agent, 'pm')
    expect(approved.map((n) => [n.type, n.title])).toEqual([['sp_approved', 'Clara Client (client) approved the Solution Package']])
    expect((await fresh(p.architect, 'architect')).map((n) => n.type)).toEqual(['sp_approved'])
    // Procurement: a status change reaches the Architects (the PM changed it).
    expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 201)
    const bom = (await p.admin.agent.get(`${p.base}/bom/buildings/${p.b001}`).expect(200)).body
    const line = bom.lines.find((l) => l.lineType === 'serialised')
    expectStatus(await p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: line.key, status: 'quotation_requested', version: 0 }), 200)
    expect((await fresh(p.architect, 'architect')).map((n) => n.type)).toEqual(['procurement_status_changed'])
    expect((await fresh(p.admin.agent, 'pm')).map((n) => n.type)).toEqual([])
    // A change request: submitted → PMs; sent → Architects; the client's decision → both.
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Longer trunk' }), 201).body.changeRequest
    const be = await d.link('border', 'edge', cr.branchId)
    expectStatus(await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 75 }, { branchId: cr.branchId }), 200)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    expect((await fresh(p.admin.agent, 'pm')).map((n) => n.type)).toEqual(['cr_submitted'])
    const crLink = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    expect((await fresh(p.architect, 'architect')).map((n) => n.type)).toEqual(['cr_sent'])
    expectStatus(await clientDecides(ctx, crLink, { decision: 'rejected', comments: 'No' }), 200)
    expect((await fresh(p.admin.agent, 'pm')).map((n) => [n.type, n.body])).toEqual([['cr_rejected', 'No']])
    expect((await fresh(p.architect, 'architect')).map((n) => n.type)).toEqual(['cr_rejected'])
  })
})

describe('The bell', () => {
  it('tabs, unread count, mark one and all read, paging; a burst is one notification; only your own', async () => {
    const p = await project()
    const assign = (agent, title, buildingId) => agent.post(`${p.base}/tasks`).send({ title, assignedTo: p.ids.fe, relatedObjectType: 'building', relatedObjectId: buildingId }).expect(201)
    for (const title of ['One', 'Two', 'Three']) await assign(p.admin.agent, title, p.b001)
    await assign(p.admin.agent, 'Four', p.b002)
    await assign(p.architect, 'Five', p.b001)
    let fe = await bell(p.fe, p)
    // The PM's three B001 tasks are one notification, pointing at the task list.
    expect(fe.items.map((n) => [n.title, n.count])).toEqual([
      ['Task assigned: Five', 1],
      ['Task assigned: Four', 1],
      ['3 tasks assigned to you (B001)', 3],
    ])
    expect(fe.items[2].link).toBe(`/orgs/${p.admin.orgId}/projects/${p.projectId}/tasks`)
    expect(fe.items[0].link).toMatch(/\/tasks\?task=/)
    expect((await p.fe.get(`${org(p)}/notifications/unread-count`).expect(200)).body).toEqual({ unread: 3 })
    // Somebody else cannot read or mark it.
    await p.architect.post(`${org(p)}/notifications/${fe.items[2].id}/read`).expect(404)
    expectStatus(await p.fe.post(`${org(p)}/notifications/${fe.items[2].id}/read`), 200)
    // Once read, the group is closed: the next one starts a new notification.
    await assign(p.admin.agent, 'Six', p.b001)
    fe = await bell(p.fe, p)
    expect(fe.items.map((n) => [n.title, n.read])).toEqual([
      ['Task assigned: Six', false],
      ['Task assigned: Five', false],
      ['Task assigned: Four', false],
      ['3 tasks assigned to you (B001)', true],
    ])
    expect((await bell(p.fe, p, '?tab=unread')).items).toHaveLength(3)
    // Paging.
    const first = await bell(p.fe, p, '?limit=2')
    expect(first.items).toHaveLength(2)
    expect((await bell(p.fe, p, `?limit=2&before=${encodeURIComponent(first.nextBefore)}`)).items.map((n) => n.title)).toEqual(['Task assigned: Four', '3 tasks assigned to you (B001)'])
    expect(first.timeZone).toBe('Europe/Berlin')
    expect((await p.fe.post(`${org(p)}/notifications/read-all`).expect(200)).body).toEqual({ marked: 3 })
    expect((await bell(p.fe, p)).unread).toBe(0)
  })

  it('verifying a whole survey: one notification with the count and a link to the survey — in the bell, in one email and in the digest', async () => {
    const p = await project()
    const tabs = BUILDING_TABS.slice(0, 3)
    const target = (tab) => ({ buildingId: p.b002, roomId: null, tab })
    for (const tab of tabs) {
      await fillTab(p.fe, p.base, target(tab))
      await transition(p.fe, p.base, target(tab), 'submit').expect(200)
    }
    // The Architects: one "submitted" notification for the burst.
    expect((await bell(p.architect, p)).items.map((n) => [n.title, n.count])).toEqual([['Survey for B002 submitted — 3 tabs', 3]])
    for (const tab of tabs) await transition(p.architect, p.base, target(tab), 'verify').expect(200)
    const fe = (await bell(p.fe, p)).items
    expect(fe.map((n) => [n.type, n.title, n.count, n.body])).toEqual([['survey_verified', 'Survey for B002 verified — 3 tabs', 3, null]])
    expect(fe[0].link).toBe(`/orgs/${p.admin.orgId}/projects/${p.projectId}/buildings/${p.b002}/survey`)
    expect(await col('notifications').countDocuments({ type: 'survey_verified' })).toBe(1)

    // By email: the burst waits a minute and goes out as one message.
    const mails = () => p.ctx.mailer.sent.filter((m) => m.to === 'architect@example.com' && m.subject.startsWith('Rackium'))
    await p.architect.put(`${org(p)}/notification-preferences`).send({ modes: { survey_submitted: 'email' } }).expect(200)
    const more = BUILDING_TABS.slice(3, 6)
    for (const tab of more) {
      await fillTab(p.fe, p.base, target(tab))
      await transition(p.fe, p.base, target(tab), 'submit').expect(200)
    }
    expect(await deliverOutbox({ mailer: p.ctx.mailer })).toEqual({ sent: 0, failed: 0 })
    expect(await deliverOutbox({ mailer: p.ctx.mailer, now: new Date(Date.now() + 61000) })).toEqual({ sent: 1, failed: 0 })
    expect(mails().map((m) => m.subject)).toEqual(['Rackium: Survey for B002 submitted — 3 tabs'])
    expect(mails()[0].text).toContain(`/buildings/${p.b002}/survey`)

    // In the daily digest: one line for the burst.
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { survey_verified: 'digest' } }).expect(200)
    for (const tab of more) await transition(p.architect, p.base, target(tab), 'verify').expect(200)
    const at = digestTime(new Date())
    expect(await dailyDigest({ now: at })).toEqual({ emails: 1, notifications: 3 })
    await deliverOutbox({ mailer: p.ctx.mailer, now: at })
    const digest = p.ctx.mailer.sent.find((m) => m.to === 'fe@example.com' && m.subject.startsWith('Rackium daily digest'))
    expect(digest.subject).toBe('Rackium daily digest — 3 notification(s)')
    expect(digest.text.split('\n').filter((l) => l.startsWith('- '))).toEqual([`- Survey for B002 verified — 3 tabs — http://localhost:5173/orgs/${p.admin.orgId}/projects/${p.projectId}/buildings/${p.b002}/survey`])
  })
})

// An instant at or after 07:00 Berlin time on the same local day as `from`
// (the digest only goes out from the organisation's digest time on).
function digestTime(from) {
  if (localTime(from, 'Europe/Berlin') >= '07:00') return from
  return new Date(startOfLocalDay(localDate(from, 'Europe/Berlin'), 'Europe/Berlin').getTime() + 7 * 3600000)
}

describe('Preferences, email and the daily digest', () => {
  it('in-app (default), email, both, or a daily digest; mail goes through the outbox once; the digest job is idempotent', async () => {
    const p = await project()
    const prefs = (await p.fe.get(`${org(p)}/notification-preferences`).expect(200)).body
    expect(prefs.modes.task_assigned).toBe('in_app')
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'telepathy' } }).expect(400)
    const assign = (title) => p.admin.agent.post(`${p.base}/tasks`).send({ title, assignedTo: p.ids.fe, relatedObjectType: 'building', relatedObjectId: p.b001 }).expect(201)
    // (The invitation mail went to the same address; only notification mail counts.)
    const mails = () => p.ctx.mailer.sent.filter((m) => m.to === 'fe@example.com' && m.subject.startsWith('Rackium'))
    const later = () => new Date(Date.now() + 61000)

    // Email only: no bell entry; the mail waits a minute (a burst would join it), then goes once.
    expect((await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'email' } }).expect(200)).body.modes.task_assigned).toBe('email')
    await assign('Email me')
    expect(await types(p.fe, p)).toEqual([])
    expect(await deliverOutbox({ mailer: p.ctx.mailer })).toEqual({ sent: 0, failed: 0 })
    expect(await deliverOutbox({ mailer: p.ctx.mailer, now: later() })).toEqual({ sent: 1, failed: 0 })
    expect(await deliverOutbox({ mailer: p.ctx.mailer, now: later() })).toEqual({ sent: 0, failed: 0 })
    expect(mails().map((m) => m.subject)).toEqual(['Rackium: Task assigned: Email me'])
    expect(mails()[0].text).toContain(`http://localhost:5173/orgs/${p.admin.orgId}/projects/${p.projectId}/tasks?task=`)
    // A burst: one mail with the count.
    await assign('Email A')
    await assign('Email B')
    await deliverOutbox({ mailer: p.ctx.mailer, now: later() })
    expect(mails().map((m) => m.subject)).toEqual(['Rackium: Task assigned: Email me', 'Rackium: 2 tasks assigned to you (B001)'])

    // Both.
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'both' } }).expect(200)
    await assign('Both')
    expect(await types(p.fe, p)).toEqual(['task_assigned'])
    await deliverOutbox({ mailer: p.ctx.mailer, now: later() })
    expect(mails()).toHaveLength(3)

    // Daily digest: in the bell now, one summary mail a day (from 07:00 local).
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'digest' } }).expect(200)
    await assign('Digest A')
    await assign('Digest B')
    await deliverOutbox({ mailer: p.ctx.mailer, now: later() })
    expect(mails()).toHaveLength(3)
    const today = digestTime(new Date())
    expect(await dailyDigest({ now: today })).toEqual({ emails: 1, notifications: 2 })
    expect(await dailyDigest({ now: today })).toEqual({ emails: 0, notifications: 0 })
    await assign('Digest C')
    // Same day: already sent — it waits for tomorrow's.
    expect(await dailyDigest({ now: new Date(today.getTime() + 1000) })).toEqual({ emails: 0, notifications: 0 })
    await deliverOutbox({ mailer: p.ctx.mailer, now: later() })
    const digest = mails().find((m) => m.subject.startsWith('Rackium daily digest'))
    expect(digest.text).toContain('- 2 tasks assigned to you (B001)')
    expect(await dailyDigest({ now: new Date(today.getTime() + 86400000) })).toEqual({ emails: 1, notifications: 1 })
    // In the bell: "Both", the digested burst, and "Digest C".
    expect((await bell(p.fe, p)).items.map((n) => [n.title, n.count])).toEqual([
      ['Task assigned: Digest C', 1],
      ['2 tasks assigned to you (B001)', 2],
      ['Task assigned: Both', 1],
    ])
  })

  it('the digest goes out at the organisation’s local digest time, once per local day', async () => {
    const p = await project()
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'digest' } }).expect(200)
    await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Morning', assignedTo: p.ids.fe }).expect(201)
    // Berlin, 07:00 by default (CEST: 05:00 UTC). The notification exists from now on.
    const day = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 6, 15))
    expect(await dailyDigest({ now: new Date(day.getTime() + 4 * 3600000 + 59 * 60000) })).toEqual({ emails: 0, notifications: 0 }) // 06:59
    expect(await dailyDigest({ now: new Date(day.getTime() + 5 * 3600000) })).toEqual({ emails: 1, notifications: 1 }) // 07:00
    await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Late evening', assignedTo: p.ids.fe }).expect(201)
    // 23:30 UTC is already the next local day in Berlin (01:30), but before 07:00: nothing yet.
    expect(await dailyDigest({ now: new Date(day.getTime() + 23.5 * 3600000) })).toEqual({ emails: 0, notifications: 0 })
    expect(await dailyDigest({ now: new Date(day.getTime() + 29 * 3600000) })).toEqual({ emails: 1, notifications: 1 })
    expect((await col('emailoutboxes').find({ kind: 'digest' }).toArray()).map((m) => m.dedupeKey.split(':').pop()).sort()).toEqual([localDate(new Date(day.getTime() + 5 * 3600000)), localDate(new Date(day.getTime() + 29 * 3600000))].sort())
  })

  it('a failed send is retried, and given up after five attempts', async () => {
    const p = await project()
    await p.fe.put(`${org(p)}/notification-preferences`).send({ modes: { task_assigned: 'email' } }).expect(200)
    await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'Flaky mail', assignedTo: p.ids.fe }).expect(201)
    const broken = { send: async () => { throw new Error('SMTP down') } }
    let now = new Date(Date.now() + 61000) // after the grouping hold
    for (let i = 0; i < 5; i++) {
      expect(await deliverOutbox({ mailer: broken, now })).toEqual({ sent: 0, failed: 1 })
      now = new Date(now.getTime() + 10 * 60000)
    }
    expect(await deliverOutbox({ mailer: p.ctx.mailer, now })).toEqual({ sent: 0, failed: 0 })
    expect(await col('emailoutboxes').findOne({})).toMatchObject({ status: 'failed', attempts: 5, lastError: 'SMTP down' })
  })

  it('the scheduler runs a due job once, even with two schedulers ticking at the same time', async () => {
    let runs = 0
    const job = { name: 'test-job', every: 60000, run: async () => { runs += 1; await new Promise((r) => setTimeout(r, 50)); return { ok: true } } }
    const a = createScheduler({ jobs: [job] })
    const b = createScheduler({ jobs: [job] })
    await col('scheduledjobs').insertOne({ name: 'test-job', nextRunAt: new Date(Date.now() - 1000), lockedUntil: null })
    const now = new Date()
    await Promise.all([a.tick(now), b.tick(now)])
    expect(runs).toBe(1)
    await a.tick(now)
    expect(runs).toBe(1)
    expect(await col('scheduledjobs').findOne({ name: 'test-job' })).toMatchObject({ lockedUntil: null, lastResult: { ok: true } })
  })
})

describe('The audit log screen', () => {
  async function withHistory() {
    const p = await project()
    const a = expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'B001 task', relatedObjectType: 'building', relatedObjectId: p.b001, assignedTo: p.ids.fe }), 201).body.task
    expectStatus(await p.admin.agent.post(`${p.base}/tasks`).send({ title: 'B002 task', relatedObjectType: 'building', relatedObjectId: p.b002, assignedTo: p.ids.fe }), 201)
    await p.fe.patch(`${p.base}/tasks/${a.id}`).send({ status: 'complete' }).expect(200)
    p.archB001 = await projectMember(p.ctx, p.admin, { email: 'arch-b001@example.com', role: 'architect', projectId: p.projectId, scopes: [{ type: 'building', refId: p.b001 }] })
    return p
  }

  it('who may read (v2.3 role table): Org Admin (organisation), PM, Architect and Reviewer (their project); not Field Engineer or Viewer; other organisations 404', async () => {
    const p = await withHistory()
    expectStatus(await p.admin.agent.get(`${org(p)}/audit`), 200)
    for (const who of ['architect', 'reviewer']) expectStatus(await p[who].get(`${org(p)}/audit?projectId=${p.projectId}`), 200)
    expect((await p.reviewer.get(`${org(p)}/audit?projectId=${p.projectId}&action=task.created`).expect(200)).body.entries).toHaveLength(2)
    await p.reviewer.get(`${org(p)}/audit/export.csv?projectId=${p.projectId}`).expect(200)
    // A Reviewer scoped to B002 sees B002's entries only.
    expect((await p.reviewerB002.get(`${org(p)}/audit?projectId=${p.projectId}&action=task.created`).expect(200)).body.entries.map((e) => e.comment)).toEqual(['B002 task'])
    await p.architect.get(`${org(p)}/audit`).expect(403)
    await p.reviewer.get(`${org(p)}/audit`).expect(403)
    for (const who of ['fe', 'viewer']) await p[who].get(`${org(p)}/audit?projectId=${p.projectId}`).expect(403)
    const outsider = await signedInOrgAdmin(p.ctx, { email: 'o@example.com', organisationName: 'O' })
    await outsider.agent.get(`${org(p)}/audit`).expect(404)
    await outsider.agent.get(`/api/v1/orgs/${outsider.orgId}/audit?projectId=${p.projectId}`).expect(200).then((r) => expect(r.body.entries.filter((e) => e.projectId === p.projectId)).toEqual([]))
  })

  it('filters (date range, user, action type, module, object type, building), pages, detail with field changes, CSV export', async () => {
    const p = await withHistory()
    const list = (q) => p.admin.agent.get(`${org(p)}/audit?projectId=${p.projectId}&${q}`).expect(200).then((r) => r.body)
    expect((await list('action=task.created')).entries.map((e) => e.comment)).toEqual(['B002 task', 'B001 task'])
    expect((await list(`action=task&userId=${p.ids.fe}`)).entries.map((e) => [e.action, e.actor.name])).toEqual([['task.completed', 'field_engineer']])
    expect((await list(`objectType=Task&buildingId=${p.b002}`)).entries.map((e) => e.comment)).toEqual(['B002 task'])
    expect((await list('module=tasks&objectType=Task')).entries).toHaveLength(3)
    expect((await list(`from=${day(1)}`)).entries).toEqual([])
    expect((await list(`from=${day(0)}&to=${day(0)}&objectType=Task`)).entries).toHaveLength(3)
    await p.admin.agent.get(`${org(p)}/audit?from=yesterday`).expect(400)
    // Pages.
    const first = await list('objectType=Task&limit=2')
    expect(first.entries).toHaveLength(2)
    const second = await list(`objectType=Task&limit=2&before=${first.nextBefore}`)
    expect(second.entries).toHaveLength(1)
    expect(second.nextBefore).toBeNull()
    expect([...first.entries, ...second.entries].map((e) => e.id)).toEqual((await list('objectType=Task')).entries.map((e) => e.id))
    // Detail with field-level before/after.
    const done = (await list('action=task.completed')).entries[0]
    const detail = (await p.admin.agent.get(`${org(p)}/audit/${done.id}?projectId=${p.projectId}`).expect(200)).body.entry
    expect(detail).toMatchObject({ action: 'task.completed', buildingCode: 'B001', projectName: 'Survey', actor: { name: 'field_engineer', role: 'field_engineer' } })
    expect(detail.changes).toEqual([{ objectType: 'Task', objectId: done.objectId, field: 'status', before: 'not_started', after: 'complete' }])
    // CSV.
    const csv = await p.admin.agent.get(`${org(p)}/audit/export.csv?projectId=${p.projectId}&objectType=Task`).expect(200)
    expect(csv.headers['content-type']).toMatch(/text\/csv/)
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/)
    const lines = csv.text.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toBe('Occurred at (UTC),User,Role,Action,Object type,Object id,Project,Building,Module,Change type,Source,Comment,Changes')
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('task.completed')
    expect(lines[1]).toContain('status: not_started → complete')
  })

  it('scope and admin-only entries: a scoped Architect sees only their buildings; View As entries are for the Org Admin only', async () => {
    const p = await withHistory()
    const scoped = (await p.archB001.get(`${org(p)}/audit?projectId=${p.projectId}&objectType=Task`).expect(200)).body.entries
    expect(scoped.map((e) => e.comment ?? e.action)).toEqual(['task.completed', 'B001 task'])
    const b002Entry = (await p.admin.agent.get(`${org(p)}/audit?projectId=${p.projectId}&action=task.created&buildingId=${p.b002}`).expect(200)).body.entries[0]
    await p.archB001.get(`${org(p)}/audit/${b002Entry.id}?projectId=${p.projectId}`).expect(404)
    // A View As session leaves view_as_access entries.
    await p.admin.agent.post(`${p.base}/view-as`).send({ projectId: p.projectId, role: 'viewer' }).expect(201)
    const adminSees = (await p.admin.agent.get(`${org(p)}/audit?projectId=${p.projectId}&changeType=view_as_access`).expect(200)).body.entries
    expect(adminSees.length).toBeGreaterThan(0)
    expect((await p.architect.get(`${org(p)}/audit?projectId=${p.projectId}&changeType=view_as_access`).expect(200)).body.entries).toEqual([])
    expect((await p.architect.get(`${org(p)}/audit?projectId=${p.projectId}&limit=100`).expect(200)).body.entries.some((e) => e.changeType === 'view_as_access')).toBe(false)
    await p.architect.get(`${org(p)}/audit/${adminSees[0].id}?projectId=${p.projectId}`).expect(404)
    const csv = (await p.architect.get(`${org(p)}/audit/export.csv?projectId=${p.projectId}`).expect(200)).text
    expect(csv).not.toContain('view_as')
  })
})

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks; a leading = + - @ never runs as a spreadsheet formula', async () => {
    const { csvCell } = await import('../src/audit/log.js')
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell(null)).toBe('')
  })
})
