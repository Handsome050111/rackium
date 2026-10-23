import { beforeEach, afterEach, afterAll } from 'vitest'
import { endTest, drain } from '../helpers/isolation.js'
import { removeTestFilesDir } from '../helpers/testDbDirs.js'

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

// The files this test file's apps stored are removed when it ends, also after
// failed or timed-out tests (after-hooks run last-registered first, so this
// runs after the file's own afterAll).
afterAll(() => {
  removeTestFilesDir()
})
