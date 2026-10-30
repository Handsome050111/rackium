// Invites real testers from a list of name, email, role (docs/DEPLOY-DEMO.md).
// The list stays on the server: it holds personal data and is not in the repo.
//   node server/scripts/invite-testers.mjs --file /path/testers.csv [--dry-run]
//     [--project CNR] [--organisation "Northwind Networks (demo)"]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { loadConfig } from '../src/config/index.js'
import { createLogger } from '../src/logger.js'
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js'
import { createEmailSender } from '../src/email/index.js'
import { createAuthService } from '../src/auth/service.js'
import { createOrganisationService } from '../src/organisations/service.js'
import { parseTesterList, inviteTesters } from '../src/ops/testers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })

const args = process.argv.slice(2)
const option = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const file = option('file')
if (!file) {
  console.error('Usage: invite-testers.mjs --file testers.csv [--dry-run] [--project CNR] [--organisation NAME]')
  process.exit(2)
}

const { testers, problems } = parseTesterList(fs.readFileSync(file, 'utf8'))
if (problems.length) {
  console.error(`Nothing was sent. Fix the list first:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  process.exit(1)
}

const config = loadConfig()
const logger = createLogger({ level: 'warn' })
await connectDatabase(config.MONGODB_URI)
let failed = 0
try {
  const mailer = createEmailSender({ provider: config.EMAIL_PROVIDER, from: config.EMAIL_FROM, apiKey: config.RESEND_API_KEY, logger })
  const auth = createAuthService({ config, mailer, logger })
  const org = createOrganisationService({ mailer, auth })
  const results = await inviteTesters({ org, organisationName: option('organisation', 'Northwind Networks (demo)'), projectCode: option('project', 'CNR'), testers, dryRun: args.includes('--dry-run') })
  for (const r of results) console.log(`${r.outcome.padEnd(20)} ${r.email}  ${r.role}${r.reason ? `  ${r.reason}` : ''}`)
  failed = results.filter((r) => r.outcome === 'failed').length
  console.log(`${results.length} listed, ${results.filter((r) => r.outcome === 'invited').length} invited, ${failed} failed.`)
} finally {
  await disconnectDatabase()
}
process.exit(failed ? 1 : 0)
