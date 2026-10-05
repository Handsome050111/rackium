import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, tokenFrom, PASSWORD, signedInOrgAdmin } from './helpers/app.js'
import { AuditEntry } from '../src/models/auditEntry.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { User } from '../src/models/user.js'
import mongoose from 'mongoose'
import request from 'supertest'

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

describe('sign-up and email verification', () => {
  it('sign-up is accepted and sends a verification email', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: PASSWORD }).expect(202)
    expect(ctx.mailer.lastTo('ann@example.com').subject).toMatch(/Confirm/)
  })

  it('a second sign-up with the same email is accepted without leaking that the account exists', async () => {
    const ctx = t()
    const body = { organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: PASSWORD }
    const first = await ctx.agent().post('/api/v1/auth/signup').send(body).expect(202)
    const second = await ctx.agent().post('/api/v1/auth/signup').send(body).expect(202)
    expect(second.body).toEqual(first.body)
    expect(ctx.mailer.sent).toHaveLength(1)
  })

  it('sign-in is refused until the email is verified', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: PASSWORD }).expect(202)
    const res = await ctx.agent().post('/api/v1/auth/login').send({ email: 'ann@example.com', password: PASSWORD }).expect(403)
    expect(res.body.error.code).toBe('email_not_verified')
  })

  it('a verification link works once', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: PASSWORD }).expect(202)
    const token = tokenFrom(ctx.mailer, 'ann@example.com')
    await ctx.agent().post('/api/v1/auth/verify-email').send({ token }).expect(200)
    const again = await ctx.agent().post('/api/v1/auth/verify-email').send({ token }).expect(400)
    expect(again.body.error.code).toBe('link_invalid')
  })

  it('creates the organisation with the creator as Org Admin', async () => {
    const ctx = t()
    const { agent } = await signedInOrgAdmin(ctx)
    const meRes = await agent.get('/api/v1/me').expect(200)
    expect(meRes.body.memberships).toEqual([expect.objectContaining({ level: 'organisation', role: 'org_admin' })])
  })

  it('password policy: passwords shorter than 12 characters are rejected', async () => {
    const ctx = t()
    const res = await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: 'short' }).expect(400)
    expect(res.body.error.code).toBe('validation_failed')
    expect(res.body.error.details.some((d) => d.path === 'password')).toBe(true)
  })
})

describe('sign-in, sign-out and lockout', () => {
  it('signs in, sets httpOnly cookies, and signs out', async () => {
    const ctx = t()
    const { agent } = await signedInOrgAdmin(ctx)
    const res = await agent.get('/api/v1/me').expect(200)
    expect(res.body.user.emailVerified).toBe(true)
    await agent.post('/api/v1/auth/logout').expect(204)
    await agent.get('/api/v1/me').expect(401)
  })

  it('session cookies are httpOnly and SameSite=Strict', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: 'ann@example.com', password: PASSWORD }).expect(202)
    await ctx.agent().post('/api/v1/auth/verify-email').send({ token: tokenFrom(ctx.mailer, 'ann@example.com') }).expect(200)
    const res = await ctx.agent().post('/api/v1/auth/login').send({ email: 'ann@example.com', password: PASSWORD }).expect(200)
    const cookies = res.headers['set-cookie']
    expect(cookies.some((c) => c.startsWith('rk_access=') && /HttpOnly/i.test(c) && /SameSite=Strict/i.test(c))).toBe(true)
    expect(cookies.some((c) => c.startsWith('rk_refresh=') && /Path=\/api\/v1\/auth/.test(c))).toBe(true)
  })

  it('a wrong password and an unknown email return the same error', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    const wrong = await ctx.agent().post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'not the password at all' }).expect(401)
    const unknown = await ctx.agent().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'not the password at all' }).expect(401)
    // requestId differs per response; the code and message must not.
    expect({ code: wrong.body.error.code, message: wrong.body.error.message }).toEqual({ code: unknown.body.error.code, message: unknown.body.error.message })
    expect(wrong.body.error.code).toBe('invalid_credentials')
  })

  it('failed sign-ins are audit-logged, including for unknown emails', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    await ctx.agent().post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'wrong wrong wrong!' }).expect(401)
    await ctx.agent().post('/api/v1/auth/login').send({ email: 'ghost@example.com', password: 'wrong wrong wrong!' }).expect(401)
    const system = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.login_failed', organisationId: null })
    expect(system).toBe(1)
    const failedForOwner = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.login_failed', organisationId: { $ne: null } })
    expect(failedForOwner).toBe(1)
  })

  it('locks the account after repeated failures; the correct password is refused during the lock', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    for (let i = 0; i < 10; i++) {
      await ctx.agent().post('/api/v1/auth/login').send({ email: 'owner@example.com', password: 'wrong wrong wrong!' }).expect(401)
    }
    await ctx.agent().post('/api/v1/auth/login').send({ email: 'owner@example.com', password: PASSWORD }).expect(401)
    const blocked = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.login_blocked' })
    expect(blocked).toBeGreaterThan(0)
  })

  it('a sign-in attempt is rate-limited per client when limits are on', async () => {
    const ctx = createTestApp({ rateLimits: { enabled: true, login: { windowMs: 60000, limit: 3, message: 'slow down' }, signup: { windowMs: 60000, limit: 5, message: 'x' }, verify: { windowMs: 60000, limit: 5, message: 'x' }, refresh: { windowMs: 60000, limit: 5, message: 'x' }, reset: { windowMs: 60000, limit: 5, message: 'x' }, invite: { windowMs: 60000, limit: 5, message: 'x' } } })
    for (let i = 0; i < 3; i++) {
      await ctx.agent().post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'whatever whatever' })
    }
    const res = await ctx.agent().post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'whatever whatever' }).expect(429)
    expect(res.body.error.code).toBe('rate_limited')
  })
})

describe('refresh tokens', () => {
  const cookieValue = (res, name) => res.headers['set-cookie'].find((c) => c.startsWith(name + '=')).split(';')[0].split('=')[1]

  it('rotates the refresh token on each refresh', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const first = cookieValue(login, 'rk_refresh')
    const refreshed = await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${first}`).expect(200)
    const second = cookieValue(refreshed, 'rk_refresh')
    expect(second).not.toBe(first)
  })

  it('a rotated token presented again within 30 seconds gets a session in the same family', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const original = cookieValue(login, 'rk_refresh')
    const rotated = cookieValue(await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(200), 'rk_refresh')

    // A racing request on the same cookie is not treated as reuse.
    const raced = cookieValue(await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(200), 'rk_refresh')
    expect(raced).not.toBe(original)
    expect(raced).not.toBe(rotated)
    // Both new tokens work, so the user stays signed in.
    await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${raced}`).expect(200)
    await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${rotated}`).expect(200)
    const flagged = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.refresh_reuse_detected' })
    expect(flagged).toBe(0)
  })

  it('after logout, a token rotated within the grace window does not start a new session', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const original = cookieValue(login, 'rk_refresh')
    const rotated = cookieValue(await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(200), 'rk_refresh')
    await request(ctx.app).post('/api/v1/auth/logout').set('Cookie', `rk_refresh=${rotated}`)

    await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(401)
  })

  it('a token presented after rotation and the grace window revokes the whole family', async () => {
    const ctx = t()
    await signedInOrgAdmin(ctx)
    const login = await request(ctx.app).post('/api/v1/auth/login').send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const original = cookieValue(login, 'rk_refresh')
    const rotated = cookieValue(await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(200), 'rk_refresh')

    // Move the rotation out of the 30-second grace window.
    await mongoose.connection.db.collection('refreshtokens').updateMany({ replacedBy: { $ne: null } }, { $set: { revokedAt: new Date(Date.now() - 60 * 1000) } })
    // Presenting the rotated-away token again is reuse.
    await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${original}`).expect(401)
    // The newest token belongs to the same family, so it is revoked too.
    await request(ctx.app).post('/api/v1/auth/refresh').set('Cookie', `rk_refresh=${rotated}`).expect(401)
    const flagged = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.refresh_reuse_detected' })
    expect(flagged).toBe(1)
  })
})

describe('password reset', () => {
  it('a reset request is always accepted, even for an unknown address', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/password-reset/request').send({ email: 'nobody@example.com' }).expect(202)
    expect(ctx.mailer.sent).toHaveLength(0)
  })

  it('a reset ends every existing session and sets the new password', async () => {
    const ctx = t()
    const { agent, email } = await signedInOrgAdmin(ctx)
    await ctx.agent().post('/api/v1/auth/password-reset/request').send({ email }).expect(202)
    const token = tokenFrom(ctx.mailer, email)
    const newPassword = 'a brand new passphrase 2026'
    await ctx.agent().post('/api/v1/auth/password-reset/confirm').send({ token, password: newPassword }).expect(200)

    await agent.get('/api/v1/me').expect(401)
    await ctx.agent().post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(401)
    await ctx.agent().post('/api/v1/auth/login').send({ email, password: newPassword }).expect(200)
  })

  it('a reset link works once', async () => {
    const ctx = t()
    const { email } = await signedInOrgAdmin(ctx)
    await ctx.agent().post('/api/v1/auth/password-reset/request').send({ email }).expect(202)
    const token = tokenFrom(ctx.mailer, email)
    await ctx.agent().post('/api/v1/auth/password-reset/confirm').send({ token, password: 'a brand new passphrase 2026' }).expect(200)
    await ctx.agent().post('/api/v1/auth/password-reset/confirm').send({ token, password: 'another passphrase 2026' }).expect(400)
  })
})

describe('invitations and memberships', () => {
  it('an Org Admin invites a project member; accepting creates the membership and signs them in', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    const project = await agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)
    const projectId = project.body.project.id

    await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'eng@example.com', role: 'field_engineer', projectId, scopes: [] }).expect(201)
    const token = tokenFrom(ctx.mailer, 'eng@example.com')

    const accepted = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: orgId, token, name: 'Eng', password: PASSWORD }).expect(201)
    expect(accepted.body.memberships).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'project', projectId, role: 'field_engineer' })]))
    expect(ctx.mailer.lastTo('eng@example.com').text).toContain(`org=${orgId}`)
  })

  it('accepting an invitation verifies an unverified existing account, so the session works straight away', async () => {
    const ctx = t()
    const host = await signedInOrgAdmin(ctx, { email: 'host@example.com', organisationName: 'Host Co' })
    // A person who signed up elsewhere but never confirmed their email.
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Their Own', name: 'Pat', email: 'pat@example.com', password: PASSWORD }).expect(202)
    await host.agent.post(`/api/v1/orgs/${host.orgId}/invitations`).send({ email: 'pat@example.com', role: 'org_admin' }).expect(201)
    const accepted = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: host.orgId, token: tokenFrom(ctx.mailer, 'pat@example.com'), password: PASSWORD }).expect(201)
    expect(accepted.body.user.emailVerified).toBe(true)
    const agent = ctx.agent()
    await agent.post('/api/v1/auth/login').send({ email: 'pat@example.com', password: PASSWORD }).expect(200)
    await agent.get('/api/v1/me').expect(200)
  })

  it('an invitation cannot be accepted twice', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'org2@example.com', role: 'org_admin' }).expect(201)
    const token = tokenFrom(ctx.mailer, 'org2@example.com')
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: orgId, token, name: 'Two', password: PASSWORD }).expect(201)
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: orgId, token, name: 'Two', password: PASSWORD }).expect(400)
  })

  it('a token from one organisation cannot be accepted under another organisation id', async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx, { email: 'a@example.com', organisationName: 'A' })
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'B' })
    await a.agent.post(`/api/v1/orgs/${a.orgId}/invitations`).send({ email: 'guest@example.com', role: 'org_admin' }).expect(201)
    const token = tokenFrom(ctx.mailer, 'guest@example.com')
    await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: b.orgId, token, name: 'Guest', password: PASSWORD }).expect(400)
  })

  it('a second pending invitation to the same address is refused', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'dup@example.com', role: 'org_admin' }).expect(201)
    const res = await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'dup@example.com', role: 'org_admin' }).expect(409)
    expect(res.body.error.code).toBe('invitation_pending')
  })

  it('the last Org Admin cannot be revoked', async () => {
    const ctx = t()
    const { agent, orgId, userId } = await signedInOrgAdmin(ctx)
    const members = await agent.get(`/api/v1/orgs/${orgId}/members`).expect(200)
    const mine = members.body.members.find((m) => m.user.id === userId)
    const res = await agent.delete(`/api/v1/orgs/${orgId}/memberships/${mine.id}`).expect(409)
    expect(res.body.error.code).toBe('last_org_admin')
  })

  it('a membership change is audit-logged with the field-level diff', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    const project = await agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'P', code: 'P1' }).expect(201)
    await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'arch@example.com', role: 'architect', projectId: project.body.project.id }).expect(201)
    const accept = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: orgId, token: tokenFrom(ctx.mailer, 'arch@example.com'), name: 'Arch', password: PASSWORD }).expect(201)
    const archMembership = accept.body.memberships.find((m) => m.level === 'project')

    await agent.patch(`/api/v1/orgs/${orgId}/memberships/${archMembership.id}`).send({ role: 'reviewer' }).expect(200)
    const entries = await runWithScope({ organisationId: new mongoose.Types.ObjectId(orgId) }, () => AuditEntry.find({ action: 'membership.updated' }).lean())
    expect(entries).toHaveLength(1)
    expect(entries[0].changes).toEqual([expect.objectContaining({ field: 'role', before: 'architect', after: 'reviewer' })])
  })
})

describe('the signed-in user record', () => {
  it('User emails are stored lower-cased', async () => {
    const ctx = t()
    await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: 'Acme', name: 'Ann', email: '  Ann@Example.COM ', password: PASSWORD }).expect(202)
    const user = await User.findOne({ email: 'ann@example.com' }).lean()
    expect(user).toBeTruthy()
  })
})
