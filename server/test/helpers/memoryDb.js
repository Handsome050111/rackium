import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'

// One single-member replica set per test file. Transactions need a replica set,
// so a plain in-memory server would hide transaction bugs.
export async function startReplSet() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(replSet.getUri(), { serverSelectionTimeoutMS: 20000 })
  return replSet
}

export async function stopReplSet(replSet) {
  await mongoose.disconnect()
  await replSet.stop()
}

// Clears data between tests without going through model hooks: this is test
// plumbing, not an application path, so it may touch every collection.
export async function clearAll() {
  const collections = await mongoose.connection.db.collections()
  await Promise.all(collections.map((c) => c.deleteMany({})))
}
