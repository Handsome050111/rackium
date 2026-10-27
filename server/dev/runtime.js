import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pidAlive, removeDir } from '../test/helpers/testDbDirs.js'

// `npm run dev:local` (docs/BACKEND-SETUP.md): an in-memory database, the
// server and the client in real mode, with synthetic demo data. Its own ports,
// apart from `npm run dev` (4000, 5173) and the Playwright servers (5173,
// 4100, 5174), so a local review never blocks a test run.
export const DEV_PORTS = { api: 4300, control: 4301, client: 5300 }

// Everything the run writes (database files, uploaded and generated files)
// stays in one gitignored folder inside the repo, owned by the running
// process and removed when it stops.
export const RUNTIME_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.runtime')
const OWNER_FILE = 'owner.json'

export function readOwner(dir = RUNTIME_DIR) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8'))
  } catch {
    return null
  }
}

// Takes the runtime folder for this process: refused while another run that
// is still alive owns it; a folder left by a run that was killed is cleared.
export function claimRuntimeDir(dir = RUNTIME_DIR, { pid = process.pid, isAlive = pidAlive } = {}) {
  const owner = readOwner(dir)
  if (owner && owner.pid !== pid && isAlive(owner.pid)) {
    throw new Error(`dev:local is already running (process ${owner.pid}). Stop it with: npm run dev:local:stop`)
  }
  if (fs.existsSync(dir) && !removeDir(dir)) throw new Error(`Could not clear ${dir} left by an earlier run; close whatever still uses it and try again.`)
  const dbDir = path.join(dir, 'db')
  const filesDir = path.join(dir, 'files')
  fs.mkdirSync(dbDir, { recursive: true })
  fs.mkdirSync(filesDir, { recursive: true })
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid, startedAt: new Date().toISOString(), ports: DEV_PORTS }))
  return { dir, dbDir, filesDir }
}

export const releaseRuntimeDir = (dir = RUNTIME_DIR) => removeDir(dir)
