import mongoose from 'mongoose'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, PASSWORD } from './helpers/app.js'

// The client IP is stored on every refresh token (meta.ip = req.ip). It must come
// from X-Forwarded-For only when TRUST_PROXY is set (the VPS sits behind Nginx).

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

const FORWARDED = '203.0.113.9'

async function storedIps() {
  const docs = await mongoose.connection.db.collection('refreshtokens').find({}).toArray()
  return docs.map((d) => d.ip)
}

describe('TRUST_PROXY', () => {
  it('is off by default: X-Forwarded-For is ignored and the socket address is recorded', async () => {
    const t = createTestApp()
    await signedInOrgAdmin(t)
    await request(t.app).post('/api/v1/auth/login').set('X-Forwarded-For', FORWARDED).send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const ips = await storedIps()
    expect(ips.length).toBeGreaterThan(0)
    expect(ips).not.toContain(FORWARDED)
  })

  it('when enabled (TRUST_PROXY=1), the client IP is taken from X-Forwarded-For', async () => {
    const t = createTestApp({ config: { TRUST_PROXY: 1 } })
    await signedInOrgAdmin(t)
    await request(t.app).post('/api/v1/auth/login').set('X-Forwarded-For', FORWARDED).send({ email: 'owner@example.com', password: PASSWORD }).expect(200)
    const ips = await storedIps()
    expect(ips).toContain(FORWARDED)
  })
})
