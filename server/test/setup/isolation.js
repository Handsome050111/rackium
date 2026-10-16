import { beforeEach, afterEach } from 'vitest'
import { endTest, drain } from '../helpers/isolation.js'

// Every test file (vitest.config.js setupFiles): a test that times out is
// ended at once — its apps refuse further requests and its in-flight work can
// no longer write — and the next test starts only after its requests are done.
beforeEach(({ signal }) => {
  signal.addEventListener('abort', endTest, { once: true })
})

afterEach(async () => {
  endTest()
  if (!(await drain())) throw new Error('A test left requests running for 30 s after it ended')
})
