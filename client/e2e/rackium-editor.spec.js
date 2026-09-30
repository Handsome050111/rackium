import { test, expect } from '@playwright/test'

test.describe('Rackium Editor', () => {
  test('LLD landing lists racks with an Open in Rackium Editor action', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await expect(page.getByRole('heading', { name: 'LLD' })).toBeVisible()
    const rackButton = page.getByRole('button', { name: /TR-EG-01 · Rack R01/ })
    await expect(rackButton).toContainText('Open in Rackium Editor')
  })

  test('opens from LLD, not from the sidebar', async ({ page }) => {
    await page.goto('/b/b001')
    // No "Rackium Editor" sidebar item — it is a mode inside LLD (v2.3 D43).
    await expect(page.getByRole('link', { name: 'Rackium Editor' })).toHaveCount(0)
  })

  test('full port-mapping flow: select ports, correct length/id, apply, save revision', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Port selection needs mouse-precision pointer interaction')

    await page.goto('/b/b001/lld/editor?rack=rack-tr-eg-01-r01')
    await expect(page.getByRole('heading', { name: 'Rackium Editor — Port Mapping' })).toBeVisible()

    // RackElevation click-to-cycle: first click on a placement sets it as
    // source, the next click on a different placement sets destination.
    await page.locator('button', { hasText: 'E-DE-ERL-C01-B001-EG-001' }).click() // Edge switch
    await expect(page.getByText('Source · RU40')).toBeVisible()
    await page.click('button[title="Gi1/0/12"]')

    await page.locator('button', { hasText: 'PP-01' }).click()
    await expect(page.getByText('Destination · RU42')).toBeVisible()
    await page.click('button[title="09"]')

    // The highlighted port and its caption must always agree (the render's
    // page 15 mistake: highlight on 08, caption said "Port 09 selected").
    await expect(page.getByText('Gi1/0/12 selected')).toBeVisible()
    await expect(page.getByText('09 selected')).toBeVisible()

    // §6.3 worked example: RU40 -> RU42 same rack = 0.59m -> 1m stock length,
    // not the render's stale 2m.
    await expect(page.getByText('1 m stock length')).toBeVisible()
    await expect(page.getByText('No blocking conflicts')).toBeVisible()

    const applyButton = page.getByRole('button', { name: 'Apply Mapping' })
    await expect(applyButton).toBeEnabled()

    const statusBefore = await page.getByText(/Revision \d+ · Unsaved changes \d+/).textContent()
    await applyButton.click()
    await expect(page.getByText(/Unsaved changes 1/)).toBeVisible()

    const saveButton = page.getByRole('button', { name: 'Save Revision' })
    await expect(saveButton).toBeEnabled()
    await saveButton.click()
    await expect(page.getByText(/Unsaved changes 0/)).toBeVisible()

    const statusAfter = await page.getByText(/Revision \d+ · Unsaved changes \d+/).textContent()
    expect(statusAfter).not.toBe(statusBefore)
  })

  test('editor is view-only below 768px (v2.3 §7.4 HLD/LLD canvas rule)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'Only meaningful at phone width')

    await page.goto('/b/b001/lld/editor?rack=rack-tr-eg-01-r01')
    await expect(page.getByText('View-only on phone')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply Mapping' })).toBeDisabled()

    // Clicking a placement must not select it (no SRC badge, no PortFace
    // panel opening) while view-only.
    await page.locator('button', { hasText: 'E-DE-ERL-C01-B001-EG-001' }).click()
    await expect(page.getByText('SRC')).toHaveCount(0)
    await expect(page.getByText('Source · RU40')).toHaveCount(0)
  })
})
