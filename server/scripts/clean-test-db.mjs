// npm run clean:test-db — removes in-memory MongoDB folders our test runs left
// behind. Only touches <tmp>/rackium-test-db/run-*/ (where our tests put their
// mongo-mem-* folders) and skips any run whose process is still alive. Folders
// of other projects in the system temp folder are never touched.
import { TEST_DB_ROOT, sweepLeftovers } from '../test/helpers/testDbDirs.js'

const { removed, inUse, failed } = sweepLeftovers()
console.log(`Test database folder: ${TEST_DB_ROOT}`)
console.log(`Removed ${removed.length} leftover run folder(s).`)
if (inUse.length) console.log(`Kept ${inUse.length} folder(s) in use by a running test run.`)
if (failed.length) {
  console.log(`Could not remove ${failed.length} folder(s) (files still locked):`)
  for (const dir of failed) console.log(`  ${dir}`)
  process.exitCode = 1
}
