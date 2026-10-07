import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember, tokenFrom } from './helpers/app.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
})

const t = () => createTestApp()
const BUILDING_ID = '65f0c0ffee0000000000b001'

async function newProject(admin) {
  const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)
  return res.body.project.id
}

const base = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}/blockers`

describe('blockers', () => {
  it('any project role may raise a blocker; a Viewer can', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const viewer = await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId })

    const res = await viewer.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'Room locked' }).expect(201)
    expect(res.body.blocker.status).toBe('open')
    expect(res.body.blocker.priority).toBe('medium')

    const list = await admin.agent.get(`${base(admin.orgId, projectId)}?buildingId=${BUILDING_ID}`).expect(200)
    expect(list.body.blockers).toHaveLength(1)
  })

  it('an Org Admin with no role on this project cannot raise a blocker there', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'admin2@example.com', role: 'org_admin' }).expect(201)
    const admin2 = ctx.agent()
    await admin2.post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'admin2@example.com'), name: 'Admin Two', password: 'correct horse battery staple' }).expect(201)
    await admin2.post('/api/v1/auth/login').send({ email: 'admin2@example.com', password: 'correct horse battery staple' }).expect(200)

    await admin2.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'x' }).expect(403)
  })

  it('open -> in_progress needs the owner or a PM; another project member cannot', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId })
    const reviewer = await projectMember(ctx, admin, { email: 'rev@example.com', role: 'reviewer', projectId })

    const raised = await architect.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'hld', description: 'Missing uplink' }).expect(201)
    const id = raised.body.blocker.id

    await reviewer.patch(`${base(admin.orgId, projectId)}/${id}`).send({ status: 'in_progress' }).expect(403)
    await admin.agent.patch(`${base(admin.orgId, projectId)}/${id}`).send({ status: 'in_progress' }).expect(200)
  })

  it('the owner may resolve their own blocker; resolving sets resolvedAt/resolvedBy', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const fe = await projectMember(ctx, admin, { email: 'fe@example.com', role: 'field_engineer', projectId })

    const raised = await fe.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'No power' }).expect(201)
    const id = raised.body.blocker.id
    const feId = await userIdOf(fe)
    await admin.agent.patch(`${base(admin.orgId, projectId)}/${id}`).send({ ownerId: feId }).expect(200)

    const resolved = await fe.patch(`${base(admin.orgId, projectId)}/${id}`).send({ status: 'resolved' }).expect(200)
    expect(resolved.body.blocker.status).toBe('resolved')
    expect(resolved.body.blocker.resolvedAt).toBeTruthy()
  })

  it('only a PM may reassign the owner', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const fe = await projectMember(ctx, admin, { email: 'fe@example.com', role: 'field_engineer', projectId })
    const raised = await fe.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'No power' }).expect(201)
    const feId = await userIdOf(fe)

    await fe.patch(`${base(admin.orgId, projectId)}/${raised.body.blocker.id}`).send({ ownerId: feId }).expect(403)
  })

  it('a resolved blocker may be reopened by any project member', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const viewer = await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId })
    const raised = await admin.agent.post(base(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'x' }).expect(201)
    await admin.agent.patch(`${base(admin.orgId, projectId)}/${raised.body.blocker.id}`).send({ status: 'resolved' }).expect(200)

    const reopened = await viewer.patch(`${base(admin.orgId, projectId)}/${raised.body.blocker.id}`).send({ status: 'open' }).expect(200)
    expect(reopened.body.blocker.status).toBe('open')
  })
})

async function userIdOf(agent) {
  const me = await agent.get('/api/v1/me')
  return me.body.user.id
}
