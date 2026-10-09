import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'

// M3a, real mode: the equipment catalogue (browse, filter, detail with exact
// port numbering, Org Admin add and CSV import) and the CMO import on the
// backend (preview, commit, Unassigned device as a blocker, PM assigns it,
// CMO phase Completed). One serial sequence on a shared page, like
// journey.spec.js. The signed-up owner is Org Admin and, as the project's
// creator, its PM.

test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const RUN_ID = Date.now()
let page
let orgId
let projectId
let b001Id

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
})
test.afterAll(async () => {
  await page.close()
})

test('set up: a new organisation with a project of two buildings in one SAL', async () => {
  orgId = await signUpAndSignIn(page, { email: `catalogue-${RUN_ID}@example.com`, organisationName: 'Catalogue Org' })
  projectId = await createProjectWithHierarchy(page, orgId, { name: 'Catalogue Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  await page.getByText('Building B001').click()
  await expect(page).toHaveURL(/\/buildings\/[a-f0-9]+$/)
  b001Id = new URL(page.url()).pathname.match(/\/buildings\/([a-f0-9]+)$/)[1]
})

test('catalogue: the seeded placeholder catalogue can be searched and filtered', async () => {
  await page.getByRole('link', { name: 'Equipment catalogue' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/orgs/${orgId}/catalogue\\?projectId=${projectId}$`))
  await expect(page.getByRole('heading', { name: 'Equipment catalogue' })).toBeVisible()
  await expect(page.getByText(/Seeded items marked Placeholder/)).toBeVisible()
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()

  await page.getByLabel('Search the catalogue').fill('9300')
  await expect(rows).toHaveCount(2)
  await expect(page.getByRole('link', { name: 'Cisco C9300-48UX' })).toBeVisible()
  await page.getByLabel('Search the catalogue').fill('')

  await page.getByLabel('Category group').selectOption('infrastructure')
  await expect(rows).toHaveCount(3) // PDU, UPS and (M4a) the environment sensor
  await expect(page.getByRole('link', { name: 'Generic UPS 3U' })).toBeVisible()
  await page.getByLabel('Category group').selectOption('')

  await page.getByLabel('PoE').check()
  await expect(rows).toHaveCount(1)
  await page.getByLabel('PoE').uncheck()

  await page.getByLabel('Minimum ports').fill('48')
  await expect(rows).toHaveCount(2)
  await page.getByLabel('Minimum ports').fill('')
})

test('catalogue: an item shows its exact port list and, for the Org Admin, its price', async () => {
  await page.getByRole('link', { name: 'Cisco C9300-48UX' }).click()
  await expect(page.getByRole('heading', { name: 'Cisco C9300-48UX' })).toBeVisible()
  await expect(page.getByText('Ports (56)')).toBeVisible()
  const ports = page.getByRole('list', { name: 'Port list' }).locator('li')
  await expect(ports).toHaveCount(56)
  await expect(ports.first()).toHaveText('Gi1/0/1')
  await expect(ports.nth(47)).toHaveText('Gi1/0/48')
  await expect(ports.last()).toHaveText('Te1/1/8')
  await expect(page.getByText('€4,200.00')).toBeVisible()
  // Seeded items are read-only: the Org Admin gets "Override", not "Edit".
  await expect(page.getByRole('link', { name: 'Override in organisation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0)
})

test('catalogue: the Org Admin adds an organisation item with a validated port map', async () => {
  await page.goto(`/orgs/${orgId}/catalogue/new`)
  await page.getByLabel('Category').selectOption('firewall')
  await page.getByLabel('Vendor').fill('Fortinet')
  await page.getByLabel('Model', { exact: true }).fill('FG-60F')
  await page.getByRole('button', { name: 'Add port group' }).click()
  await page.getByLabel('Port count').fill('10')
  await page.getByLabel('Port pattern').fill('port{n}')
  await expect(page.getByTestId('port-preview')).toHaveText('10 ports: port1 … port10')

  // A pattern without {n} is refused before it reaches the server.
  await page.getByLabel('Port pattern').fill('port1')
  await page.getByRole('button', { name: 'Add item' }).click()
  await expect(page.getByText(/must contain \{n\}/)).toBeVisible()
  await page.getByLabel('Port pattern').fill('port{n}')

  await page.getByLabel('Unit price').fill('540')
  await page.getByRole('button', { name: 'Add item' }).click()
  await expect(page.getByRole('heading', { name: 'Fortinet FG-60F' })).toBeVisible()
  await expect(page.getByText('Organisation', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('€540.00')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible()
})

test('catalogue: CSV import previews row errors, imports nothing until all rows pass, then imports', async () => {
  await page.goto(`/orgs/${orgId}/catalogue`)
  await page.getByRole('button', { name: 'Import CSV' }).click()
  await page.getByLabel('Catalogue file').setInputFiles(fixture('catalogue-bad.csv'))
  await expect(page.getByText(/1 row\(s\) with errors/)).toBeVisible()
  await expect(page.getByText('heightU: Use a whole number')).toBeVisible()
  await expect(page.getByRole('button', { name: /Import 2 item/ })).toBeDisabled()

  await page.getByLabel('Catalogue file').setInputFiles(fixture('catalogue-good.csv'))
  await expect(page.getByText('All rows valid')).toBeVisible()
  await page.getByRole('button', { name: /Import 2 item/ }).click()
  await expect(page.getByRole('link', { name: 'Juniper MX204' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'APC SMT3000RMI2U' })).toBeVisible()
})

test('CMO: import with column mapping and server-side validation', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001Id}`)
  await page.getByRole('link', { name: /CMO Inventory Validation/ }).click()
  await expect(page).toHaveURL(new RegExp(`/buildings/${b001Id}/cmo$`))
  await expect(page.getByRole('heading', { name: 'CMO Inventory Validation' })).toBeVisible()
  await expect(page.getByText('No CMO devices imported for this building yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Import CMO Inventory' }).click()
  await page.locator('input[type="file"]').setInputFiles(fixture('cmo.csv'))
  await expect(page.getByText(/row\(s\)\. Map each/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview import' }).click()

  await expect(page.getByText('3 valid')).toBeVisible()
  await expect(page.getByText("2 blocked (won't be imported)")).toBeVisible()
  await expect(page.getByText('1 going to Unassigned')).toBeVisible()
  await expect(page.locator('tr', { hasText: 'SW-BAD-MAC' })).toContainText('Invalid MAC format')
  await expect(page.locator('tr', { hasText: 'SW-NO-SERIAL' })).toContainText('Missing serial')

  await page.getByRole('button', { name: 'Commit import (3)' }).click()
  await expect(page.getByRole('status')).toContainText('Imported 3 device(s): 2 assigned, 1 Unassigned')
  await expect(page.locator('tr', { hasText: 'SW-EG-01' })).toContainText('00:1a:2b:3c:4d:01')
  await expect(page.getByText('Unassigned at SAL ERL (1)')).toBeVisible()
  await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible()
})

test('CMO: the Unassigned device is an open blocker on the dashboard, and the phase is Blocked', async () => {
  await page.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001Id}`)
  const cmoCard = page.getByRole('link', { name: /CMO Inventory Validation/ })
  await expect(cmoCard).toContainText('Blocked')
  const blocker = page.locator('li', { hasText: 'Unassigned CMO device SW-UNK-01' })
  await expect(blocker).toBeVisible()
  await expect(blocker.getByText('SAL', { exact: true })).toBeVisible()
  await expect(blocker.getByRole('button', { name: 'Resolve' })).toHaveCount(0)
  await expect(blocker.getByRole('link', { name: 'Assign in CMO' })).toBeVisible()
})

test('CMO: the PM assigns it to a building; the blocker clears and CMO is Completed', async () => {
  await page.locator('li', { hasText: 'Unassigned CMO device SW-UNK-01' }).getByRole('link', { name: 'Assign in CMO' }).click()
  await page.getByLabel('Assign SW-UNK-01 to a building').selectOption({ label: 'B002' })
  await expect(page.getByText('No unassigned devices — every imported device has a building.')).toBeVisible()
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible()

  await page.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001Id}`)
  await expect(page.getByRole('link', { name: /CMO Inventory Validation/ })).toContainText('Completed')
  await expect(page.locator('li', { hasText: 'Unassigned CMO device SW-UNK-01' })).toContainText('Resolved')
  await expect(page.getByText(/cmo\.import\.committed/)).toBeVisible()
})
