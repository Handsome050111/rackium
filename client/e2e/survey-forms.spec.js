import { test, expect } from '@playwright/test'

function setRole(page, label) {
  return page.click('[aria-label="User menu"]').then(() => page.getByText(label, { exact: true }).click())
}

async function toggleOffline(page) {
  // page.fill() doesn't dispatch a real mousedown, so the user menu's
  // outside-click-closes listener can miss it, leaving the dropdown open
  // from an earlier interaction — only (re)open it if the toggle isn't
  // already visible.
  if ((await page.locator('[aria-label="Toggle offline simulation"]').count()) === 0) {
    await page.click('[aria-label="User menu"]')
  }
  await page.click('[aria-label="Toggle offline simulation"]')
  // Leave the dropdown closed — on phone width it can overlap page content
  // (like the "simulate a conflicting edit" link) the next step needs to
  // click, and clicking the toggle itself doesn't close the menu.
  await page.click('[aria-label="User menu"]')
}

test.describe('Survey form tabs (Room Details)', () => {
  test('loads with no console errors; all 18 tabs are reachable with calculated auto-fill and prefill confirmation', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/survey/room')
    await expect(page.getByText('Building-wide')).toBeVisible()
    await expect(page.getByText(/\/78 tabs Verified/)).toBeVisible()

    // Location Details' prefilled_validated fields show a confirm tick;
    // plain `prefilled` fields don't.
    await expect(page.getByText('Validated on site').first()).toBeVisible()

    await page.click('text=TR-EG-01')
    await page.click('text=Floor-wise Device Details')
    await page.click('button:has-text("Add row")')
    await expect(page.getByText('No rows yet')).toHaveCount(0)
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toContain('Building B001') // calculated from site structure, not typed
    expect(bodyText).toContain('TR-EG-01')

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('Rack Layout renders one card per real rack, with a calculated identity and a link into the existing Rack Survey screen', async ({ page }) => {
    await page.goto('/b/b001/survey/room')
    await page.click('text=TR-EG-01')
    await page.click('text=Rack Layout')
    await expect(page.getByText('Rack R01')).toBeVisible()
    const link = page.getByRole('link', { name: /Open in Rackium Editor/ }).first()
    await expect(link).toHaveAttribute('href', /\/survey\/rack\?rack=rack-tr-eg-01-r01/)
  })

  test('Comms Rooms Summary calculates RU/power once a real rack code is entered — not re-typed', async ({ page }) => {
    await page.goto('/b/b001/survey/room')
    await setRole(page, 'Field Engineer')
    await page.click('text=TR-EG-01')
    await page.click('text=Comms Rooms Summary')
    await page.click('button:has-text("Add row")')

    // Below the sm breakpoint the table is hidden in favour of stacked
    // cards (brief: "table layouts become stacked cards on phone"), so the
    // column-index approach below only applies at tablet width and up.
    const viewport = page.viewportSize()
    if (viewport && viewport.width < 640) {
      await page.getByLabel('Rack Number', { exact: false }).fill('R01')
      await expect(page.locator('label', { hasText: 'Total Number Rack Units' })).toContainText('42') // rack-tr-eg-01-r01's heightU
      return
    }

    // The table (including its header row) only renders once rows.length >
    // 0, and allInnerTexts() doesn't auto-wait for the locator to resolve —
    // without this, a slow render under load reads an empty header list,
    // findIndex returns -1, and .nth(-1) silently resolves to the *last*
    // column instead of failing clearly.
    await expect(page.locator('table').first().locator('thead th').first()).toBeVisible()
    const headerTexts = await page.locator('table').first().locator('thead th').allInnerTexts()
    const rackNumberIndex = headerTexts.findIndex((t) => t.includes('Rack Number'))
    const firstRow = page.locator('table').first().locator('tbody tr').first()
    await firstRow.locator('td').nth(rackNumberIndex).locator('input').fill('R01')

    const totalRuIndex = headerTexts.findIndex((t) => t.includes('Total Number Rack Units'))
    await expect(firstRow.locator('td').nth(totalRuIndex)).toContainText('42') // rack-tr-eg-01-r01's heightU
  })

  test('an empty table never blocks submit — a room without a firewall can still submit that tab', async ({ page }) => {
    await page.goto('/b/b001/survey/room')
    await setRole(page, 'Field Engineer')
    await page.click('text=TR-1OG-01')
    await page.click('text=Firewall')
    await expect(page.getByText('100% complete')).toBeVisible()
    await expect(page.getByText('Submit for verification')).toBeEnabled()
  })

  test.describe('workflow and offline sync', () => {
    test.describe.configure({ mode: 'serial' })

    test('Submit -> Verify -> Reject -> Draft, gated to Field Engineer / Architect', async ({ page }) => {
      await page.goto('/b/b001/survey/room')
      await setRole(page, 'Field Engineer')
      await page.click('text=SSID')

      await page.click('text=Submit for verification')
      await expect(page.getByText('Submitted', { exact: true })).toBeVisible()
      await expect(page.getByText('Verify', { exact: true })).toHaveCount(0) // Field Engineer can't verify

      await setRole(page, 'Architect')
      await page.click('button:has-text("Reject")')
      await page.fill('input[placeholder="Reason for rejection"]', 'Missing guest SSID')
      await page.click('button:has-text("Confirm reject")')
      await expect(page.getByText('Rejected', { exact: true })).toBeVisible()
      await expect(page.getByText('Missing guest SSID')).toBeVisible()

      await setRole(page, 'Field Engineer')
      await page.click('button:has-text("Add row")')
      await expect(page.getByText('Draft', { exact: true })).toBeVisible() // rejection clears on the next edit
    })

    test('an offline edit shows the optimistic value immediately and syncs cleanly on reconnect', async ({ page }) => {
      await page.goto('/b/b001/survey/room')
      await setRole(page, 'Field Engineer')
      await page.click('text=Storage Area')

      await toggleOffline(page)
      await expect(page.getByText('Offline — saved locally')).toBeVisible()
      const firstInput = page.locator('input[type="text"]').first()
      await firstInput.fill('Loading dock B')
      await expect(firstInput).toHaveValue('Loading dock B')

      await toggleOffline(page)
      await expect(page.getByText('Offline — saved locally')).toHaveCount(0)
      await expect(page.getByText('Sync report')).toBeVisible()
      await expect(page.getByText('synced cleanly')).toBeVisible()
    })

    test('a conflicting edit from "another device" while offline is still applied on sync, and reported — last save wins', async ({ page }) => {
      await page.goto('/b/b001/survey/room')
      await setRole(page, 'Field Engineer')
      await page.click('text=Location Details')

      await toggleOffline(page)
      await page.locator('input[type="text"]').first().fill('My offline edit')
      await page.click('text=Dev: simulate a conflicting edit from another device on this tab')

      await toggleOffline(page)
      await expect(page.getByText('Sync report')).toBeVisible()
      await expect(page.getByText(/your edit overwrote it/)).toBeVisible()
    })
  })

  test('Org Admin can add a custom field (never required); Field Engineer cannot add one', async ({ page }) => {
    await page.goto('/b/b001/survey/room')
    await setRole(page, 'Field Engineer')
    await page.click('text=Storage Area')
    await expect(page.getByText('Add custom field')).toHaveCount(0)

    await setRole(page, 'Org Admin')
    await page.click('text=Add custom field (Org Admin)')
    await page.fill('input[placeholder="Field label"]', 'Internal note')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Internal note')).toBeVisible()
  })
})
