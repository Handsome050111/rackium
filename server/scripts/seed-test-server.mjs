// The synthetic demo project on the test server (docs/DEPLOY-DEMO.md): the same
// data as dev:local, built through the API, with one difference that matters on
// the internet: the password is generated here, not the one in the repo, and is
// written only to a private file, never printed. Refuses to run twice.
//   node server/scripts/seed-test-server.mjs [--logins-file /opt/rackium/demo-logins.txt]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import request from 'supertest'
import { loadConfig } from '../src/config/index.js'
import { createLogger } from '../src/logger.js'
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js'
import { createApp, DEFAULT_RATE_LIMITS } from '../src/app.js'
import { createMemoryEmailSender } from '../src/email/index.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { Organisation } from '../src/models/organisation.js'
import { seedDemo, DEMO_USERS, DEMO_ORGANISATION } from '../dev/demoData.js'
import { closePdfBrowserIfLoaded } from '../src/documents/render/chromium.js'

const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true })

const flag = process.argv.indexOf('--logins-file')
const loginsFile = flag >= 0 ? process.argv[flag + 1] : '/opt/rackium/demo-logins.txt'

const config = loadConfig()
const logger = createLogger({ level: 'warn' })
await connectDatabase(config.MONGODB_URI)
let code = 0
try {
  if (await Organisation.exists({ name: DEMO_ORGANISATION })) {
    console.error(`${DEMO_ORGANISATION} already exists: nothing was changed.`)
    code = 1
  } else {
    await seedPlatformCatalogue()
    // In this process only: the seed signs up through the API over plain http,
    // and its example.com addresses get no mail (the mailer is in memory).
    const mailer = createMemoryEmailSender()
    const app = createApp({ config: { ...config, IS_PRODUCTION: false, SIGNUP_ENABLED: true }, logger, mailer, rateLimits: { ...DEFAULT_RATE_LIMITS, enabled: false } })
    const password = crypto.randomBytes(18).toString('base64url')
    const { orgId, projectId } = await seedDemo({ agent: () => request.agent(app), mailer, password, processDocuments: () => app.__documents.process({ limit: 50 }), log: (line) => console.log(line) })
    const lines = [`Rackium demo sign-ins (${config.PUBLIC_APP_URL})`, `Password for every user: ${password}`, '', ...DEMO_USERS.map((u) => `${u.role.padEnd(18)} ${u.email}`), '', `Organisation ${orgId}, project ${projectId}`, '']
    fs.writeFileSync(loginsFile, lines.join('\n'), { mode: 0o600 })
    console.log(`Demo data ready. Sign-ins are in ${loginsFile} (readable by its owner only).`)
  }
} catch (err) {
  console.error(`Seeding failed: ${err.message}`)
  code = 1
} finally {
  await closePdfBrowserIfLoaded()
  await disconnectDatabase()
}
process.exit(code)
