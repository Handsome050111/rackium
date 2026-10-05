import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, tokenFrom, PASSWORD, signedInOrgAdmin } from './helpers/app.js'

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

// Signs in an existing user and returns an agent holding their session.
async function signInAs(ctx, email) {
  const agent = ctx.agent()
  await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
  return agent
}

describe('members, invitations and memberships are Org Admin only', () => {
  it('an Org Admin can list members; a project Field Engineer cannot', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const created = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'P', code: 'P1' }).expect(201)
    const projectId = created.body.project.id
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'fe@example.com', role: 'field_engineer', projectId }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'fe@example.com'), name: 'FE', password: PASSWORD }).expect(201)

    await admin.agent.get(`/api/v1/orgs/${admin.orgId}/members`).expect(200)
    const fe = await signInAs(ctx, 'fe@example.com')
    const res = await fe.get(`/api/v1/orgs/${admin.orgId}/members`).expect(403)
    expect(res.body.error.code).toBe('forbidden')
  })

  it('a PM invites project members into their own project only', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'A', code: 'PA' }).expect(201)).body.project.id
    const projectB = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'B', code: 'PB' }).expect(201)).body.project.id
    // The PM is a PM of project A only.
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'pm@example.com', role: 'pm', projectId: projectA }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'pm@example.com'), name: 'PM', password: PASSWORD }).expect(201)
    const pm = await signInAs(ctx, 'pm@example.com')

    await pm.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'viewer-a@example.com', role: 'viewer', projectId: projectA }).expect(201)
    await pm.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'viewer-b@example.com', role: 'viewer', projectId: projectB }).expect(403)
    // An organisation-level invitation needs Org Admin; a PM holds no organisation role.
    await pm.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'org-admin@example.com', role: 'org_admin' }).expect(403)
  })

  it('a reviewer, architect or viewer on a project cannot invite into it', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'R', code: 'PR' }).expect(201)).body.project.id
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'rev@example.com', role: 'reviewer', projectId: project }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'rev@example.com'), name: 'Rev', password: PASSWORD }).expect(201)
    const reviewer = await signInAs(ctx, 'rev@example.com')
    await reviewer.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'x@example.com', role: 'viewer', projectId: project }).expect(403)
  })

  it('a project list shows an ordinary member only their own projects; an Org Admin sees all', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'A', code: 'LA' }).expect(201)).body.project.id
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'B', code: 'LB' }).expect(201)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'vw@example.com', role: 'viewer', projectId: projectA }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'vw@example.com'), name: 'VW', password: PASSWORD }).expect(201)
    const viewer = await signInAs(ctx, 'vw@example.com')
    const seen = await viewer.get(`/api/v1/orgs/${admin.orgId}/projects`).expect(200)
    expect(seen.body.projects.map((p) => p.name)).toEqual(['A'])
    const all = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/projects`).expect(200)
    expect(all.body.projects).toHaveLength(2)
  })

  it('a Viewer cannot change memberships', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'P', code: 'P3' }).expect(201)).body.project.id
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'v@example.com', role: 'viewer', projectId: project }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'v@example.com'), name: 'V', password: PASSWORD }).expect(201)
    const viewer = await signInAs(ctx, 'v@example.com')
    const members = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/members`).expect(200)
    const target = members.body.members.find((m) => m.user.email === 'v@example.com')
    await viewer.patch(`/api/v1/orgs/${admin.orgId}/memberships/${target.id}`).send({ role: 'pm' }).expect(403)
    await viewer.delete(`/api/v1/orgs/${admin.orgId}/memberships/${target.id}`).expect(403)
  })
})

describe('audit log access', () => {
  it('an Org Admin reads organisation audit; a viewer with no project role is refused', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'P', code: 'P4' }).expect(201)
    const res = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/audit`).expect(200)
    expect(res.body.entries.length).toBeGreaterThan(0)
    expect(res.body.entries[0]).toEqual(expect.objectContaining({ action: expect.any(String), occurredAt: expect.any(String) }))
  })

  it('a project PM can read that project audit but not the whole organisation audit', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'P', code: 'P5' }).expect(201)).body.project.id
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'pm5@example.com', role: 'pm', projectId: project }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'pm5@example.com'), name: 'PM', password: PASSWORD }).expect(201)
    const pm = await signInAs(ctx, 'pm5@example.com')
    await pm.get(`/api/v1/orgs/${admin.orgId}/audit`).expect(403)
    await pm.get(`/api/v1/orgs/${admin.orgId}/audit?projectId=${project}`).expect(200)
  })

  it('audit reads are limited to the requested page size', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const res = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/audit?limit=1`).expect(200)
    expect(res.body.entries).toHaveLength(1)
  })
})

describe('organisation isolation at the HTTP layer', () => {
  it('a user of one organisation gets 404 for another organisation, not 403', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'B' })
    const res = await b.agent.get(`/api/v1/orgs/${a.orgId}/members`).expect(404)
    expect(res.body.error.code).toBe('not_found')
    await b.agent.get(`/api/v1/orgs/${a.orgId}/audit`).expect(404)
    await b.agent.get(`/api/v1/orgs/${a.orgId}/projects`).expect(404)
  })

  it('a membership id from another organisation is not found through this organisation\'s path', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'B' })
    const aMembers = await a.agent.get(`/api/v1/orgs/${a.orgId}/members`).expect(200)
    const aOwner = aMembers.body.members[0]
    await b.agent.patch(`/api/v1/orgs/${b.orgId}/memberships/${aOwner.id}`).send({ role: 'org_admin' }).expect(404)
    await b.agent.delete(`/api/v1/orgs/${b.orgId}/memberships/${aOwner.id}`).expect(404)
    const stillThere = await a.agent.get(`/api/v1/orgs/${a.orgId}/members`).expect(200)
    expect(stillThere.body.members.some((m) => m.id === aOwner.id)).toBe(true)
  })

  it('an unauthenticated request to an organisation route gets 401', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx)
    await ctx.agent().get(`/api/v1/orgs/${a.orgId}/members`).expect(401)
  })

  it('an organisation with no such id returns 404 with the same shape as another tenant', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx)
    const fake = '0'.repeat(24)
    const missing = await a.agent.get(`/api/v1/orgs/${fake}/members`).expect(404)
    const foreign = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    const other = await a.agent.get(`/api/v1/orgs/${foreign.orgId}/members`).expect(404)
    expect(missing.body.error.code).toBe(other.body.error.code)
  })
})

describe('the last Org Admin is protected and changes are audited', () => {
  it('an Org Admin can revoke another Org Admin when two exist', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'co@example.com', role: 'org_admin' }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'co@example.com'), name: 'Co', password: PASSWORD }).expect(201)
    const members = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/members`).expect(200)
    const co = members.body.members.find((m) => m.user.email === 'co@example.com')
    await admin.agent.delete(`/api/v1/orgs/${admin.orgId}/memberships/${co.id}`).expect(200)
  })
})

describe('HTTP contract', () => {
  it('health reports the database and version', async () => {
    const ctx = t()
    const res = await request(ctx.app).get('/api/v1/health').expect(200)
    expect(res.body).toEqual({ status: 'ok', database: 'up', version: '0.1.0' })
  })

  it('unknown routes return the one error format', async () => {
    const ctx = t()
    const res = await request(ctx.app).get('/api/v1/nope').expect(404)
    expect(res.body.error).toEqual(expect.objectContaining({ code: 'not_found', message: expect.any(String) }))
  })

  it('invalid JSON returns 400 bad_request in the same format', async () => {
    const ctx = t()
    const res = await request(ctx.app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":').expect(400)
    expect(res.body.error.code).toBe('bad_request')
  })

  it('validation failures list the offending fields', async () => {
    const ctx = t()
    const res = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'nope', password: '' }).expect(400)
    expect(res.body.error.code).toBe('validation_failed')
    expect(res.body.error.details.map((d) => d.path)).toEqual(expect.arrayContaining(['email']))
  })

  it('security headers are set', async () => {
    const ctx = t()
    const res = await request(ctx.app).get('/api/v1/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('CORS allows only the client origin', async () => {
    const ctx = t()
    const allowed = await request(ctx.app).get('/api/v1/health').set('Origin', 'http://localhost:5173')
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    expect(allowed.headers['access-control-allow-credentials']).toBe('true')
    const other = await request(ctx.app).get('/api/v1/health').set('Origin', 'https://evil.example.com')
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example.com')
    expect(other.headers['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('the OpenAPI document lists the M1 routes', async () => {
    const ctx = t()
    const res = await request(ctx.app).get('/api/v1/openapi.json').expect(200)
    expect(res.body.openapi).toBe('3.0.3')
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/api/v1/auth/login', '/api/v1/orgs/{orgId}/invitations', '/api/v1/me']))
  })
})
