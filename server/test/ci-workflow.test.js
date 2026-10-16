import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// The server API tests render PDFs in headless Chromium (documents, M6b), so
// CI must install the browser before they run — not only before Playwright.
const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
const stepAt = (name) => {
  const i = workflow.indexOf(`- name: ${name}`)
  expect(i, `CI step "${name}"`).toBeGreaterThan(-1)
  return i
}

describe('CI workflow', () => {
  it('installs Chromium before the server API tests, which render PDFs with it', () => {
    const apiTests = stepAt('API tests (server, in-memory replica set)')
    expect(stepAt('Cache Playwright browser')).toBeLessThan(apiTests)
    expect(stepAt('Install Playwright Chromium + OS dependencies')).toBeLessThan(apiTests)
    expect(stepAt('Install Playwright OS dependencies (browser cache hit)')).toBeLessThan(apiTests)
    expect(workflow.slice(apiTests)).toMatch(/run: npm run test:server/)
  })
})
