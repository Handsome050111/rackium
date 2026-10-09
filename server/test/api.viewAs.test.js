import mongoose from 'mongoose'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember, tokenFrom, addBuilding } from './helpers/app.js'

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
// A real building of the project (set by newProject): blockers need one in scope.
let BUILDING_ID
const auditCount = (action) => mongoose.connection.db.collection('auditentries').countDocuments({ action })

async function newProject(admin) {
  // The creator becomes the project's PM too, so the Org Admin here can raise
  // a blocker as themselves — the test for View As needs a write the actor
  // could otherwise do, to prove the session blocks it anyway.
  const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)
  BUILDING_ID = await addBuilding(admin, res.body.project.id)
  return res.body.project.id
}

const viewAsBase = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}/view-as`
const blockersBase = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}/blockers`

describe('View As', () => {
  it('only an Org Admin may start a View As session; a PM cannot', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const pm = await projectMember(ctx, admin, { email: 'pm2@example.com', role: 'pm', projectId })

    await pm.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(403)
    const res = await admin.agent.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(201)
    expect(res.body.session.viewedRole).toBe('viewer')
    expect(await auditCount('view_as.started')).toBe(1)
  })

  it('blocks a write the Org Admin could otherwise do as the project PM they created it as', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)

    await admin.agent.post(blockersBase(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'ok as PM' }).expect(201)

    const session = await admin.agent.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(201)
    await admin.agent
      .post(blockersBase(admin.orgId, projectId))
      .set('X-View-As-Session', session.body.session.id)
      .send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'blocked while viewing as' })
      .expect(403)
  })

  it('a session is bound to the Org Admin who started it; another Org Admin cannot use it', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'admin2@example.com', role: 'org_admin' }).expect(201)
    const admin2 = ctx.agent()
    await admin2.post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'admin2@example.com'), name: 'Admin Two', password: 'correct horse battery staple' }).expect(201)
    await admin2.post('/api/v1/auth/login').send({ email: 'admin2@example.com', password: 'correct horse battery staple' }).expect(200)

    const session = await admin.agent.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(201)
    await admin2
      .get(`/api/v1/orgs/${admin.orgId}/projects/${projectId}/hierarchy`)
      .set('X-View-As-Session', session.body.session.id)
      .expect(403)
  })

  it('a session past its one-hour TTL is refused', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const session = await admin.agent.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(201)
    await mongoose.connection.db.collection('viewassessions').updateOne({ _id: new mongoose.Types.ObjectId(session.body.session.id) }, { $set: { startedAt: new Date(Date.now() - 61 * 60 * 1000) } })

    await admin.agent
      .get(`/api/v1/orgs/${admin.orgId}/projects/${projectId}/hierarchy`)
      .set('X-View-As-Session', session.body.session.id)
      .expect(403)
  })

  it('ending a session lets writes through again, and audits the end', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const session = await admin.agent.post(viewAsBase(admin.orgId, projectId)).send({ projectId, role: 'viewer' }).expect(201)

    await admin.agent.post(`${viewAsBase(admin.orgId, projectId)}/${session.body.session.id}/end`).expect(200)
    expect(await auditCount('view_as.ended')).toBe(1)
    await admin.agent.post(blockersBase(admin.orgId, projectId)).send({ buildingId: BUILDING_ID, phaseKey: 'survey', description: 'works again' }).expect(201)
  })
})
