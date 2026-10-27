import { test, expect } from '@playwright/test'
import { deployedProject } from './handoverSetup.js'
import { inviteAndAccept } from './surveyHelpers.js'

// M7b-1, real mode (addendum v2.3): the External Reviewer's BOM (quantities and
// specifications only), DGUV exemption from the deployment panel and on the
// DGUV dashboard, the two BOM metrics, the SLA escalation contact, the
// catalogue's DGUV default — at every width, no overflow, no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
const SUPPLIER = 'Acme Distribution GmbH'
let owner
let s
let er
const errors = []
const home = () => `/orgs/${s.orgId}/projects/${s.projectId}`

async function fitsEveryWidth(page, label, check = async () => {}) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    await check(width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M7B_SHOTS) await page.screenshot({ path: `${process.env.M7B_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, er, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed and accepted; an External Reviewer; a supplier and PO on a BOM line', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm7b1' })
  er = await inviteAndAccept(owner, browser, { orgId: s.orgId, projectId: s.projectId, email: `m7b1-er-${RUN_ID}@example.com`, role: 'external_reviewer', name: 'Clara Client' })
  for (const [who, page] of [['owner', owner], ['er', er]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  const bom = await s.send(owner, 'get', `/bom/buildings/${s.b001}`, undefined, 200)
  const line = bom.lines.find((l) => l.lineType === 'serialised')
  await s.send(owner, 'patch', '/bom/lines', { buildingId: s.b001, lineKey: line.key, vendor: SUPPLIER, notes: 'Agreed 12% below list', version: line.procurement.version }, 200)
})

test('External Reviewer: the BOM as quantities and specifications — no prices, supplier or notes — at every width', async () => {
  await er.goto(`${home()}/buildings/${s.b001}/bom`)
  await expect(er.locator('body')).toContainText('Qty')
  await fitsEveryWidth(er, 'bom-external-reviewer', async () => {
    await expect(er.locator('body')).not.toContainText(SUPPLIER)
    await expect(er.locator('body')).not.toContainText('Agreed 12% below list')
    await expect(er.locator('body')).not.toContainText('Unit price')
    await expect(er.locator('body')).not.toContainText('EUR')
    await expect(er.locator('body')).not.toContainText(/not priced/i)
  })
  // The PM sees the supplier.
  await owner.goto(`${home()}/buildings/${s.b001}/bom`)
  await expect(owner.locator('body')).toContainText(SUPPLIER)
})

test('DGUV: the PM exempts a device with a reason from the deployment panel; the dashboard lists it as Exempt — every width', async () => {
  const device = s.deployment.devices.find((d) => d.mainsPowered)
  await owner.goto(`${home()}/buildings/${s.b001}/deployment`)
  await owner.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${device.hostname}`) }).click()
  const panel = owner.getByTestId('installation-panel')
  const form = panel.getByTestId('dguv-override')
  await expect(form.getByRole('button', { name: 'Exempt from inspection' })).toBeDisabled()
  await form.getByLabel('Reason for exemption').fill('Fed by the building UPS, inspected by the landlord')
  await form.getByRole('button', { name: 'Exempt from inspection' }).click()
  await expect(owner.getByRole('status').filter({ hasText: 'Device exempt from DGUV inspection' })).toBeVisible()
  await expect(panel.getByTestId('dguv-status')).toContainText('Exempt — Fed by the building UPS, inspected by the landlord')
  await owner.goto(`${home()}/dguv?status=exempt`)
  await expect(owner.getByTestId('dguv-devices')).toContainText(device.hostname)
  await expect(owner.getByTestId('dguv-devices')).toContainText('inspected by the landlord')
  await expect(owner.getByTestId('dguv-node')).toContainText('1 exempt')
  await fitsEveryWidth(owner, 'dguv-exempt')
  // Back to the default, from the panel.
  await owner.goto(`${home()}/buildings/${s.b001}/deployment`)
  await owner.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${device.hostname}`) }).click()
  await owner.getByTestId('installation-panel').getByRole('button', { name: /Clear the exemption/ }).click()
  await expect(owner.getByRole('status').filter({ hasText: "DGUV back to the model's default" })).toBeVisible()
})

test('analytics: BOM accuracy against the as-installed and the BOM revision count — every width', async () => {
  await owner.goto(`${home()}/analytics`)
  const accuracy = owner.getByTestId('metric-bomAccuracy')
  await expect(accuracy).toContainText('100%')
  await expect(accuracy.getByTestId('bom-accuracy')).toContainText('B001')
  await expect(owner.getByTestId('metric-bomRevisions')).toContainText('0 of 1 building(s) revised')
  await fitsEveryWidth(owner, 'analytics-bom')
})

test('schedule settings: the SLA escalation contact is chosen from the members and kept', async () => {
  await owner.goto(`${home()}/schedule`)
  const settings = owner.getByTestId('schedule-settings')
  await settings.getByLabel('Escalation contact').selectOption({ label: 'Ada Architect (Architect)' })
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(owner.getByRole('status').filter({ hasText: 'Schedule settings saved' })).toBeVisible()
  await owner.reload()
  await expect(owner.getByTestId('schedule-settings').getByLabel('Escalation contact').locator('option:checked')).toHaveText('Ada Architect (Architect)')
  await fitsEveryWidth(owner, 'schedule-settings')
})

test('catalogue: a model’s DGUV default is chosen in the item form; no console errors anywhere', async () => {
  await owner.goto(`/orgs/${s.orgId}/catalogue/new`)
  await expect(owner.getByLabel('DGUV V3 inspection')).toHaveValue('')
  await owner.getByLabel('DGUV V3 inspection').selectOption('false')
  await fitsEveryWidth(owner, 'catalogue-form')
  expect(errors).toEqual([])
})
