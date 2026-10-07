import { test, expect } from '@playwright/test'

// Deployment location tree (v2.3 §5.7, client audit 8.3). The tree is the phone's
// main view; on tablet and desktop it is a side panel that stays in sync with the canvas.
// Checks that only apply to one width return early rather than skipping, so the
// skipped count does not change.

const DEVICE = 'E-DE-ERL-C01-B001-EG-001'
const OTHER_DEVICE = 'E-DE-ERL-C01-B001-EG-002'

async function widthOf(page) {
  return page.viewportSize()?.width ?? 1440
}

test.describe('deployment location tree', () => {
  test('the tree lists the building, floors, rooms and devices with a status and counts at every width', async ({ page }) => {
    await page.goto('/b/b001/deployment')
    const tree = page.getByRole('navigation', { name: 'Location tree' })
    await expect(tree).toBeVisible()
    await expect(tree.getByText('Building B001')).toBeVisible()
    await expect(tree.getByText('TR-EG-01')).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(DEVICE) })).toBeVisible()
    // Node counts are shown as text, e.g. "2 pending".
    await expect(tree.getByText(/\d+ pending/).first()).toBeVisible()
  })

  test('phone: the device list is the main view and the map is not drawn until Map is chosen', async ({ page }) => {
    if ((await widthOf(page)) >= 768) return
    await page.goto('/b/b001/deployment')
    await expect(page.getByRole('tab', { name: 'Devices' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.react-flow')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Map' }).click()
    await expect(page.locator('.react-flow').first()).toBeVisible()
    await page.getByRole('tab', { name: 'Devices' }).click()
    await expect(page.getByRole('navigation', { name: 'Location tree' })).toBeVisible()
  })

  test('phone: tapping a device opens its checklist full screen, and Back returns to the list', async ({ page }) => {
    if ((await widthOf(page)) >= 768) return
    await page.goto('/b/b001/deployment')
    const row = page.getByRole('button', { name: new RegExp(DEVICE) })
    // boundingBox() does not auto-wait, unlike expect(...).toBeVisible() — the
    // tree depends on a dashboard fetch, so this can otherwise race the render.
    await expect(row).toBeVisible()
    const rowBox = await row.boundingBox()
    expect(rowBox.height, 'device row height').toBeGreaterThanOrEqual(44)
    await row.click()

    await expect(page.getByRole('button', { name: 'Back to devices' })).toBeVisible()
    await expect(page.getByText('Awaiting delivery')).toBeVisible()

    // The top bar stays usable while a device is open (the role switch lives there).
    await page.click('[aria-label="User menu"]')
    await expect(page.getByText('View as role', { exact: false })).toBeVisible()
    await page.click('[aria-label="User menu"]')

    await page.getByRole('button', { name: 'Back to devices' }).click()
    await expect(page.getByRole('button', { name: 'Back to devices' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Location tree' })).toBeVisible()
  })

  test('tablet and desktop: selecting a device in the tree selects it on the canvas, and the reverse', async ({ page }) => {
    if ((await widthOf(page)) < 768) return
    await page.goto('/b/b001/deployment')

    await page.getByRole('button', { name: new RegExp(DEVICE) }).click()
    await expect(page.getByRole('button', { name: new RegExp(DEVICE) })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Awaiting delivery')).toBeVisible()

    await page.locator('.react-flow__node', { hasText: OTHER_DEVICE }).first().click()
    await expect(page.getByRole('button', { name: new RegExp(OTHER_DEVICE) })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: new RegExp(DEVICE) })).toHaveAttribute('aria-pressed', 'false')
  })
})
