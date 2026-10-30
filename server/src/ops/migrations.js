import mongoose from 'mongoose'
import { backfillPhaseHistory } from '../schedule/service.js'
import { forEachProject } from '../notifications/jobs.js'

// One-time data steps a release needs (docs/DEPLOY-DEMO.md), run by the deploy
// script before it switches to the new release: each once, in order, recorded
// in `opsMigrations`. Forward only, and each must be safe to run again, since
// a crash can come after the step and before its record. New steps go at the
// end; a step's id never changes.
export const MIGRATIONS = [
  {
    id: '2026-10-phase-history-backfill',
    // M7a-1: every completed building × phase gets one `derived` history row.
    run: async () => backfillPhaseHistory({ forEachProject }),
  },
]

const COLLECTION = 'opsMigrations'

export async function runMigrations({ migrations = MIGRATIONS, log = () => {} } = {}) {
  const collection = mongoose.connection.db.collection(COLLECTION)
  const done = new Set((await collection.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id))
  const ran = []
  for (const migration of migrations) {
    if (done.has(migration.id)) continue
    log(`migration ${migration.id}: running`)
    const result = await migration.run()
    await collection.insertOne({ _id: migration.id, finishedAt: new Date(), result: result ?? null })
    log(`migration ${migration.id}: done ${JSON.stringify(result ?? {})}`)
    ran.push(migration.id)
  }
  return { ran, skipped: migrations.length - ran.length }
}
