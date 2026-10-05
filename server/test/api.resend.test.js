import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, tokenFrom, PASSWORD, signedInOrgAdmin } from './helpers/app.js'
import { DEFAULT_RATE_LIMITS } from '../src/app.js'

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
const auditCount = (action) => mongoose.connection.db.collection('auditentries').countDocuments({ action })

async function signUpUnverified(ctx, email) {
  await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Solo Co', name: 'Solo', email, password: PASSWORD }).expect(202)
}

// Creates a project, invites a person into it with a project role, and signs them in.
async function projectMember(ctx, admin, { email, role, projectId }) {
  await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email, role, projectId }).expect(201)
  await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, email), name: role, password: PASSWORD }).expect(201)
  const agent = ctx.agent()
  await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
  return agent
}

describe('resend verification email', () => {
  it('a fresh link verifies the account and the old link no longer works', async () => {
    const ctx = t()
    await signUpUnverified(ctx, 'ann@example.com')
    const oldToken = tokenFrom(ctx.mailer, 'ann@example.com')

    await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'ann@example.com' }).expect(202)
    const newToken = tokenFrom(ctx.mailer, 'ann@example.com')
    expect(newToken).not.toBe(oldToken)

    await ctx.agent().post('/api/v1/auth/verify-email').send({ token: oldToken }).expect(400)
    await ctx.agent().post('/api/v1/auth/verify-email').send({ token: newToken }).expect(200)
  })

  it('an address with no pending account gets the same reply and no email', async () => {
    const ctx = t()
    const res = await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'nobody@example.com' }).expect(202)
    expect(ctx.mailer.sent).toHaveLength(0)
    expect(res.body.message).toMatch(/sent an email/)
  })

  it('an already-verified account gets no new email', async () => {
    const ctx = t()
    await signUpUnverified(ctx, 'vee@example.com')
    await ctx.agent().post('/api/v1/auth/verify-email').send({ token: tokenFrom(ctx.mailer, 'vee@example.com') }).expect(200)
    const before = ctx.mailer.sent.length
    await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'vee@example.com' }).expect(202)
    expect(ctx.mailer.sent.length).toBe(before)
  })

  it('each resend is audit-logged', async () => {
    const ctx = t()
    await signUpUnverified(ctx, 'aud@example.com')
    await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'aud@example.com' }).expect(202)
    expect(await auditCount('auth.verification_resent')).toBe(1)
  })

  it('resends are rate-limited per client', async () => {
    const ctx = createTestApp({ rateLimits: { ...DEFAULT_RATE_LIMITS, enabled: true, resend: { windowMs: 60000, limit: 2, message: 'slow down' } } })
    for (let i = 0; i < 2; i++) {
      await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'x@example.com' }).expect(202)
    }
    const res = await ctx.agent().post('/api/v1/auth/verify-email/resend').send({ email: 'x@example.com' }).expect(429)
    expect(res.body.error.code).toBe('rate_limited')
  })
})

describe('resend invitation', () => {
  it('an Org Admin resends an invitation: the new link works, the old one does not', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const invite = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'guest@example.com', role: 'org_admin' }).expect(201)
    const oldToken = tokenFrom(ctx.mailer, 'guest@example.com')

    const resent = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations/${invite.body.invitation.id}/resend`).expect(200)
    expect(resent.body.invitation.id).toBe(invite.body.invitation.id)
    const newToken = tokenFrom(ctx.mailer, 'guest@example.com')
    expect(newToken).not.toBe(oldToken)

    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: oldToken, name: 'G', password: PASSWORD }).expect(400)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: newToken, name: 'G', password: PASSWORD }).expect(201)
  })

  it('the resend is audit-logged', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const invite = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'audit@example.com', role: 'org_admin' }).expect(201)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations/${invite.body.invitation.id}/resend`).expect(200)
    expect(await auditCount('invitation.resent')).toBe(1)
  })

  it('a PM resends a project invitation for their own project, but not another project\'s', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'A', code: 'RA' }).expect(201)).body.project.id
    const projectB = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'B', code: 'RB' }).expect(201)).body.project.id
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: projectA })

    const inA = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'va@example.com', role: 'viewer', projectId: projectA }).expect(201)
    const inB = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'vb@example.com', role: 'viewer', projectId: projectB }).expect(201)

    await pm.post(`/api/v1/orgs/${admin.orgId}/invitations/${inA.body.invitation.id}/resend`).expect(200)
    await pm.post(`/api/v1/orgs/${admin.orgId}/invitations/${inB.body.invitation.id}/resend`).expect(403)
  })

  it('a reviewer cannot resend an invitation', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const project = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'R', code: 'RR' }).expect(201)).body.project.id
    const reviewer = await projectMember(ctx, admin, { email: 'rev@example.com', role: 'reviewer', projectId: project })
    const inv = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'x@example.com', role: 'viewer', projectId: project }).expect(201)
    await reviewer.post(`/api/v1/orgs/${admin.orgId}/invitations/${inv.body.invitation.id}/resend`).expect(403)
  })

  it('an accepted invitation can no longer be resent', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const inv = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'done@example.com', role: 'org_admin' }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'done@example.com'), name: 'D', password: PASSWORD }).expect(201)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations/${inv.body.invitation.id}/resend`).expect(404)
  })

  it('an invitation from another organisation is not found', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'B' })
    const inv = await a.agent.post(`/api/v1/orgs/${a.orgId}/invitations`).send({ email: 'x@example.com', role: 'org_admin' }).expect(201)
    await b.agent.post(`/api/v1/orgs/${b.orgId}/invitations/${inv.body.invitation.id}/resend`).expect(404)
  })

  it('the pending list shows an Org Admin everything and a PM only their own project\'s invitations', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'A', code: 'LA2' }).expect(201)).body.project.id
    const projectB = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'B', code: 'LB2' }).expect(201)).body.project.id
    const pm = await projectMember(ctx, admin, { email: 'pm2@example.com', role: 'pm', projectId: projectA })
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'ia@example.com', role: 'viewer', projectId: projectA }).expect(201)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'ib@example.com', role: 'viewer', projectId: projectB }).expect(201)

    const all = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/invitations`).expect(200)
    // The PM's own invitation was accepted, so only the two new ones are pending.
    expect(all.body.invitations.map((i) => i.email).sort()).toEqual(['ia@example.com', 'ib@example.com'])
    const mine = await pm.get(`/api/v1/orgs/${admin.orgId}/invitations`).expect(200)
    expect(mine.body.invitations.map((i) => i.email)).toEqual(['ia@example.com'])
  })
})
