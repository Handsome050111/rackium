// npm run clean:test-db — removes in-memory MongoDB folders and test file
// stores our test runs left behind. Only touches <tmp>/rackium-test-db/run-*/
// (where our tests put their mongo-mem-* and files-* folders), skipping any
// run whose process is still alive, and the old-layout
// <tmp>/rackium-test-files-<pid> folders. Folders of other projects in the
// system temp folder are never touched.
import { TEST_DB_ROOT, sweepLeftovers, sweepLegacyFileDirs } from '../test/helpers/testDbDirs.js'

const { removed, inUse, failed } = sweepLeftovers()
const legacy = sweepLegacyFileDirs()
console.log(`Test database folder: ${TEST_DB_ROOT}`)
console.log(`Removed ${removed.length} leftover run folder(s).`)
console.log(`Removed ${legacy.removed.length} old rackium-test-files-* folder(s) (${(legacy.bytes / 1048576).toFixed(1)} MB).`)
if (inUse.length) console.log(`Kept ${inUse.length} folder(s) in use by a running test run.`)
if (legacy.inUse.length) console.log(`Kept ${legacy.inUse.length} old file folder(s) whose test process may still be running.`)
const notRemoved = [...failed, ...legacy.failed]
if (notRemoved.length) {
  console.log(`Could not remove ${notRemoved.length} folder(s) (files still locked):`)
  for (const dir of notRemoved) console.log(`  ${dir}`)
  process.exitCode = 1
}
