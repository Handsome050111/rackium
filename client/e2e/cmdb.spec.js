import { test, expect } from '@playwright/test'

function setRole(page, label) {
  return page.click('[aria-label="User menu"]').then(() => page.getByText(label, { exact: true }).click())
}

function clientSideNavigate(page, path) {
  return page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

async function approveAndDeliverAll(page) {
  await page.goto('/b/b001/solution-package')
  await page.waitForSelector('text=Solution Package — Building B001')
  const token = await page.evaluate(async () => {
    const mod = await import('/src/api/shareLink.js')
    const link = await mod.generateShareLink('b001', { password: 'client123', expiryDays: 14 })
    return link.token
  })
  await clientSideNavigate(page, `/approve/${token}`)
  await page.waitForSelector('text=password required')
  await page.fill('input[type="password"]', 'client123')
  await page.click('button:has-text("View Package")')
  await expect(page.getByText('Solution Package — Building B001')).toBeVisible()
  await page.fill('input[placeholder="Your full name"]', 'Jane Client')
  await page.check('input[type="checkbox"]')
  await page.click('button:has-text("Approve")')
  await expect(page.getByText('Thank you — your decision has been recorded.')).toBeVisible()

  await clientSideNavigate(page, '/b/b001/bom')
  await page.waitForSelector('text=Suggested BOM')
  await setRole(page, 'PM')
  const selects = page.locator('select')
  const count = await selects.count()
  for (let i = 0; i < count; i++) await selects.nth(i).selectOption('Delivered')
}

// Installs and accepts one device (dev-edge-1 / E-DE-ERL-C01-B001-EG-001) so
// CMDB tests have an as-built record to work with — CMDB is built from
// deployment state, never from design intent (brief §5.8), so an empty
// deployment means an empty CMDB regardless of how many devices HLD/LLD
// designed.
async function deployAndAcceptOneDevice(page) {
  await approveAndDeliverAll(page)
  await clientSideNavigate(page, '/b/b001/deployment')
  await page.waitForSelector('h1:has-text("Deployment & Installation")')
  await setRole(page, 'Field Engineer')

  await page.click('text=E-DE-ERL-C01-B001-EG-001')
  await expect(page.getByText('Awaiting delivery')).toHaveCount(0)
  await page.fill('input[placeholder="e.g. FCW2637A1B2"]', 'FCW2637A1B2')
  await page.fill('input[placeholder="00:1A:2B:3C:4D:5E"]', '00:1A:2B:3C:4D:5E')
  await page.click('button:has-text("Save serial & MAC")')
  await page.click('button:has-text("Confirm Installation")')
  await page.locator('button:has-text("Confirm Uplinking")').first().click()

  await setRole(page, 'PM')
  await expect(page.getByText('Accept device')).toBeVisible()
  await page.click('button:has-text("Accept device")')
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible()
}

test.describe('CMDB', () => {
  test('loads with no console errors and starts empty — nothing deployed yet', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/cmdb')
    await expect(page.getByRole('heading', { name: /CMDB/ })).toBeVisible()
    await expect(page.getByText('Configuration items')).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(0)

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('an accepted device appears with calculated KPIs, reconciliation, and a port-count-correct connectivity view', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Canvas device selection at phone zoom needs mouse-precision pointer interaction')
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await deployAndAcceptOneDevice(page)

    await clientSideNavigate(page, '/b/b001/cmdb')
    await page.waitForSelector('h1:has-text("CMDB")')
    await expect(page.getByText('E-DE-ERL-C01-B001-EG-001').first()).toBeVisible()
    await expect(page.locator('td', { hasText: 'Accepted' }).first()).toBeVisible()
    await expect(page.getByText('NexAI CMDB reconciliation')).toBeVisible()

    await page.getByRole('cell', { name: 'E-DE-ERL-C01-B001-EG-001' }).click()
    await page.getByRole('button', { name: 'Ports & Connections' }).click()
    await page.click('text=Open Port Connectivity')

    // Brief Step 8: the render's "All (48) = 40 patched + 2 uplinks + 6
    // free" wrongly folds uplink-module ports into the access total —
    // access and uplink pools must stay separately counted.
    await expect(page.getByText('Access ports:')).toContainText('48')
    await expect(page.getByText('Uplink module ports:')).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('operational edits are gated to Architect/PM and logged as an "operational change"', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Canvas device selection at phone zoom needs mouse-precision pointer interaction')
    await deployAndAcceptOneDevice(page)
    await clientSideNavigate(page, '/b/b001/cmdb')
    await page.waitForSelector('h1:has-text("CMDB")')

    await setRole(page, 'Field Engineer')
    await page.getByRole('cell', { name: 'E-DE-ERL-C01-B001-EG-001' }).click()
    await page.getByRole('button', { name: 'Lifecycle', exact: true }).click()
    await expect(page.locator('label:has-text("Asset ID")')).toHaveCount(0)

    await setRole(page, 'PM')
    await page.getByRole('button', { name: 'Lifecycle', exact: true }).click()
    await page.fill('label:has-text("Asset ID") input', 'AST-0001')
    await page.click('button:has-text("Save")')
    await page.getByRole('button', { name: 'Evidence & History' }).click()
    await expect(page.getByText('operational change')).toBeVisible()
  })
})
