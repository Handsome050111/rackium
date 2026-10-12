import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { createDbDir, createRunDir, sweepLeftovers, TEST_DB_ROOT } from './helpers/testDbDirs.js'
import { startReplSet, stopReplSet } from './helpers/memoryDb.js'
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
