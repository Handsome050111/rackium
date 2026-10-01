import { test, expect } from '@playwright/test'

async function setRole(page, label) {
  await page.click('[aria-label="User menu"]')
  await page.getByText(label, { exact: true }).click()
}

test.describe('BOM — Bill of Materials', () => {
  test('loads with no console errors, shows calculated KPIs and the four brief sections', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/bom')
    await expect(page.getByRole('heading', { name: /Suggested BOM/ })).toBeVisible()
    await expect(page.getByText('managed devices')).toBeVisible()
    // Brief Step 7: four distinct sections, Cables separate from Optics & fibre
    // (the render merges them — this is a deliberate deviation).
    await expect(page.getByRole('cell', { name: 'Network devices' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Optics & fibre' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Cables' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Power & accessories' })).toBeVisible()
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('shows the "Draft" sub-label before the Solution Package is approved', async ({ page }) => {
    await page.goto('/b/b001/bom')
    await expect(page.getByText('DRAFT')).toBeVisible()
  })

  test('the WAN circuit (Telekom SD-WAN CPE) is never listed as a procured device', async ({ page }) => {
    await page.goto('/b/b001/bom')
    await expect(page.getByText('Telekom SD-WAN CPE')).toHaveCount(0)
  })

  test('the probe device line is always present with "Project requirement" as its basis', async ({ page }) => {
    await page.goto('/b/b001/bom')
    const row = page.locator('tr', { hasText: 'Probe device' })
    await expect(row).toBeVisible()
    await expect(row.getByText('Project requirement')).toBeVisible()
  })

  test('pricing is hidden for Architect, visible for PM', async ({ page }) => {
    await page.goto('/b/b001/bom')
    await setRole(page, 'Architect')
    await expect(page.getByText('Pricing summary')).toHaveCount(0)
    await expect(page.getByText('Unit price')).toHaveCount(0)

    await setRole(page, 'PM')
    await expect(page.getByText('Pricing summary')).toBeVisible()
    await expect(page.getByText('Unit price')).toBeVisible()
  })

  test('procurement status is locked (no dropdown) before Solution Package approval', async ({ page }) => {
    await page.goto('/b/b001/bom')
    await setRole(page, 'PM')
    await expect(page.locator('select').first()).toHaveCount(0)
    await expect(page.getByText('Not ordered').first()).toBeVisible()
  })

  test('the reconciliation check reports how many real devices the BOM covers', async ({ page }) => {
    await page.goto('/b/b001/bom')
    await expect(page.getByText(/BOM reconciles with HLD\/LLD/)).toBeVisible()
  })
})
