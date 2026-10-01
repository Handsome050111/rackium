import { test, expect } from '@playwright/test'

function setRole(page, label) {
  return page.click('[aria-label="User menu"]').then(() => page.getByText(label, { exact: true }).click())
}

// This prototype has no backend — all state lives in this tab's JS modules,
// so cross-screen flows (approve Solution Package -> unlock BOM -> deploy)
// use pushState + popstate instead of page.goto(), same pattern as
// solution-package.spec.js's client-approval end-to-end test.
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

test.describe('Deployment & Installation', () => {
  test('loads with no console errors, corrects the breadcrumb, and shows calculated KPIs', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/deployment')
    await expect(page.getByRole('heading', { name: /Deployment & Installation/ })).toBeVisible()
    // The render's breadcrumb reads "LLD" for this screen — that's a bug in
    // the render, not something to replicate (brief Step 8 instruction).
    const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]')
    await expect(breadcrumb).toContainText('Deployment & Installation')
    await expect(breadcrumb).not.toContainText('LLD')

    await expect(page.getByText('devices installed')).toBeVisible()
    await expect(page.getByText('APs mounted')).toBeVisible()
    await expect(page.getByText('uplinks live')).toBeVisible()
    await expect(page.getByText('overall progress')).toBeVisible()
    await expect(page.getByText('open issues')).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('a device cannot start installation until its BOM line is Delivered', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Canvas device selection at phone zoom needs mouse-precision pointer interaction')
    await page.goto('/b/b001/deployment')
    await page.waitForSelector('h1:has-text("Deployment & Installation")')
    await page.click('text=E-DE-ERL-C01-B001-EG-001')
    await expect(page.getByText('Awaiting delivery')).toBeVisible()
  })

  test('full install: serial validation, RU and uplink deviations auto-log exceptions, checklist/DGUV/evidence update, Accept is gated to Reviewer/PM', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Canvas device selection at phone zoom needs mouse-precision pointer interaction')
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await approveAndDeliverAll(page)
    await clientSideNavigate(page, '/b/b001/deployment')
    await page.waitForSelector('h1:has-text("Deployment & Installation")')
    await setRole(page, 'Field Engineer')

    await page.click('text=E-DE-ERL-C01-B001-EG-001')
    await expect(page.getByText('Awaiting delivery')).toHaveCount(0)

    // Serial/MAC: CMO match (brief §5.1 reused at deployment).
    await page.fill('input[placeholder="e.g. FCW2637A1B2"]', 'FCW2637A1B2')
    await page.fill('input[placeholder="00:1A:2B:3C:4D:5E"]', '00:1A:2B:3C:4D:5E')
    await page.click('button:has-text("Save serial & MAC")')
    await expect(page.getByText('Validated against CMO')).toBeVisible()

    // RU mismatch vs the designed placement (RU40) -> auto-logged exception.
    await page.locator('label', { hasText: 'Rack / RU' }).locator('input').fill('39')
    await page.click('button:has-text("Confirm Installation")')
    await expect(page.getByText('Exceptions (1 open)')).toBeVisible()
    const exceptionCard = page.locator('div', { hasText: 'Designed:' }).last()
    await expect(exceptionCard).toContainText('40')
    await expect(exceptionCard).toContainText('39')

    // Uplink media deviation vs the approved LLD -> a second exception,
    // correctly attributed to whichever device's panel confirmed it.
    const mediaSelect = page.locator('select').first()
    const designed = await mediaSelect.inputValue()
    await mediaSelect.selectOption(designed === 'cat6a' ? 'om4' : 'cat6a')
    await page.locator('button:has-text("Confirm Uplinking")').first().click()
    await expect(page.getByText('Exceptions (2 open)')).toBeVisible()

    // DGUV inspection date -> calculated status (brief §6.9 / D31).
    await page.fill('input[type="date"]', '2026-09-01')
    await page.click('button:has-text("Save inspection date")')
    await expect(page.getByText(/^Valid —/)).toBeVisible({ timeout: 10000 })

    // Evidence counter.
    await expect(page.getByText('Evidence (0)')).toBeVisible()
    await page.click('button:has-text("Record evidence added")')
    await expect(page.getByText('Evidence (1)')).toBeVisible()

    // Accept is gated to Reviewer/PM, not Field Engineer.
    await expect(page.getByText('Accept device')).toHaveCount(0)
    await setRole(page, 'PM')
    await expect(page.getByText('Accept device')).toBeVisible()
    await page.click('button:has-text("Accept device")')
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('a serial already recorded against another device is rejected as a duplicate', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Canvas device selection at phone zoom needs mouse-precision pointer interaction')
    await approveAndDeliverAll(page)
    await clientSideNavigate(page, '/b/b001/deployment')
    await page.waitForSelector('h1:has-text("Deployment & Installation")')
    await setRole(page, 'Field Engineer')

    const summaryCard = page.locator('.rounded-xl.border.border-border.bg-surface.p-4').first()
    async function selectDevice(hostname) {
      await page.click(`text=${hostname}`)
      await expect(summaryCard).toContainText(hostname, { timeout: 10000 })
    }

    await selectDevice('E-DE-ERL-C01-B001-EG-001')
    await page.fill('input[placeholder="e.g. FCW2637A1B2"]', 'DUPSERIAL01')
    await page.fill('input[placeholder="00:1A:2B:3C:4D:5E"]', '00:11:22:33:44:55')
    await page.click('button:has-text("Save serial & MAC")')
    await expect(page.getByText('Not found in CMO')).toBeVisible()

    await selectDevice('E-DE-ERL-C01-B001-EG-002')
    await page.fill('input[placeholder="e.g. FCW2637A1B2"]', 'DUPSERIAL01')
    await page.fill('input[placeholder="00:1A:2B:3C:4D:5E"]', '00:11:22:33:44:66')
    await page.click('button:has-text("Save serial & MAC")')
    await expect(page.getByText(/already recorded against another device/)).toBeVisible()
  })
})
