import request from 'supertest'
import { createApp, DEFAULT_RATE_LIMITS } from '../../src/app.js'
import { createLogger } from '../../src/logger.js'
import { createMemoryEmailSender } from '../../src/email/index.js'
import { testConfig } from './config.js'

export function createTestApp({ rateLimits, config: overrides } = {}) {
  const config = testConfig(overrides)
  const logger = createLogger({ level: 'silent' })
  const mailer = createMemoryEmailSender()
  const limits = rateLimits ?? { ...DEFAULT_RATE_LIMITS, enabled: false }
  const app = createApp({ config, logger, mailer, rateLimits: limits })
  return { app, config, mailer, agent: () => request.agent(app) }
}

// Pulls the token out of the link in the most recent email to an address.
export function tokenFrom(mailer, to) {
  const message = mailer.lastTo(to)
  if (!message) throw new Error(`no email to ${to}`)
  const link = message.text.match(/https?:\/\/\S+/)[0]
  return new URL(link).searchParams.get('token')
}

export const PASSWORD = 'correct horse battery staple'

// Invites, accepts and signs in a project member with the given role. Returns
// a signed-in agent for them.
export async function projectMember(ctx, admin, { email, role, projectId, scopes }) {
  await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email, role, projectId, scopes }).expect(201)
  await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, email), name: role, password: PASSWORD }).expect(201)
  const agent = ctx.agent()
  await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
  return agent
}

// Signs up, verifies the email and returns a signed-in agent for the new org admin.
export async function signedInOrgAdmin(t, { email = 'owner@example.com', organisationName = 'Acme Build' } = {}) {
  await t.agent().post('/api/v1/auth/signup').send({ organisationName, name: 'Owner', email, password: PASSWORD }).expect(202)
  const token = tokenFrom(t.mailer, email)
  await t.agent().post('/api/v1/auth/verify-email').send({ token }).expect(200)
  const agent = t.agent()
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
  const orgId = res.body.memberships.find((m) => m.level === 'organisation').organisationId
  return { agent, orgId, userId: res.body.user.id, email }
}
