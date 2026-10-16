import { test, expect } from '@playwright/test'
import { PASSWORD, fixture, lastEmailTo, tokenFrom, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'

// M3a review fixes, real mode: the organisation-level project-creation
// permission (Org Admin grants it in Organisation settings) and the
// "Architects can see prices" setting. An Org Admin and an Architect, each
// in their own browser context.

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const RUN_ID = Date.now()
const ARCHITECT = `architect-${RUN_ID}@example.com`
let admin
let architect
let orgId
let projectId

// The settings toggles update the screen at once and save in the background,
// so the label alone does not mean the server has the change: act on it only
// after the save has answered (found flaky in CI: a revoke not yet saved let
// the Architect create a project).
const saveOf = (page, path) => page.waitForResponse((r) => r.url().includes(path) && r.request().method() === 'PATCH' && r.ok())

test.beforeAll(async ({ browser }) => {
  admin = await (await browser.newContext()).newPage()
  architect = await (await browser.newContext()).newPage()
})
test.afterAll(async () => {
  await admin.context().close()
  await architect.context().close()
})

test('set up: an Org Admin with a project, and an Architect invited to it', async () => {
  orgId = await signUpAndSignIn(admin, { email: `settings-${RUN_ID}@example.com`, organisationName: 'Settings Org' })
  projectId = await createProjectWithHierarchy(admin, orgId, { name: 'Settings Project', hierarchyCsv: fixture('hierarchy.csv') })
  const invite = await admin.request.post(`/api/v1/orgs/${orgId}/invitations`, { data: { email: ARCHITECT, role: 'architect', projectId } })
  expect(invite.status()).toBe(201)

  const token = tokenFrom(await lastEmailTo(ARCHITECT))
  const accepted = await architect.request.post('/api/v1/auth/invitations/accept', { data: { organisationId: orgId, token, name: 'Arch', password: PASSWORD } })
  expect(accepted.status()).toBe(201)
  await architect.goto('/login')
  await architect.getByLabel('Email').fill(ARCHITECT)
  await architect.getByLabel('Password').fill(PASSWORD)
  await architect.getByRole('button', { name: 'Sign in' }).click()
  await expect(architect).toHaveURL(/\/orgs\/[a-f0-9]+\/projects$/)
})

test('an Architect has no project creation and sees no prices by default', async () => {
  await expect(architect.getByRole('main').getByText('Settings Project')).toBeVisible()
  await expect(architect.getByRole('link', { name: 'New project' })).toHaveCount(0)
  await expect(architect.getByRole('link', { name: 'Organisation settings' })).toHaveCount(0)
  await expect(architect.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)

  await architect.goto(`/orgs/${orgId}/catalogue?projectId=${projectId}`)
  await expect(architect.locator('tbody tr').first()).toBeVisible()
  await expect(architect.getByRole('columnheader', { name: 'Unit price' })).toHaveCount(0)
})

test('the Org Admin grants project creation in Organisation settings', async () => {
  await admin.goto(`/orgs/${orgId}/projects`)
  await admin.getByRole('link', { name: 'Organisation settings' }).first().click()
  await expect(admin.getByRole('heading', { name: 'Organisation settings' })).toBeVisible()
  const toggle = admin.getByLabel(`${ARCHITECT} can create projects`)
  await expect(toggle).not.toBeChecked()
  const granted = saveOf(admin, '/project-creation')
  await toggle.check()
  await granted
  await expect(admin.locator('tr', { hasText: ARCHITECT })).toContainText('Allowed')
})

test('the Architect can now create a project, and becomes its PM', async () => {
  await architect.goto(`/orgs/${orgId}/projects`)
  await expect(architect.getByRole('main').getByRole('link', { name: 'New project' })).toBeVisible()
  const created = await architect.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { name: 'Architect Project', code: `A${String(RUN_ID).slice(-5)}` } })
  expect(created.status()).toBe(201)
  const me = await (await architect.request.get('/api/v1/me')).json()
  const newId = (await created.json()).project.id
  expect(me.memberships.find((m) => m.projectId === newId)?.role).toBe('pm')
})

test('the Org Admin revokes it again; creation is refused', async () => {
  // A slow save (here 1 s) must not let the Architect through.
  await admin.route('**/project-creation', async (route) => {
    await new Promise((r) => setTimeout(r, 1000))
    await route.continue()
  })
  const revoked = saveOf(admin, '/project-creation')
  await admin.getByLabel(`${ARCHITECT} can create projects`).uncheck()
  await revoked
  await admin.unroute('**/project-creation')
  await expect(admin.locator('tr', { hasText: ARCHITECT })).toContainText('Not allowed')
  const refused = await architect.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { name: 'Refused', code: 'REFUSED' } })
  expect(refused.status()).toBe(403)
})

test('"Architects can see prices" turns catalogue prices on for the Architect', async () => {
  const shown = saveOf(admin, '/settings')
  await admin.getByLabel('Architects can see prices').check()
  await shown
  await expect(admin.getByLabel('Architects can see prices')).toBeChecked()

  await architect.goto(`/orgs/${orgId}/catalogue?projectId=${projectId}`)
  await expect(architect.getByRole('columnheader', { name: 'Unit price' })).toBeVisible()
  await expect(architect.locator('tr', { hasText: 'Cisco C9500' })).toContainText('€8,500.00')

  const hidden = saveOf(admin, '/settings')
  await admin.getByLabel('Architects can see prices').uncheck()
  await hidden
  await expect(admin.getByLabel('Architects can see prices')).not.toBeChecked()
  await architect.reload()
  await expect(architect.locator('tbody tr').first()).toBeVisible()
  await expect(architect.getByRole('columnheader', { name: 'Unit price' })).toHaveCount(0)
})
