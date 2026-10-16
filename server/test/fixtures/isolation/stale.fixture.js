import { it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import request from 'supertest'
import { startReplSet, stopReplSet, clearAll } from '../../helpers/memoryDb.js'
import { createTestApp, PASSWORD } from '../../helpers/app.js'
import { guard } from '../../helpers/isolation.js'

// Run by test/isolation.test.js in its own Vitest process: the first test
// times out on purpose while it keeps calling the API and has a request in
// flight that writes after the timeout; the next tests check nothing of it
// reaches their data.
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
const col = (name) => mongoose.connection.db.collection(name)
const seen = { refused: 0, inFlightWrite: 'pending' }

it('slow test: times out while calling the API, with a request in flight', async () => {
  const ctx = createTestApp()
  // Already inside the server at the timeout; writes 1.5 s later.
  const slow = guard((req, res) => {
    setTimeout(async () => {
      try {
        await col('leaks').insertOne({ from: 'in-flight request' })
        seen.inFlightWrite = 'written'
      } catch (err) {
        seen.inFlightWrite = err.name
      }
      res.end('done')
    }, 1500)
  })
  request(slow).get('/').then(() => {}, () => {})
  for (let i = 0; i < 300; i++) {
    const res = await ctx.agent().post('/api/v1/auth/signup').send({ organisationName: `Leak ${i}`, name: 'Leak', email: `leak${i}@example.com`, password: PASSWORD })
    if (res.status === 503) {
      seen.refused += 1
      return
    }
    await new Promise((r) => setTimeout(r, 25))
  }
}, 1000)

it('next test: none of the timed-out test\'s writes arrive', async () => {
  await new Promise((r) => setTimeout(r, 3000))
  expect(await col('users').countDocuments()).toBe(0)
  expect(await col('organisations').countDocuments()).toBe(0)
  expect(await col('leaks').countDocuments()).toBe(0)
})

it('the timed-out test was stopped: its next request refused, its in-flight write rejected', () => {
  expect(seen.refused).toBe(1)
  expect(seen.inFlightWrite).toBe('StaleTestError')
})
