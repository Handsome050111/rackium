import mongoose from 'mongoose'

// Runs fn inside a transaction. fn receives the session and must pass it to
// every query. Side effects that must not repeat (email, outbound calls) belong
// outside fn, because the driver may retry the callback.
export async function withTransaction(fn) {
  const session = await mongoose.startSession()
  try {
    let result
    await session.withTransaction(
      async () => {
        result = await fn(session)
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }
    )
    return result
  } finally {
    await session.endSession()
  }
}
