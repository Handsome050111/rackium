import { test, expect } from '@playwright/test'

test.describe('Building Overview dashboard', () => {
  test('shows calculated KPIs and correct phase statuses, no console errors', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await expect(page).toHaveURL(/\/b\/b001$/)
    await expect(page.getByRole('heading', { name: 'Building B001' })).toBeVisible()

    // Overall progress is calculated (44%), never a hand-typed 43% from the render.
    await expect(page.getByText('44%')).toBeVisible()

    // Scope to <main> — the sidebar has its own "BOM"/"Deployment & Installation"
    // nav links with the same text, and would otherwise be matched instead.
    const main = page.locator('main')

    // Future phases show grey "Not started", never the render's red "Pending".
    const deploymentCard = main.locator('a', { hasText: 'Deployment & Installation' })
    await expect(deploymentCard.getByText('Not started')).toBeVisible()

    // BOM shows "In progress" with a separate "Draft" sub-label.
    const bomCard = main.locator('a', { hasText: 'BOM' })
    await expect(bomCard.getByText('In progress')).toBeVisible()
    await expect(bomCard.getByText('Draft')).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('sidebar phase links navigate correctly', async ({ page }, testInfo) => {
    await page.goto('/b/b001')

    if (testInfo.project.name === 'phone') {
      await page.getByRole('button', { name: 'Open menu' }).click()
    }

    await page.getByRole('link', { name: /^LLD$/ }).click()
    await expect(page).toHaveURL(/\/b\/b001\/lld$/)
    await expect(page.getByRole('heading', { name: 'LLD' })).toBeVisible()
  })
})
