import { test, expect } from '@playwright/test'

test.describe('Physical Site Survey — Rack Layout', () => {
  test('Survey landing lists racks with an Open Rack Survey action', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await expect(page.getByRole('heading', { name: 'Physical Site Survey' })).toBeVisible()
    const rackButton = page.getByRole('button', { name: /TR-EG-01 · Rack R01/ })
    await expect(rackButton).toContainText('Open Rack Survey')
  })

  test('loads the rack with calculated readiness, no console errors, autosave does not fire on load', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/survey/rack?rack=rack-tr-eg-01-r01')
    await expect(page.getByRole('heading', { name: /Physical Site Survey — Rack Layout/ })).toBeVisible()
    await expect(page.getByText('Rack R01 — 42U')).toBeVisible()

    // Pre-seeded reserved RU and the 0U PDU rails (brief v2.3 §4.1).
    await expect(page.getByText('Reserved for FMO').first()).toBeVisible()
    await expect(page.getByText('Readiness summary')).toBeVisible()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()

    await page.waitForTimeout(1200) // past the autosave debounce
    await expect(page.getByText(/^Saved/)).toBeVisible()
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('a custom rack height (23U) renders correctly, not hardcoded to 42U', async ({ page }) => {
    await page.goto('/b/b001/survey/rack?rack=rack-tr-eg-01-r02')
    await expect(page.getByText('Rack R02 — 23U')).toBeVisible()
    await expect(page.getByText('Front: 23 Free RU (23 Contiguous) · 0 Used')).toBeVisible()
  })

  test('drag a device from the library onto the rack, then undo removes it (desktop only)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag-and-drop needs mouse-precision pointer interaction')

    await page.goto('/b/b001/survey/rack?rack=rack-tr-eg-01-r01')
    await expect(page.getByRole('heading', { name: /Physical Site Survey — Rack Layout/ })).toBeVisible()

    const libraryItem = page.locator('div', { hasText: '24-port switch' }).last()
    const frontPanel = page.locator('text=FRONT').locator('..')
    const targetRow = frontPanel.locator('span', { hasText: /^20$/ }).first()

    const src = await libraryItem.boundingBox()
    const dst = await targetRow.boundingBox()
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await page.mouse.down()
    await page.mouse.move(dst.x + 40, dst.y + 10, { steps: 10 })
    await page.waitForTimeout(100)
    await page.mouse.up()

    await expect(page.getByText('24-port switch · 1U')).toBeVisible()
    await expect(page.getByText('Unsaved changes')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('24-port switch · 1U')).toHaveCount(0)
  })

  test('role gating: Viewer sees the rack read-only with no library', async ({ page }) => {
    await page.goto('/b/b001/survey/rack?rack=rack-tr-eg-01-r01')
    await page.click('button[aria-label="User menu"]')
    await page.getByText('Viewer', { exact: true }).click()

    await expect(page.getByText('Rack object library')).toHaveCount(0)
    await expect(page.getByText(/sees the rack read-only/)).toBeVisible()
  })

  test('role gating: only Architect can drag Reserved RU, only PM/Org Admin can drag Blocked RU', async ({ page }) => {
    await page.goto('/b/b001/survey/rack?rack=rack-tr-eg-01-r01')

    async function switchRole(label) {
      await page.click('button[aria-label="User menu"]')
      await page.getByText(label, { exact: true }).click()
      await page.waitForTimeout(150)
    }

    await switchRole('Architect')
    const reservedClass = await page.locator('div', { hasText: 'Reserved RU' }).last().getAttribute('class')
    const blockedClassArchitect = await page.locator('div', { hasText: 'Blocked RU' }).last().getAttribute('class')
    expect(reservedClass).not.toContain('cursor-not-allowed')
    expect(blockedClassArchitect).toContain('cursor-not-allowed')

    await switchRole('PM')
    const blockedClassPm = await page.locator('div', { hasText: 'Blocked RU' }).last().getAttribute('class')
    expect(blockedClassPm).not.toContain('cursor-not-allowed')
  })
})
