// `npm run dev:local` — Rackium in real mode on this machine for a review,
// with nothing to install or configure (docs/BACKEND-SETUP.md):
//
// 1. an in-memory MongoDB replica set of its own (never the MongoDB Windows
//    service or a database from server/.env), its files in server/dev/.runtime/;
// 2. synthetic demo data built through the API (./demoData.js);
// 3. the real server (src/index.js: scheduler, console email) on 4300 and the
//    client in real mode (Vite) on 5300 — ports no test run uses (./runtime.js).
//
// Stop with Ctrl+C or `npm run dev:local:stop` (a control port, 4301, on
// 127.0.0.1 only). Both stop the server and client, stop the database and
// delete server/dev/.runtime/. The demo data does not outlive the run.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { ROLE_LABELS } from '@rackium/shared/policy.js'
import { DEV_PORTS, claimRuntimeDir, releaseRuntimeDir } from './runtime.js'
import { findBusyPorts } from '../../client/playwright-support/assertPortsFree.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const logsDir = path.join(root, 'logs')
const API = `http://localhost:${DEV_PORTS.api}`
const CLIENT = `http://localhost:${DEV_PORTS.client}`
const say = (line = '') => console.log(line) // eslint-disable-line no-console

// The whole environment of the server, so nothing in server/.env (a database,
// a mail provider) applies: dotenv never overrides a variable already set.
const serverEnv = ({ uri, filesDir }) => ({
  NODE_ENV: 'development',
  PORT: String(DEV_PORTS.api),
  MONGODB_URI: uri,
  JWT_SECRET: 'dev-local-only-secret-never-used-by-a-real-deployment',
  CLIENT_ORIGIN: CLIENT,
  PUBLIC_APP_URL: CLIENT,
  TRUST_PROXY: '0',
  EMAIL_PROVIDER: 'console',
  RESEND_API_KEY: '',
  EMAIL_FROM: 'Rackium (dev:local) <dev@localhost>',
  LOG_LEVEL: 'info',
  FILE_STORAGE_DIR: filesDir,
  DOCUMENTS_AUTO_PROCESS: 'true',
})

const children = []
let replSet = null
let claimed = false
let control = null
let stopping = null

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    // Our own child's tree only (Vite's esbuild, the server's Chromium).
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  } catch {
    // Already gone.
  }
}

function stop(code = 0, why = null) {
  stopping ??= (async () => {
    if (why) say(`\n${why}`)
    say('\nStopping dev:local …')
    for (const child of children) killTree(child)
    control?.close()
    await mongoose.disconnect().catch(() => {})
    await replSet?.stop({ doCleanup: true, force: true }).catch(() => {})
    // Only a folder this process took: a start refused because another run
    // is going must leave that run's folder alone.
    if (claimed) {
      releaseRuntimeDir()
      say('Stopped. The demo database and its files are deleted.')
    }
  })().finally(() => process.exit(code))
  return stopping
}

function startChild(name, args, { cwd, env }) {
  const log = path.join(logsDir, `dev-local-${name}.log`)
  const out = fs.openSync(log, 'w')
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', out, out], windowsHide: true })
  children.push(child)
  child.once('exit', (code) => {
    if (!stopping) stop(1, `The ${name} stopped unexpectedly (exit ${code}); see logs/dev-local-${name}.log.`)
  })
  return child
}

async function waitFor(url, what, timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (stopping) return
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`The ${what} did not answer at ${url} within ${timeoutMs / 1000} s; see logs/dev-local-*.log.`)
}

async function main() {
  const busy = await findBusyPorts(Object.values(DEV_PORTS))
  if (busy.length) {
    throw new Error(`Port(s) ${busy.join(', ')} already in use — is dev:local already running? Stop it with: npm run dev:local:stop`)
  }
  const { dbDir, filesDir } = claimRuntimeDir()
  claimed = true
  fs.mkdirSync(logsDir, { recursive: true })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => stop(0))

  // `npm run dev:local:stop` from another terminal.
  control = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/shutdown') {
      res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ stopping: true, pid: process.pid }), () => stop(0))
      return
    }
    res.writeHead(404).end()
  })
  await new Promise((resolve) => control.listen(DEV_PORTS.control, '127.0.0.1', resolve))

  say('Starting an in-memory MongoDB replica set …')
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ dbPath: dbDir }] })
  const uri = replSet.getUri('rackium-dev-local')
  const env = serverEnv({ uri, filesDir })

  // The client builds while the data is seeded.
  // Vite's exports hide its bin; its package.json says where it is.
  const vitePkg = createRequire(path.join(root, 'client', 'package.json')).resolve('vite/package.json')
  const viteBin = path.join(path.dirname(vitePkg), JSON.parse(fs.readFileSync(vitePkg, 'utf8')).bin.vite)
  startChild('client', [viteBin, '--port', String(DEV_PORTS.client), '--strictPort'], { cwd: path.join(root, 'client'), env: { ...process.env, VITE_API_MODE: 'real', VITE_API_TARGET: API } })

  // Seeding runs in this process through its own app on the same database:
  // it reads the verification and invitation links from a memory mailer.
  // The seeder reuses the API tests' survey helpers; their write guard is for
  // test runs only.
  process.env.RACKIUM_TEST_ISOLATION = 'off'
  const { loadConfig } = await import('../src/config/index.js')
  const { createApp, DEFAULT_RATE_LIMITS } = await import('../src/app.js')
  const { createLogger } = await import('../src/logger.js')
  const { createMemoryEmailSender } = await import('../src/email/index.js')
  const { seedPlatformCatalogue } = await import('../src/catalogue/seed.js')
  const { closePdfBrowserIfLoaded } = await import('../src/documents/render/chromium.js')
  const { seedDemo, DEMO_USERS, DEMO_PASSWORD, DEMO_ORGANISATION, DEMO_PROJECT } = await import('./demoData.js')
  await mongoose.connect(uri)
  await seedPlatformCatalogue()
  const mailer = createMemoryEmailSender()
  const app = createApp({ config: loadConfig({ ...env, DOCUMENTS_AUTO_PROCESS: 'false' }), logger: createLogger({ level: 'silent' }), mailer, rateLimits: { ...DEFAULT_RATE_LIMITS, enabled: false } })
  say('Loading the demo data (a few minutes: every building is taken through the real workflow) …')
  const started = Date.now()
  const seeded = await seedDemo({ agent: () => request.agent(app), mailer, processDocuments: () => app.__documents.process({ limit: 50 }), log: (line) => say(`  ${line}`) })
  await closePdfBrowserIfLoaded()
  await mongoose.disconnect()
  say(`  done in ${Math.round((Date.now() - started) / 1000)} s`)

  startChild('server', [path.join(root, 'server', 'src', 'index.js')], { cwd: path.join(root, 'server'), env: { ...process.env, ...env } })
  await waitFor(`${API}/api/v1/health`, 'server')
  await waitFor(CLIENT, 'client')
  if (stopping) return

  const width = Math.max(...DEMO_USERS.map((u) => u.email.length))
  say()
  say('Rackium dev:local is running — real mode, in-memory database, synthetic demo data.')
  say()
  say(`  Open        ${CLIENT}`)
  say(`  API         ${API}/api/v1`)
  say(`  Password    ${DEMO_PASSWORD}   (every user)`)
  say()
  for (const u of DEMO_USERS) say(`  ${ROLE_LABELS[u.role].padEnd(18)} ${u.email.padEnd(width)}  ${u.name}${u.note ? ` — ${u.note}` : ''}`)
  say()
  say(`  ${DEMO_ORGANISATION} › ${DEMO_PROJECT.name} (client: ${DEMO_PROJECT.clientName})`)
  for (const b of seeded.buildings) say(`    ${b.code} ${b.name.padEnd(16)} ${b.stageLabel}`)
  say()
  say('  Emails the app sends (invitations, password resets) are written to logs/dev-local-server.log.')
  say('  Stop: Ctrl+C here, or `npm run dev:local:stop` in another terminal. The demo data is deleted on stop.')
}

main().catch((err) => stop(1, `dev:local could not start: ${err.message}`))
