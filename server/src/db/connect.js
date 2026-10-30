import mongoose from 'mongoose'

// Transactions need a replica set. Atlas clusters are replica sets by default;
// a single local node must be started with --replSet (see docs/BACKEND-SETUP.md).
export async function connectDatabase(uri, { serverSelectionTimeoutMS = 15000 } = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS })
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  if (!hello.setName) {
    await mongoose.disconnect()
    throw new Error('MongoDB must be a replica set: multi-document transactions are required. See docs/BACKEND-SETUP.md.')
  }
  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}

export function databaseIsUp() {
  return mongoose.connection.readyState === 1
}

// Does the database answer now? A connection can look open while the server
// behind it is gone, so this pings, briefly.
export async function databaseResponds(timeoutMs = 2000) {
  if (!databaseIsUp()) return false
  let timer
  try {
    await Promise.race([mongoose.connection.db.admin().ping(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)))])
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
