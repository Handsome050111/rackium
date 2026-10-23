import fs from 'node:fs'
import path from 'node:path'
import { it, expect } from 'vitest'
import { testConfig } from '../../helpers/config.js'

// Run by test/testDbCleanup.test.js in its own Vitest process: stores a file
// the way the test apps do, then one test fails and one times out. The
// parent checks the folder is gone afterwards.
it('stores a file', () => {
  const dir = testConfig().FILE_STORAGE_DIR
  fs.mkdirSync(path.join(dir, 'documents'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'documents', 'report.pdf'), 'x'.repeat(4096))
  fs.writeFileSync(process.env.RACKIUM_FILES_REPORT, JSON.stringify({ dir, pid: process.pid }))
})

it('fails', () => {
  expect(1).toBe(2)
})

it('times out', async () => {
  await new Promise(() => {})
})
