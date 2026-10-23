import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, afterAll } from 'vitest'
import { createDbDir, createRunDir, sweepLeftovers, sweepLegacyFileDirs, TEST_DB_ROOT } from './helpers/testDbDirs.js'
import { startReplSet, stopReplSet } from './helpers/memoryDb.js'
import { testConfig } from './helpers/config.js'
import setup from './globalSetup.js'

// Regression: 85 mongo-mem-* folders (16 GB) left in the system temp folder by
// killed test runs filled drive C:, and every API test then "skipped".
describe('in-memory test databases are always removed', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rackium-sweep-test-'))
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))

  it('keeps every database of a run inside that run’s folder, and stopping removes it', async () => {
    const runDir = process.env.RACKIUM_TEST_DB_RUN
    expect(path.dirname(runDir)).toBe(TEST_DB_ROOT)
    const replSet = await startReplSet()
    const dbPath = replSet.servers[0].instanceInfo.dbPath
    expect(path.dirname(dbPath)).toBe(runDir)
    expect(path.basename(dbPath)).toMatch(/^mongo-mem-/)
    expect(fs.existsSync(dbPath)).toBe(true)
    await stopReplSet(replSet)
    expect(fs.existsSync(dbPath)).toBe(false)
  })

  it('the run teardown removes the run folder even when a database was never stopped', () => {
    const before = process.env.RACKIUM_TEST_DB_RUN
    try {
      const teardown = setup()
      const dir = process.env.RACKIUM_TEST_DB_RUN
      fs.writeFileSync(path.join(createDbDir(dir), 'WiredTiger'), 'left by a crashed worker')
      teardown()
      expect(fs.existsSync(dir)).toBe(false)
    } finally {
      process.env.RACKIUM_TEST_DB_RUN = before
    }
  })

  it('the sweep removes only run folders whose owner has gone, never anything else', () => {
    const root = path.join(scratch, 'root')
    const dead = createRunDir(root, 111)
    createDbDir(dead)
    const live = createRunDir(root, 222)
    const freshUnowned = fs.mkdtempSync(path.join(root, 'run-'))
    const oldUnowned = fs.mkdtempSync(path.join(root, 'run-'))
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(oldUnowned, old, old)
    const notOurs = path.join(root, 'mongo-mem-someone-else')
    fs.mkdirSync(notOurs)
    const outside = fs.mkdtempSync(path.join(scratch, 'mongo-mem-'))

    const result = sweepLeftovers({ root, isAlive: (pid) => pid === 222 })

    expect(result.removed.sort()).toEqual([dead, oldUnowned].sort())
    expect(result.inUse.sort()).toEqual([live, freshUnowned].sort())
    for (const kept of [live, freshUnowned, notOurs, outside]) expect(fs.existsSync(kept)).toBe(true)
  })

  it('a missing root is not an error', () => {
    expect(sweepLeftovers({ root: path.join(scratch, 'nope') })).toEqual({ removed: [], inUse: [], failed: [] })
  })
})

// Regression: every test process stored its files in <tmp>/rackium-test-files-<pid>
// and nothing removed them — 284 folders (143 MB) by M7a-2.
describe('test file stores are always removed', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rackium-files-test-'))
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }))
  const root = fileURLToPath(new URL('..', import.meta.url))
  const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')
  const run = (args, env) =>
    new Promise((resolve) => {
      execFile(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, timeout: 120000 }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout }))
    })

  it('this process stores its files inside the run’s folder, one folder per process', () => {
    const dir = testConfig().FILE_STORAGE_DIR
    expect(path.dirname(dir)).toBe(process.env.RACKIUM_TEST_DB_RUN)
    expect(path.basename(dir)).toBe(`files-${process.pid}`)
    expect(testConfig().FILE_STORAGE_DIR).toBe(dir)
  })

  it('a test file’s folder is removed when it ends, even after a failed and a timed-out test', async () => {
    const runDir = createRunDir(path.join(scratch, 'vitest'))
    const report = path.join(scratch, 'vitest-report.json')
    const { code } = await run([vitest, 'run', '--config', 'test/fixtures/files-cleanup/vitest.config.js', '--reporter=dot'], { RACKIUM_TEST_DB_RUN: runDir, RACKIUM_FILES_REPORT: report })
    expect(code).not.toBe(0) // the fixture fails on purpose
    const { dir } = JSON.parse(fs.readFileSync(report, 'utf8'))
    expect(path.dirname(dir)).toBe(runDir)
    expect(fs.existsSync(dir)).toBe(false)
    // Only its own folder: the run's folder stays for the run's teardown.
    expect(fs.existsSync(path.join(runDir, 'owner.json'))).toBe(true)
  }, 150000)

  it('a process removes its folder on exit — normal end, uncaught error or process.exit', async () => {
    const script = (ending) => `
      import fs from 'node:fs'
      import path from 'node:path'
      import { testConfig } from './test/helpers/config.js'
      const dir = testConfig().FILE_STORAGE_DIR
      fs.mkdirSync(path.join(dir, 'branding'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'branding', 'logo.png'), 'png')
      process.stdout.write(JSON.stringify({ dir }) + '\\n')
      ${ending}
    `
    const runDir = createRunDir(path.join(scratch, 'node'))
    for (const [ending, expectedCode] of [['', 0], ["throw new Error('boom')", 1], ['process.exit(3)', 3]]) {
      const { code, stdout } = await run(['--input-type=module', '-e', script(ending)], { RACKIUM_TEST_DB_RUN: runDir })
      expect(code).toBe(expectedCode)
      const { dir } = JSON.parse(stdout.trim().split('\n')[0])
      expect(path.dirname(dir)).toBe(runDir)
      expect(fs.existsSync(dir), ending).toBe(false)
    }
    // Outside a test run the process makes a run folder of its own and removes that too.
    const { stdout } = await run(['--input-type=module', '-e', script('')], { RACKIUM_TEST_DB_RUN: '' })
    const { dir } = JSON.parse(stdout.trim().split('\n')[0])
    expect(path.dirname(path.dirname(dir))).toBe(TEST_DB_ROOT)
    expect(fs.existsSync(path.dirname(dir))).toBe(false)
  }, 60000)

  it('the sweep removes old-layout rackium-test-files-<pid> folders, and nothing else', () => {
    const tmp = path.join(scratch, 'tmp')
    const make = (name, ageMs = 0) => {
      const dir = path.join(tmp, name)
      fs.mkdirSync(path.join(dir, 'documents'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'documents', 'a.pdf'), 'x'.repeat(1000))
      if (ageMs) {
        const t = new Date(Date.now() - ageMs)
        fs.utimesSync(dir, t, t)
      }
      return dir
    }
    const dead = make('rackium-test-files-111')
    const running = make('rackium-test-files-222')
    const reusedPid = make('rackium-test-files-333', 2 * 24 * 60 * 60 * 1000)
    const others = [make('rackium-test-files-abc'), make('rackium-test-db'), make('other-project-files-444'), make('rackium-test-files-555-x')]

    const result = sweepLegacyFileDirs({ root: tmp, isAlive: (pid) => pid === 222 || pid === 333 })

    expect(result.removed.sort()).toEqual([dead, reusedPid].sort())
    expect(result.inUse).toEqual([running])
    expect(result.bytes).toBe(2000)
    for (const kept of [running, ...others]) expect(fs.existsSync(kept)).toBe(true)
    expect(sweepLegacyFileDirs({ root: path.join(scratch, 'nope') }).removed).toEqual([])
  })

  it('npm run clean:test-db also sweeps the old-layout folders', () => {
    const script = fs.readFileSync(path.join(root, 'scripts', 'clean-test-db.mjs'), 'utf8')
    expect(script).toMatch(/sweepLegacyFileDirs\(\)/)
    expect(JSON.parse(fs.readFileSync(path.join(root, '..', 'package.json'), 'utf8')).scripts['clean:test-db']).toMatch(/clean:test-db/)
  })
})
