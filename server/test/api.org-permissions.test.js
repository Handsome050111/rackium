import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember, tokenFrom, PASSWORD } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

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
const orgPath = (orgId) => `/api/v1/orgs/${orgId}`

async function newProject(agent, orgId, code) {
  const res = await agent.post(`${orgPath(orgId)}/projects`).send({ name: `Project ${code}`, code }).expect(201)
  return res.body.project.id
}

async function memberRows(admin) {
  return (await admin.agent.get(`${orgPath(admin.orgId)}/members`).expect(200)).body.members
}
async function userIdOf(admin, email) {
  return (await memberRows(admin)).find((m) => m.user?.email === email).user.id
}
async function auditActions(admin) {
  return (await admin.agent.get(`${orgPath(admin.orgId)}/audit?limit=100`).expect(200)).body.entries.map((e) => e.action)
}
const setCreation = (admin, userId, allowed) => admin.agent.patch(`${orgPath(admin.orgId)}/members/${userId}/project-creation`).send({ allowed })

describe('project creation is an organisation-level permission', () => {
  it('a user invited as PM can create projects by default, and becomes PM of what they create', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const first = await newProject(admin.agent, admin.orgId, 'ONE')
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: first })

    const me = (await pm.get('/api/v1/me').expect(200)).body
    expect(me.memberships.find((m) => m.level === 'organisation')).toMatchObject({ role: 'member', canCreateProjects: true })

    const created = await newProject(pm, admin.orgId, 'MINE')
    const myRoles = (await pm.get('/api/v1/me')).body.memberships.filter((m) => m.projectId === created)
    expect(myRoles).toEqual([expect.objectContaining({ level: 'project', role: 'pm' })])
    expect(await auditActions(admin)).toContain('membership.project_creation.granted')
  })

  it('a member without the permission is refused; the Org Admin grants it, then revokes it — both audited', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId: project })

    const refused = await architect.post(`${orgPath(admin.orgId)}/projects`).send({ name: 'Nope', code: 'NOPE' }).expect(403)
    expect(refused.body.error.message).toMatch(/permission to create projects/)

    const userId = await userIdOf(admin, 'arch@example.com')
    expect((await setCreation(admin, userId, true).expect(200)).body).toEqual({ userId, canCreateProjects: true })
    await newProject(architect, admin.orgId, 'GRANT')

    await setCreation(admin, userId, false).expect(200)
    await architect.post(`${orgPath(admin.orgId)}/projects`).send({ name: 'Again', code: 'AGAIN' }).expect(403)

    const actions = await auditActions(admin)
    expect(actions).toContain('membership.project_creation.granted')
    expect(actions).toContain('membership.project_creation.revoked')
    const orgRow = (await memberRows(admin)).find((m) => m.user?.email === 'arch@example.com' && m.level === 'organisation')
    expect(orgRow).toMatchObject({ role: 'member', canCreateProjects: false })
  })

  it('a later PM invitation does not undo an Org Admin’s revoke', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const a = await newProject(admin.agent, admin.orgId, 'AAA')
    const b = await newProject(admin.agent, admin.orgId, 'BBB')
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: a })
    await setCreation(admin, await userIdOf(admin, 'pm@example.com'), false).expect(200)

    await admin.agent.post(`${orgPath(admin.orgId)}/invitations`).send({ email: 'pm@example.com', role: 'pm', projectId: b }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'pm@example.com'), password: PASSWORD }).expect(201)
    await pm.post(`${orgPath(admin.orgId)}/projects`).send({ name: 'Nope', code: 'NOPE' }).expect(403)
  })

  it('only an Org Admin grants; an Org Admin always can; only members of this organisation can be granted', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: project })
    await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId: project })
    const viewerId = await userIdOf(admin, 'viewer@example.com')

    await pm.patch(`${orgPath(admin.orgId)}/members/${viewerId}/project-creation`).send({ allowed: true }).expect(403)
    expect((await setCreation(admin, admin.userId, false).expect(409)).body.error.code).toBe('org_admin')
    await setCreation(admin, '65f0c0ffee0000000000dead', true).expect(404)
    // Org Admin can create regardless of any flag.
    await newProject(admin.agent, admin.orgId, 'ADMIN')
  })

  it('is isolated per organisation', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'Org A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'Org B' })
    const projectA = await newProject(a.agent, a.orgId, 'AAA')
    const projectB = await newProject(b.agent, b.orgId, 'BBB')

    // One person: PM in org A (so may create there), viewer in org B (may not).
    const person = await projectMember(ctx, a, { email: 'person@example.com', role: 'pm', projectId: projectA })
    await b.agent.post(`${orgPath(b.orgId)}/invitations`).send({ email: 'person@example.com', role: 'viewer', projectId: projectB }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: b.orgId, token: tokenFrom(ctx.mailer, 'person@example.com'), password: PASSWORD }).expect(201)

    await newProject(person, a.orgId, 'INA')
    await person.post(`${orgPath(b.orgId)}/projects`).send({ name: 'In B', code: 'INB' }).expect(403)

    // Org B's admin cannot grant on org A's route, nor reach org A's members.
    const personId = await userIdOf(a, 'person@example.com')
    await b.agent.patch(`${orgPath(a.orgId)}/members/${personId}/project-creation`).send({ allowed: false }).expect(404)
    // Granting in org B touches only org B's membership.
    await setCreation(b, personId, true).expect(200)
    await newProject(person, b.orgId, 'NOWB')
    await setCreation(a, personId, false).expect(200)
    await person.post(`${orgPath(a.orgId)}/projects`).send({ name: 'No', code: 'NOA' }).expect(403)
    await newProject(person, b.orgId, 'STILLB')
  })
})

describe('organisation membership rows created by project invitations', () => {
  it('revoking a member row is not blocked by the last-Org-Admin guard (which counts Org Admins only)', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId: project })
    const memberRow = (await memberRows(admin)).find((m) => m.user?.email === 'viewer@example.com' && m.level === 'organisation')
    await admin.agent.delete(`${orgPath(admin.orgId)}/memberships/${memberRow.id}`).expect(200)

    const adminRow = (await memberRows(admin)).find((m) => m.user?.email === 'owner@example.com' && m.level === 'organisation')
    expect((await admin.agent.delete(`${orgPath(admin.orgId)}/memberships/${adminRow.id}`).expect(409)).body.error.code).toBe('last_org_admin')
  })

  it('an Org Admin invitation upgrades the member row instead of being refused as a duplicate', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    const viewer = await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId: project })
    await admin.agent.post(`${orgPath(admin.orgId)}/invitations`).send({ email: 'viewer@example.com', role: 'org_admin' }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'viewer@example.com'), password: PASSWORD }).expect(201)

    const orgRows = (await viewer.get('/api/v1/me')).body.memberships.filter((m) => m.level === 'organisation')
    expect(orgRows).toEqual([expect.objectContaining({ role: 'org_admin', canCreateProjects: true })])
    await viewer.get(`${orgPath(admin.orgId)}/members`).expect(200)
  })

  it('a member row is not a policy role: it grants no Org Admin action', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: project })
    await pm.get(`${orgPath(admin.orgId)}/members`).expect(403)
    await pm.patch(`${orgPath(admin.orgId)}/settings`).send({ architectsSeePrices: true }).expect(403)
  })
})

describe('organisation setting: Architects can see prices', () => {
  it('is off by default; when on, Architects see prices and Field Engineers and Viewers still do not', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = await newProject(admin.agent, admin.orgId, 'ONE')
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId: project })
    const fieldEngineer = await projectMember(ctx, admin, { email: 'fe@example.com', role: 'field_engineer', projectId: project })
    const catalogue = (agent) => agent.get(`${orgPath(admin.orgId)}/catalogue?projectId=${project}&q=C9500`).expect(200)
    const price = (body) => body.items.find((i) => i.key === 'Cisco C9500').unitPriceMinor

    expect((await architect.get(`${orgPath(admin.orgId)}/settings`).expect(200)).body.settings).toMatchObject({ architectsSeePrices: false })
    let body = (await catalogue(architect)).body
    expect(body.pricesVisible).toBe(false)
    expect(price(body)).toBeNull()

    await admin.agent.patch(`${orgPath(admin.orgId)}/settings`).send({ architectsSeePrices: true }).expect(200)
    body = (await catalogue(architect)).body
    expect(body.pricesVisible).toBe(true)
    expect(price(body)).toBe(850000)
    const item = body.items.find((i) => i.key === 'Cisco C9500')
    expect((await architect.get(`${orgPath(admin.orgId)}/catalogue/${item.id}?projectId=${project}`).expect(200)).body.item.unitPriceMinor).toBe(850000)
    expect(price((await catalogue(fieldEngineer)).body)).toBeNull()
    expect(await auditActions(admin)).toContain('organisation.settings.updated')

    await admin.agent.patch(`${orgPath(admin.orgId)}/settings`).send({ architectsSeePrices: false }).expect(200)
    expect(price((await catalogue(architect)).body)).toBeNull()
  })

  it('only an Org Admin changes it, and one organisation’s setting does not affect another', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'Org A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'Org B' })
    const projectA = await newProject(a.agent, a.orgId, 'AAA')
    const architectA = await projectMember(ctx, a, { email: 'arch@example.com', role: 'architect', projectId: projectA })

    await architectA.patch(`${orgPath(a.orgId)}/settings`).send({ architectsSeePrices: true }).expect(403)
    await b.agent.patch(`${orgPath(a.orgId)}/settings`).send({ architectsSeePrices: true }).expect(404)
    await b.agent.patch(`${orgPath(b.orgId)}/settings`).send({ architectsSeePrices: true }).expect(200)
    const body = (await architectA.get(`${orgPath(a.orgId)}/catalogue?projectId=${projectA}`).expect(200)).body
    expect(body.pricesVisible).toBe(false)
  })
})
