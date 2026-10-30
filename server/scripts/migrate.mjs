// One-time data steps of this release (src/ops/migrations.js), each once. Run
// by deploy/deploy.sh before it switches release; safe to run by hand:
//   node server/scripts/migrate.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadConfig } from '../src/config/index.js'
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js'
import { runMigrations } from '../src/ops/migrations.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })

const config = loadConfig()
await connectDatabase(config.MONGODB_URI)
try {
  const { ran, skipped } = await runMigrations({ log: (line) => console.log(line) })
  console.log(`Migrations: ${ran.length} run, ${skipped} already done.`)
} finally {
  await disconnectDatabase()
}
