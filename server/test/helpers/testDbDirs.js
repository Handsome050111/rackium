import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Every in-memory MongoDB our tests start keeps its data under one folder of
// our own: <tmp>/rackium-test-db/run-<id>/mongo-mem-<id>. Before this, the
// library put them straight into the system temp folder and a killed run
// (Playwright force-kills its web servers on Windows) left them there — 85
// folders, 16 GB, filled drive C: and made every API test "skip"
// (docs/BUG-SWEEP.md). Knowing the parent folder is what lets the sweep below
// remove only what our tests created.
export const TEST_DB_ROOT = path.join(os.tmpdir(), 'rackium-test-db')
const OWNER_FILE = 'owner.json'

// One folder per test run, owned by the process that will tear it down.
export function createRunDir(root = TEST_DB_ROOT, pid = process.pid) {
  fs.mkdirSync(root, { recursive: true })
  const dir = fs.mkdtempSync(path.join(root, 'run-'))
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid, startedAt: new Date().toISOString() }))
  return dir
}

export function createDbDir(runDir) {
  return fs.mkdtempSync(path.join(runDir, 'mongo-mem-'))
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return err.code === 'EPERM'
  }
}

// mongod can take a moment to release its files after it exits (Windows).
export function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    return !fs.existsSync(dir)
  } catch {
    return false
  }
}

function ownerOf(runDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, OWNER_FILE), 'utf8')).pid
  } catch {
    return null
  }
}

// Removes leftover run folders: only run-* folders inside our own root, and
// only when the process that owned the run has gone (a live owner means a test
// run is using it right now — deleting part of a running database would break
// that run). A run folder without a readable owner file is either being
// created this instant or damaged, so it is only removed once it is an hour old.
const UNOWNED_GRACE_MS = 60 * 60 * 1000

export function sweepLeftovers({ root = TEST_DB_ROOT, isAlive = pidAlive, now = Date.now() } = {}) {
  const result = { removed: [], inUse: [], failed: [] }
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue
    const dir = path.join(root, entry.name)
    const pid = ownerOf(dir)
    const inUse = pid === null ? now - fs.statSync(dir).mtimeMs < UNOWNED_GRACE_MS : isAlive(pid)
    if (inUse) {
      result.inUse.push(dir)
      continue
    }
    if (removeDir(dir)) result.removed.push(dir)
    else result.failed.push(dir)
  }
  return result
}
