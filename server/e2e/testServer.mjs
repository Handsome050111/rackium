// Real-mode Playwright harness: boots the actual Express app against an
// in-memory MongoDB replica set (the same one the server's own API tests
// use), with rate limits off so a scripted journey doesn't trip them.
//
// Sent emails are written to a JSON file next to this script rather than
// exposed through an HTTP route — the app being tested stays exactly what
// production runs (nothing test-only added to app.js). The Playwright specs
// in client/e2e-real/ read that file directly (they run in Node, not the
// browser) to recover verification and invitation links.
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createApp, DEFAULT_RATE_LIMITS } from '../src/app.js'
import { createLogger } from '../src/logger.js'
import { startReplSet, stopReplSet } from '../test/helpers/memoryDb.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

const here = path.dirname(fileURLToPath(import.meta.url))
export const EMAILS_FILE = path.join(here, '.runtime-emails.json')

const PORT = Number(process.env.E2E_SERVER_PORT || 4100)
const CLIENT_ORIGIN = process.env.E2E_CLIENT_ORIGIN || 'http://localhost:5174'

fs.writeFileSync(EMAILS_FILE, '[]')
const sent = []
const mailer = {
  async send(message) {
    sent.push({ ...message, at: new Date().toISOString() })
    await fs.promises.writeFile(EMAILS_FILE, JSON.stringify(sent, null, 2))
  },
}

const config = {
  NODE_ENV: 'test',
  PORT,
  MONGODB_URI: 'unused-in-tests',
  JWT_SECRET: 'e2e-real-mode-secret-at-least-thirty-two-chars',
  CLIENT_ORIGIN,
  PUBLIC_APP_URL: CLIENT_ORIGIN,
  TRUST_PROXY: 0,
  EMAIL_PROVIDER: 'console',
  EMAIL_FROM: 'Rackium <e2e@localhost>',
  LOG_LEVEL: 'silent',
  IS_PRODUCTION: false,
  // Survey photos uploaded during the e2e run (gitignored).
  FILE_STORAGE_DIR: path.join(here, '.runtime-files'),
}

// Playwright force-kills its web servers on Windows (no signal reaches us), so
// a killed server never removed its in-memory database. The Playwright global
// teardown (client/playwright-support/globalTeardown.mjs) asks for a clean
// shutdown first. The route lives on this harness's own HTTP server, in front
// of the app, so the app under test stays exactly what production runs.
export const SHUTDOWN_PATH = '/__e2e/shutdown'

let shuttingDown = null
function shutdown(server, replSet) {
  shuttingDown ??= (async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    await stopReplSet(replSet)
  })()
    .catch(() => {})
    .finally(() => process.exit(0))
  return shuttingDown
}

async function main() {
  const replSet = await startReplSet()
  // Same boot step as src/index.js: the placeholder global catalogue.
  await seedPlatformCatalogue()
  const app = createApp({ config, logger: createLogger({ level: 'silent' }), mailer, rateLimits: { ...DEFAULT_RATE_LIMITS, enabled: false } })
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === SHUTDOWN_PATH) {
      // The pid lets the teardown wait until this process has really gone
      // (its database folder is removed on the way out).
      res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ stopping: true, pid: process.pid }), () => shutdown(server, replSet))
      return
    }
    app(req, res)
  })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => shutdown(server, replSet))
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`e2e test server listening on ${PORT}, allowing ${CLIENT_ORIGIN}`)
  })
}

main()
