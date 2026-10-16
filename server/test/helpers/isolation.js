import { AsyncLocalStorage } from 'node:async_hooks'
import { createRequire } from 'node:module'

// Test isolation: a test that ends — passed, failed or timed out — can never
// touch the next test's data. Each test app belongs to the test that created
// it (createTestApp → guard):
// - once that test has ended, its app refuses every request (503 stale_test),
//   so a timed-out test stops at its next API call;
// - work already inside a request (or started by one, e.g. a document job)
//   carries the test's number, and every database write it makes after the
//   test ended is refused at the driver;
// - after each test the run waits for the test's requests to finish before
//   the next test clears the database (test/setup/isolation.js).
// RACKIUM_TEST_ISOLATION=off disables it (only for the test that proves it).

// The driver copy mongoose uses (it bundles its own).
const requireFromMongoose = createRequire(createRequire(import.meta.url).resolve('mongoose'))
const { Collection } = requireFromMongoose('mongodb')

const enabled = process.env.RACKIUM_TEST_ISOLATION !== 'off'
const owner = new AsyncLocalStorage()
let current = 1
let inFlight = 0
let idle = []

export class StaleTestError extends Error {
  constructor(what) {
    super(`${what} from test #${owner.getStore()?.test} after it ended (now running test #${current})`)
    this.name = 'StaleTestError'
  }
}

// The running test has ended: from now on its apps and their work are stale.
export function endTest() {
  if (enabled) current += 1
}

const settle = () => {
  if (inFlight > 0) return
  const waiting = idle
  idle = []
  waiting.forEach((resolve) => resolve())
}

// Waits until no request of an ended test is still being handled.
export function drain(timeoutMs = 30000) {
  if (inFlight === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    idle.push(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

// The test app as the test that created it owns it. A Proxy keeps every
// property of the app (ctx.app.__documents …) and supertest still calls it.
export function guard(app) {
  if (!enabled) return app
  const test = current
  return new Proxy(app, {
    apply(target, self, args) {
      const [req, res] = args
      if (test !== current) {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { code: 'stale_test', message: `Request from test #${test}, which has ended` } }))
        return undefined
      }
      inFlight += 1
      let done = false
      const finish = () => {
        if (done) return
        done = true
        inFlight -= 1
        settle()
      }
      res.once('finish', finish)
      res.once('close', finish)
      return owner.run({ test }, () => Reflect.apply(target, self, [req, res, ...args.slice(2)]))
    },
  })
}

const WRITES = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite']
if (enabled && !Collection.prototype.__rackiumGuarded) {
  Collection.prototype.__rackiumGuarded = true
  for (const method of WRITES) {
    const original = Collection.prototype[method]
    Collection.prototype[method] = function guardedWrite(...args) {
      const store = owner.getStore()
      if (store && store.test !== current) return Promise.reject(new StaleTestError(`${method} on ${this.collectionName}`))
      return original.apply(this, args)
    }
  }
}
