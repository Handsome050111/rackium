import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { createDbDir, createRunDir, removeDir } from './testDbDirs.js'

// The test run's folder (test/globalSetup.js, or the Playwright config for the
// e2e server). A process started without one makes its own.
let ownRunDir = null
function runDir() {
  if (process.env.RACKIUM_TEST_DB_RUN) return process.env.RACKIUM_TEST_DB_RUN
  ownRunDir ??= createRunDir()
  return ownRunDir
}

// One single-member replica set per test file. Transactions need a replica set,
// so a plain in-memory server would hide transaction bugs.
export async function startReplSet() {
  const dbPath = createDbDir(runDir())
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ dbPath }],
  })
  await mongoose.connect(replSet.getUri(), { serverSelectionTimeoutMS: 20000 })
  return replSet
}

export async function stopReplSet(replSet) {
  await mongoose.disconnect()
  // force: the dbPath is ours, not the library's temp folder, so the library
  // only removes it when told to.
  const dbPath = replSet.servers[0]?.instanceInfo?.dbPath
  await replSet.stop({ doCleanup: true, force: true })
  if (dbPath) removeDir(dbPath)
  if (ownRunDir) {
    removeDir(ownRunDir)
    ownRunDir = null
  }
}

// Clears data between tests without going through model hooks: this is test
// plumbing, not an application path, so it may touch every collection.
export async function clearAll() {
  const collections = await mongoose.connection.db.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
}
