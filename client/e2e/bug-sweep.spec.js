import { test, expect } from '@playwright/test'

// Regressions from the frontend bug sweep (docs/BUG-SWEEP.md).

test.describe('unknown screens', () => {
  test('an unknown building screen shows Page not found with a way back, not unfinished text', async ({ page }) => {
    await page.goto('/b/b001/no-such-screen')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByText(/later step/i)).toHaveCount(0)
    await page.getByRole('link', { name: 'Back to the building overview' }).click()
    await expect(page).toHaveURL(/\/b\/b001$/)
    await expect(page.getByRole('heading', { name: 'Building B001' })).toBeVisible()
  })
})

test.describe('top bar and dashboard controls open their targets', () => {
  test('the Notifications bell opens a panel with All / Unread tabs and an empty state', async ({ page }) => {
    await page.goto('/b/b001')
    await expect(page.getByRole('heading', { name: 'Building B001' })).toBeVisible()
    await page.getByRole('button', { name: 'Notifications' }).click()
    const panel = page.getByRole('dialog', { name: 'Notifications panel' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    await panel.getByRole('tab', { name: 'Unread' }).click()
    await expect(panel.getByRole('tab', { name: 'Unread' })).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByText('No notifications yet')).toBeVisible()
  })

  test('the Settings button opens the Settings page with its three sections', async ({ page }) => {
    await page.goto('/b/b001')
    await expect(page.getByRole('heading', { name: 'Building B001' })).toBeVisible()
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/b\/b001\/settings$/)
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Organisation' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible()
  })

  test('"View full history" opens the Activity page listing the dashboard history', async ({ page }) => {
    await page.goto('/b/b001')
    await expect(page.getByRole('heading', { name: 'Building B001' })).toBeVisible()
    await page.getByRole('link', { name: 'View full history' }).click()
    await expect(page).toHaveURL(/\/b\/b001\/activity$/)
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
    await expect(page.getByText('No activity yet')).toHaveCount(0)
  })
})
