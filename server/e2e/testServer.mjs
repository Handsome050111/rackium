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
import { fileURLToPath } from 'node:url'
import { createApp, DEFAULT_RATE_LIMITS } from '../src/app.js'
import { createLogger } from '../src/logger.js'
import { startReplSet } from '../test/helpers/memoryDb.js'

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
}

async function main() {
  await startReplSet()
  const app = createApp({ config, logger: createLogger({ level: 'silent' }), mailer, rateLimits: { ...DEFAULT_RATE_LIMITS, enabled: false } })
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`e2e test server listening on ${PORT}, allowing ${CLIENT_ORIGIN}`)
  })
}

main()
