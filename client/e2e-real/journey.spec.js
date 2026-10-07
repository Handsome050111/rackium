import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// Real-mode end-to-end journey, against server/e2e/testServer.mjs (an actual
// Express app + in-memory Mongo replica set). One serial sequence, sharing a
// single page across its steps (Playwright's documented pattern for
// dependent tests — a fresh per-test page would lose the session cookie
// between steps): sign-up, email verification, the project wizard (with CSV
// import), the project list and home, the real building dashboard
// (raise/assign/resolve a blocker, recent activity), Settings tabs
// (hierarchy add/delete-refused, phase gating, members), View As (banner,
// writes blocked, exit), and cross-project access denied. Mock-mode specs
// (client/e2e/) are untouched.

const here = path.dirname(fileURLToPath(import.meta.url))
const EMAILS_FILE = path.join(here, '../../server/e2e/.runtime-emails.json')
const CSV_FIXTURE = path.join(here, 'fixtures/hierarchy.csv')
const PASSWORD = 'correct horse battery staple'
const RUN_ID = Date.now()

function readEmails() {
  return JSON.parse(fs.readFileSync(EMAILS_FILE, 'utf8'))
}

// The route awaits mailer.send() before responding, so the file is already
// written by the time the HTTP call returns — this just adds a short,
// cheap retry in case of filesystem write-visibility lag.
async function lastEmailTo(to, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const match = [...readEmails()].reverse().find((m) => m.to === to)
    if (match) return match
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`No email arrived for ${to}`)
}

function tokenFrom(message) {
  const link = message.text.match(/https?:\/\/\S+/)[0]
  return new URL(link).searchParams.get('token')
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

let page
let orgId
let projectId
let buildingId

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})
test.afterAll(async () => {
  await page.close()
})

test('sign up, verify the email, and sign in', async () => {
  const email = `owner-${RUN_ID}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Organisation name').fill('Acme Networks')
  await page.getByLabel('Your name').fill('Owner')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password (12 characters or more)').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create organisation' }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

  const message = await lastEmailTo(email)
  const token = tokenFrom(message)
  await page.goto(`/verify-email?token=${token}`)
  await expect(page.getByText('Your email is confirmed.')).toBeVisible()

  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/orgs\/[a-f0-9]+\/projects$/)
  orgId = new URL(page.url()).pathname.match(/\/orgs\/([a-f0-9]+)/)[1]
})

test('the wizard creates a project, with its hierarchy imported from CSV', async () => {
  await page.goto(`/orgs/${orgId}/projects`)
  await page.getByRole('link', { name: 'New project' }).click()

  await page.getByLabel('Project name').fill('LANspire')
  await page.getByLabel('Client name').fill('Acme Retail')
  await page.getByLabel('Wired Network Site Survey', { exact: false }).check()
  await page.getByRole('button', { name: 'Full Network Deployment' }).click()
  await page.getByRole('button', { name: 'Next' }).click()

  await page.locator('input[type="file"]').setInputFiles(CSV_FIXTURE)
  await expect(page.getByText(/ready to create/)).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()

  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/projects/[a-f0-9]+$`))
  projectId = new URL(page.url()).pathname.match(/\/projects\/([a-f0-9]+)$/)[1]

  await expect(page.getByRole('heading', { name: 'LANspire' })).toBeVisible()
  await expect(page.getByText('B001', { exact: true }).first()).toBeVisible()
})

test('the project appears in the list, and its building opens the real dashboard', async () => {
  await page.goto(`/orgs/${orgId}/projects`)
  await expect(page.getByText('LANspire')).toBeVisible()
  await expect(page.getByText('1 building')).toBeVisible()

  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  await page.getByText('Building B001').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/buildings/[a-f0-9]+$`))
  buildingId = new URL(page.url()).pathname.match(/\/buildings\/([a-f0-9]+)$/)[1]

  await expect(page.getByText('Completion')).toBeVisible()
  await expect(page.getByText('CMO Inventory Validation')).toBeVisible()
})

test('raising, assigning and resolving a blocker shows up in recent activity', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`)
  await page.getByPlaceholder('Describe the blocker').fill('Site access pending')
  await page.getByRole('button', { name: 'Raise' }).click()
  await expect(page.getByText('Site access pending')).toBeVisible()

  await page.getByRole('button', { name: 'Assign to me' }).click()
  await expect(page.getByRole('button', { name: 'Assign to me' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByText('Resolved')).toBeVisible()
  await expect(page.getByText(/blocker\.raised/)).toBeVisible()
})

test('Settings: hierarchy delete is refused while it has children; phase gating follows the rules', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}/settings?tab=hierarchy`)
  await expect(page.getByText('Countries (1)')).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).first().click()
  await expect(page.getByText(/still has/)).toBeVisible()

  await page.goto(`/orgs/${orgId}/projects/${projectId}/settings?tab=phases`)
  // cmo already has a blocker (it was the first active phase when the
  // dashboard's blocker form raised one) — removing it must be refused.
  await page.getByLabel('CMO', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/Cannot remove cmo/)).toBeVisible()

  // A phase with no data can be removed.
  await page.getByLabel('CMO', { exact: true }).check()
  await page.getByLabel('CMDB', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()

  await page.goto(`/orgs/${orgId}/projects/${projectId}/settings?tab=members`)
  await expect(page.getByRole('link', { name: 'Team page' })).toBeVisible()
})

test('View As: the banner shows, writes are blocked, and Exit restores normal access', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  await page.getByRole('button', { name: 'View as' }).click()
  await expect(page.getByText(/Viewing as/)).toBeVisible()

  // The dashboard's write form disappears entirely while viewing as.
  await page.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`)
  await expect(page.getByPlaceholder('Describe the blocker')).toHaveCount(0)

  // Settings' Save button is disabled, and the server would 403 it regardless.
  await page.goto(`/orgs/${orgId}/projects/${projectId}/settings?tab=general`)
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

  await page.getByRole('button', { name: 'Exit' }).click()
  await expect(page.getByText(/Viewing as/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled()
})

test('a user with no role on another organisation\'s project is denied, not shown its data', async ({ browser }) => {
  const otherEmail = `other-${RUN_ID}@example.com`
  const otherContext = await browser.newContext()
  const otherPage = await otherContext.newPage()

  await otherPage.goto('/signup')
  await otherPage.getByLabel('Organisation name').fill('Other Org')
  await otherPage.getByLabel('Your name').fill('Other Owner')
  await otherPage.getByLabel('Work email').fill(otherEmail)
  await otherPage.getByLabel('Password (12 characters or more)').fill(PASSWORD)
  await otherPage.getByRole('button', { name: 'Create organisation' }).click()
  const message = await lastEmailTo(otherEmail)
  await otherPage.goto(`/verify-email?token=${tokenFrom(message)}`)
  await expect(otherPage.getByText('Your email is confirmed.')).toBeVisible()
  await otherPage.goto('/login')
  await otherPage.getByLabel('Email').fill(otherEmail)
  await otherPage.getByLabel('Password').fill(PASSWORD)
  await otherPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(otherPage).toHaveURL(/\/orgs\/[a-f0-9]+\/projects$/)
  const otherOrgId = new URL(otherPage.url()).pathname.match(/\/orgs\/([a-f0-9]+)/)[1]
  await otherContext.close()

  // Back as the original user: org1's own project works...
  await page.goto(`/orgs/${orgId}/projects/${projectId}`)
  await expect(page.getByRole('heading', { name: 'LANspire' })).toBeVisible()

  // ...but org1's user has no role in org2 at all, so even the org-level
  // project list is refused (not just the project itself). page.request
  // shares this browsing context's cookies, so it is the same session the
  // UI would use — and it gives one unambiguous response, unlike racing
  // waitForResponse against a goto() whose own response is just the SPA shell.
  const apiResponse = await page.request.get(`/api/v1/orgs/${otherOrgId}/projects`)
  expect(apiResponse.status()).toBe(404)

  await page.goto(`/orgs/${otherOrgId}/projects`)
  await expect(page.getByText('LANspire')).toHaveCount(0)
})
