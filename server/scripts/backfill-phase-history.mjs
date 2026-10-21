// Backfills the phase history (DATA-MODEL §5.10, M7a-1) from the audit log:
// every completed building × phase with no history yet gets one `derived`
// row, dated by the audit entry that completed it, or with no date
// (`dateKnown: false`) when the log has no evidence — dates are never
// invented. Idempotent: a second run writes nothing. Run by hand:
//   node server/scripts/backfill-phase-history.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadConfig } from '../src/config/index.js'
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js'
import { backfillPhaseHistory } from '../src/schedule/service.js'
import { forEachProject } from '../src/notifications/jobs.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })

const config = loadConfig()
await connectDatabase(config.MONGODB_URI)
try {
  const result = await backfillPhaseHistory({ forEachProject })
  console.log(`Phase history backfill: ${result.written} row(s) written across ${result.projects} project(s).`)
} finally {
  await disconnectDatabase()
}
