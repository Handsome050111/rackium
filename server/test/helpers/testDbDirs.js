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

// The files the test apps store (uploads, generated documents) go into one
// folder per test process inside the run's folder: <run>/files-<pid>. Before
// this they went to <tmp>/rackium-test-files-<pid> and nothing removed them —
// 284 folders (143 MB) by M7a-2. The folder is removed after every test file
// (test/setup/isolation.js, an afterAll that runs even when tests failed or
// timed out) and when the process exits; a worker that crashed or was killed
// is covered by the run teardown and the sweep, as for the databases.
let filesDir = null
let ownedRunDir = null

export function testFilesDir(runDir = process.env.RACKIUM_TEST_DB_RUN) {
  if (filesDir) return filesDir
  let parent = runDir && fs.existsSync(runDir) ? runDir : null
  // Outside a Vitest run (a script importing the helpers): a run folder of
  // our own, so the sweep still finds it if this process is killed.
  if (!parent) parent = ownedRunDir = createRunDir()
  filesDir = path.join(parent, `files-${process.pid}`)
  process.once('exit', () => {
    removeDir(filesDir)
    if (ownedRunDir) removeDir(ownedRunDir)
  })
  return filesDir
}

// Removes this process's file folder now; the next test file in the same
// process starts with an empty one (file storage creates folders on write).
export function removeTestFilesDir() {
  return filesDir ? removeDir(filesDir) : true
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

// Folders of the old layout, <tmp>/rackium-test-files-<pid>, left by runs
// before the fix above. Only that exact name is touched. A pid can be reused
// by an unrelated program long after the test ended, so a folder whose pid is
// alive is still removed once it has not changed for a day — no test process
// lives that long.
const LEGACY_FILES_DIR = /^rackium-test-files-(\d+)$/
const LEGACY_STALE_MS = 24 * 60 * 60 * 1000

export function sweepLegacyFileDirs({ root = os.tmpdir(), isAlive = pidAlive, now = Date.now() } = {}) {
  const result = { removed: [], inUse: [], failed: [], bytes: 0 }
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const match = entry.isDirectory() && LEGACY_FILES_DIR.exec(entry.name)
    if (!match) continue
    const dir = path.join(root, entry.name)
    if (isAlive(Number(match[1])) && now - fs.statSync(dir).mtimeMs < LEGACY_STALE_MS) {
      result.inUse.push(dir)
      continue
    }
    const bytes = dirSize(dir)
    if (removeDir(dir)) {
      result.removed.push(dir)
      result.bytes += bytes
    } else result.failed.push(dir)
  }
  return result
}

function dirSize(dir) {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name)
      total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size
    }
  } catch {
    // A file vanished while counting; the size is only for the report.
  }
  return total
}
