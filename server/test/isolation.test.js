import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Proves a timed-out test cannot write into the next test's data: runs
// fixtures/isolation/stale.fixture.js in its own Vitest process, with the
// isolation (helpers/isolation.js) and — as the control — without it.
const root = fileURLToPath(new URL('..', import.meta.url))
const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs')

function runFixture(isolation) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rackium-isolation-')), 'result.json')
  return new Promise((resolve) => {
    execFile(process.execPath, [vitest, 'run', '--config', 'test/fixtures/isolation/vitest.config.js', '--reporter=json', `--outputFile=${out}`], { cwd: root, env: { ...process.env, RACKIUM_TEST_ISOLATION: isolation, TEST_LOG_LEVEL: 'silent' }, timeout: 200000 }, (error) => {
      const report = JSON.parse(fs.readFileSync(out, 'utf8'))
      fs.rmSync(path.dirname(out), { recursive: true, force: true })
      const results = Object.fromEntries(report.testResults.flatMap((f) => f.assertionResults).map((a) => [a.title, { status: a.status, message: a.failureMessages.join('\n') }]))
      resolve({ exitCode: error?.code ?? 0, results })
    })
  })
}

describe('Test isolation', () => {
  it('a test that times out is stopped: its later requests and in-flight writes never reach the next test', async () => {
    const [on, off] = await Promise.all([runFixture('on'), runFixture('off')])
    const slow = 'slow test: times out while calling the API, with a request in flight'
    const next = "next test: none of the timed-out test's writes arrive"
    const stopped = 'the timed-out test was stopped: its next request refused, its in-flight write rejected'
    // With isolation: only the deliberately slow test fails (timed out).
    expect(on.results[slow].status).toBe('failed')
    expect(on.results[slow].message).toMatch(/timed out/i)
    expect(on.results[next], on.results[next]?.message).toEqual({ status: 'passed', message: '' })
    expect(on.results[stopped], on.results[stopped]?.message).toEqual({ status: 'passed', message: '' })
    // Without it the same timed-out test leaks into the next one — so the
    // fixture really detects the problem.
    expect(off.results[slow].status).toBe('failed')
    expect(off.results[next].status).toBe('failed')
    expect(off.results[stopped].status).toBe('failed')
  }, 300000)

  it('the guard exists only in the test setup: the production app and the e2e server modules never load it', async () => {
    // A clean Node process (no Vitest setup files) loads what the production
    // server and the Playwright backend load, then checks the driver is untouched.
    const script = `
      import { createRequire } from 'node:module'
      await import('./src/app.js')
      await import('./test/helpers/memoryDb.js')
      const fromMongoose = createRequire(createRequire(import.meta.url + '/').resolve('mongoose'))
      const { Collection } = fromMongoose('mongodb')
      process.stdout.write(JSON.stringify({ patched: Boolean(Collection.prototype.__rackiumGuarded) }))
    `
    const stdout = await new Promise((resolve, reject) =>
      execFile(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env: { ...process.env, RACKIUM_TEST_ISOLATION: undefined } }, (error, out) => (error ? reject(error) : resolve(out))),
    )
    expect(JSON.parse(stdout.trim().split('\n').pop())).toEqual({ patched: false })
    // And nothing outside server/test imports it.
    const offenders = []
    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(c|m)?js$/.test(e.name) && /isolation\.js/.test(fs.readFileSync(p, 'utf8'))) offenders.push(p)
      })
    for (const dir of ['src', 'e2e', 'scripts']) walk(path.join(root, dir))
    expect(offenders).toEqual([])
  })
})
