import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, tokenFrom, PASSWORD } from './helpers/app.js'
import { Invitation } from '../src/models/invitation.js'

// Regression (found in the M5b full run): the driver runs a transaction's
// callback again after a transient error (a write conflict under load).
// Accepting an invitation set the new user inside the callback, so the retry
// skipped creating the user and the request failed with a 500 — the
// membership pointed at a user that was never committed.
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
afterEach(() => {
  vi.restoreAllMocks()
})

// One write conflict, as the server reports it, then normal behaviour.
function conflictOnce(model, method) {
  const original = model[method].bind(model)
  let thrown = false
  return vi.spyOn(model, method).mockImplementation((...args) => {
    if (!thrown) {
      thrown = true
      throw new mongoose.mongo.MongoServerError({ message: 'WriteConflict (simulated)', code: 112, errorLabels: ['TransientTransactionError'] })
    }
    return original(...args)
  })
}

describe('a transaction retried after a transient error', () => {
  it('accepting an invitation as a new user still creates the user, once', async () => {
    const ctx = createTestApp()
    const admin = await signedInOrgAdmin(ctx)
    const project = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'Retry', code: 'RTY' }).expect(201)).body.project
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/invitations`).send({ email: 'new@example.com', role: 'field_engineer', projectId: project.id }).expect(201)
    const spy = conflictOnce(Invitation, 'updateOne')
    const res = await ctx.agent().post('/api/v1/auth/invitations/accept').send({ organisationId: admin.orgId, token: tokenFrom(ctx.mailer, 'new@example.com'), name: 'New Person', password: PASSWORD })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    const users = await mongoose.connection.db.collection('users').find({ email: 'new@example.com' }).toArray()
    expect(users).toHaveLength(1)
    const memberships = await mongoose.connection.db.collection('memberships').find({ userId: users[0]._id }).toArray()
    expect(memberships.map((m) => m.level).sort()).toEqual(['organisation', 'project'])
    await ctx.agent().post('/api/v1/auth/login').send({ email: 'new@example.com', password: PASSWORD }).expect(200)
  })
})
