import { test, expect } from '@playwright/test'

async function setRole(page, label) {
  await page.click('[aria-label="User menu"]')
  await page.getByText(label, { exact: true }).click()
}

function openGroup(page, name) {
  return page.locator('tr', { hasText: name }).getByText('Open').click()
}

test.describe('Solution Package', () => {
  test('loads with no console errors, shows all 18 sections with calculated completeness', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/solution-package')
    await expect(page.getByRole('heading', { name: /Solution Package/ })).toBeVisible()
    for (let n = 1; n <= 18; n++) {
      await expect(page.locator('td', { hasText: String(n) }).first()).toBeVisible()
    }
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('Export PDF / Export Word are present but disabled with the document-engine note', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    const pdfBtn = page.getByRole('button', { name: 'Export PDF' })
    await expect(pdfBtn).toBeDisabled()
    await expect(pdfBtn).toHaveAttribute('title', 'Available with document engine')
  })

  test('Group 1 (Network addressing) enforces VLAN range, duplicate and overlap rules', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    await setRole(page, 'Architect')
    await page.click('text=2. Required Inputs')
    await openGroup(page, 'Network addressing and segmentation')

    await page.click('button:has-text("Add entry")')
    const vlanInput = page.locator('input[placeholder="1-4094"]').first()
    await vlanInput.fill('9999')
    await vlanInput.blur()
    await expect(page.getByText('VLAN ID must be between 1 and 4094')).toBeVisible()

    await vlanInput.fill('20')
    await vlanInput.blur()
    await expect(page.getByText('All entries pass format, uniqueness and overlap checks.')).toBeVisible()
  })

  test('other Required Input groups use a simple key/value form, and fast edits do not drop each other (race-free)', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    await setRole(page, 'Architect')
    await page.click('text=2. Required Inputs')
    await openGroup(page, 'Wireless and RF design')

    await page.click('button:has-text("Add field")')
    const keyInput = page.locator('input[placeholder="Field"]').last()
    const valueInput = page.locator('input[placeholder="Value"]').last()
    await keyInput.fill('SSID standard')
    await keyInput.blur()
    await valueInput.fill('Corp-WiFi')
    await valueInput.blur()

    await expect(page.locator('tr', { hasText: 'Wireless and RF design' }).getByText('Completed')).toBeVisible()
  })

  test('only the PM can submit for client approval', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    await page.click('text=3. Validation & Approval')
    await setRole(page, 'Architect')
    await expect(page.getByText('Submit for Client Approval')).toHaveCount(0)

    await setRole(page, 'PM')
    await expect(page.getByText('Password (optional')).toBeVisible()
  })
})

test.describe('Solution Package — client approval end-to-end', () => {
  // Uses pushState + popstate instead of page.goto() for the PM -> client ->
  // design-freeze flow: this prototype has no backend, so all state lives
  // in this tab's JS modules — a real browser navigation would reload the
  // page and wipe it, same as it would for any other screen in this app.
  function clientSideNavigate(page, path) {
    return page.evaluate((p) => {
      window.history.pushState({}, '', p)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  }

  test('approving via the share link freezes HLD/LLD and unlocks BOM procurement', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    await page.waitForSelector('text=Solution Package — Building B001')

    const token = await page.evaluate(async () => {
      const mod = await import('/src/api/shareLink.js')
      const link = await mod.generateShareLink('b001', { password: 'client123', expiryDays: 14 })
      return link.token
    })

    await clientSideNavigate(page, `/approve/${token}`)
    await page.waitForSelector('text=password required')

    await page.fill('input[type="password"]', 'wrong')
    await page.click('button:has-text("View Package")')
    await expect(page.getByText('Incorrect password.')).toBeVisible()

    await page.fill('input[type="password"]', 'client123')
    await page.click('button:has-text("View Package")')
    await expect(page.getByText('Solution Package — Building B001')).toBeVisible()
    // No app shell on the public page.
    await expect(page.locator('nav[aria-label="Phases"]')).toHaveCount(0)

    await page.fill('input[placeholder="Your full name"]', 'Jane Client')
    await page.check('input[type="checkbox"]')
    await page.click('button:has-text("Approve")')
    await expect(page.getByText('Thank you — your decision has been recorded.')).toBeVisible()

    await clientSideNavigate(page, '/b/b001/hld')
    await page.waitForSelector('text=NexAI-Suggested HLD')
    await expect(page.getByText('Design frozen')).toBeVisible()
    await expect(page.getByRole('button', { name: /Generate HLD/ })).toBeDisabled()

    await clientSideNavigate(page, '/b/b001/lld')
    await page.waitForSelector('text=LLD — Low-Level Design')
    await expect(page.getByText('Design frozen')).toBeVisible()

    await clientSideNavigate(page, '/b/b001/bom')
    await page.waitForSelector('text=Suggested BOM')
    await expect(page.getByText('DRAFT')).toHaveCount(0) // unlocked, no longer a draft
  })

  test('requesting changes returns the LLD phase to In progress', async ({ page }) => {
    await page.goto('/b/b001/solution-package')
    await page.waitForSelector('text=Solution Package — Building B001')

    const token = await page.evaluate(async () => {
      const mod = await import('/src/api/shareLink.js')
      const link = await mod.generateShareLink('b001', { password: 'x', expiryDays: 14 })
      return link.token
    })

    await clientSideNavigate(page, `/approve/${token}`)
    await page.waitForSelector('text=password required')
    await page.fill('input[type="password"]', 'x')
    await page.click('button:has-text("View Package")')
    await page.fill('input[placeholder="Your full name"]', 'Jane Client')
    await page.check('input[type="checkbox"]')
    await page.click('button:has-text("Request changes")')
    await expect(page.getByText('Thank you — your decision has been recorded.')).toBeVisible()

    const statuses = await page.evaluate(async () => {
      const mod = await import('/src/api/buildings.js')
      const cards = await mod.getPhaseCards('b001')
      return Object.fromEntries(cards.map((c) => [c.id, c.status]))
    })
    expect(statuses['solution-package']).toBe('changes_requested')
    expect(statuses.lld).toBe('in_progress')
  })
})
