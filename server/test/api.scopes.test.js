import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, tokenFrom, PASSWORD } from './helpers/app.js'

// Membership scopes must name a country, SAL or building that exists in the
// organisation. Those records arrive in M2, so until then no scope is valid.

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
const SCOPE = { type: 'building', refId: '65f0c0ffee0000000000b001' }

describe('membership scopes', () => {
  it('an invitation that names a scope is refused, because nothing in the organisation can be referenced yet', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    const project = await agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)

    const res = await agent
      .post(`/api/v1/orgs/${orgId}/invitations`)
      .send({ email: 'scoped@example.com', role: 'field_engineer', projectId: project.body.project.id, scopes: [SCOPE] })
      .expect(400)
    expect(res.body.error.code).toBe('bad_request')
    expect(ctx.mailer.lastTo('scoped@example.com')).toBeFalsy()
  })

  it('a project membership cannot be given a scope through an update', async () => {
    const ctx = t()
    const { agent, orgId } = await signedInOrgAdmin(ctx)
    const project = await agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name: 'P', code: 'P1' }).expect(201)
    await agent.post(`/api/v1/orgs/${orgId}/invitations`).send({ email: 'eng@example.com', role: 'field_engineer', projectId: project.body.project.id }).expect(201)
    const accept = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: orgId, token: tokenFrom(ctx.mailer, 'eng@example.com'), name: 'Eng', password: PASSWORD }).expect(201)
    const membership = accept.body.memberships.find((m) => m.level === 'project')

    await agent.patch(`/api/v1/orgs/${orgId}/memberships/${membership.id}`).send({ scopes: [SCOPE] }).expect(400)
    // Clearing scopes is still allowed.
    await agent.patch(`/api/v1/orgs/${orgId}/memberships/${membership.id}`).send({ scopes: [] }).expect(200)
  })
})
