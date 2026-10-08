import { test, expect } from '@playwright/test'

async function setRole(page, label) {
  await page.click('[aria-label="User menu"]')
  await page.getByText(label, { exact: true }).click()
}

test.describe('HLD — High-Level Design', () => {
  test('loads with no console errors and shows the physical topology canvas', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/hld')
    await expect(page.getByRole('heading', { name: /NexAI-Suggested HLD/ })).toBeVisible()
    await expect(page.locator('.react-flow__node-device').first()).toBeVisible()
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('Survey inputs panel is calculated from survey data, not typed in', async ({ page }) => {
    await page.goto('/b/b001/hld')
    await expect(page.getByText('UG1705 · R01 · 37 free U')).toBeVisible()
    await expect(page.getByText('TR-2OG-01 · PP-09 · 0 free ports')).toBeVisible()
    await expect(page.getByText(/CMO inventory · \d+\/\d+/)).toBeVisible()
  })

  test('survey-linked rack link opens its rack survey screen', async ({ page }) => {
    await page.goto('/b/b001/hld')
    await page.click('text=UG1705 · R01 · 37 free U')
    await expect(page).toHaveURL(/\/survey\/rack\?rack=/)
  })

  test('Edit Uplink wizard: Cat6A into a full patch panel is blocked on capacity, not distance or SFP', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Editing is disabled in phone view-only mode')

    await page.goto('/b/b001/hld')
    await setRole(page, 'Architect')

    await page.click('button:has-text("Select a device, then create an uplink")')

    const selects = await page.locator('select').all()
    const sourceOptions = await selects[0].locator('option').allTextContents()
    await selects[0].selectOption({ label: sourceOptions.find((t) => /border/i.test(t)) })
    const destOptions = await selects[1].locator('option').allTextContents()
    await selects[1].selectOption({ label: destOptions.find((t) => /edge/i.test(t) && t.includes('2OG')) })
    await page.click('button:has-text("Next")')

    await page.click("text=Route via destination room's patch panel")
    await page.click('button:has-text("Next")')

    const mediaSelects = await page.locator('select').all()
    await mediaSelects[0].selectOption('1G')
    await mediaSelects[1].selectOption('cat6a')
    await page.click('button:has-text("Next")')

    await page.click('button:has-text("Run NexAI validation")')

    await expect(page.getByText('Cat6A is RJ45 — no SFP required')).toBeVisible()
    await expect(page.getByText(/m within the .* limit|No length estimate yet/)).toBeVisible()
    await expect(page.getByText('No free ports on the destination patch panel')).toBeVisible()
    await expect(page.getByText('BLOCKED — resolve the failing checks above')).toBeVisible()

    const applyButton = page.getByRole('button', { name: /Apply & Validate Uplink/ })
    await expect(applyButton).toBeDisabled()
  })

  test('workflow: Architect cannot approve; PM approves after Architect submits', async ({ page }) => {
    await page.goto('/b/b001/hld')

    await setRole(page, 'Architect')
    await page.click('button:has-text("Submit for approval")')
    await expect(page.getByText('Awaiting approval')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)

    await setRole(page, 'PM')
    await page.click('button:has-text("Approve")')
    await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  })

  test('Logical topology tab shows a read-only VLAN table', async ({ page }) => {
    await page.goto('/b/b001/hld')
    await page.click('text=Logical topology')
    await expect(page.getByText('Management')).toBeVisible()
    await expect(page.getByText('10.10.10.0/24')).toBeVisible()
  })

  test('drag a device from the library onto the canvas (desktop only)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag-and-drop needs mouse-precision pointer interaction')

    await page.goto('/b/b001/hld')
    await setRole(page, 'Architect')

    // React Flow lays nodes out asynchronously after the data is ready; on a
    // slower runner, reading a count or a boundingBox() (neither of which
    // auto-wait, unlike expect(...).toBeVisible()) right after goto() can
    // race it and see 0 nodes / a null box instead of the rendered canvas.
    const deviceNodes = page.locator('.react-flow__node-device')
    await expect(deviceNodes.first()).toBeVisible()
    const before = await deviceNodes.count()
    const apItem = page.getByText('AP', { exact: true })
    const room = page.locator('.react-flow__node-room', { hasText: 'TR-EG-01' }).first()
    await expect(apItem).toBeVisible()
    await expect(room).toBeVisible()

    const src = await apItem.boundingBox()
    const dst = await room.boundingBox()
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await page.mouse.down()
    await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2 + 20, { steps: 5 })
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 })
    await page.waitForTimeout(100)
    await page.mouse.up()

    await expect(page.locator('.react-flow__node-device')).toHaveCount(before + 1)
  })

  test('object library groups items into the client-audit categories, with not-yet-supported items inert', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'The object library is hidden in phone view-only mode')

    await page.goto('/b/b001/hld')
    await setRole(page, 'Architect')
    const library = page.getByText('HLD object library', { exact: true }).locator('xpath=..')
    for (const heading of ['Active networking', 'Server', 'Infrastructure', 'External', 'Passive']) {
      await expect(library.getByText(heading, { exact: true }).first()).toBeVisible()
    }

    // Supported roles are draggable; Firewall/UPS etc. render but cannot be dragged yet.
    await expect(library.locator('[title="Drag onto the canvas"]', { hasText: 'Fusion' })).toBeVisible()
    for (const label of ['Firewall', 'WLC', 'UPS', 'PDU', 'Sensor', 'WAN/SP connection', 'Remote site']) {
      await expect(library.locator('[title="Available in a later milestone"]', { hasText: label })).toBeVisible()
    }

    // Each role draws its own topology icon — Fusion, Distribution and Edge no longer share one glyph.
    const iconOf = (label) => library.locator('[title="Drag onto the canvas"]', { hasText: label }).locator('span[aria-hidden="true"]').innerHTML()
    const [fusion, distribution, edge] = await Promise.all([iconOf('Fusion'), iconOf('Distribution'), iconOf('Edge')])
    expect(new Set([fusion, distribution, edge]).size).toBe(3)
  })

  test('canvas device nodes draw a role-specific topology icon', async ({ page }) => {
    await page.goto('/b/b001/hld')
    const nodes = page.locator('.react-flow__node-device')
    await expect(nodes.first()).toBeVisible()
    const fusionIcon = await nodes.filter({ hasText: /^F-/ }).first().locator('span[aria-hidden="true"] svg').innerHTML()
    const edgeIcon = await nodes.filter({ hasText: /^E-/ }).first().locator('span[aria-hidden="true"] svg').innerHTML()
    expect(fusionIcon).not.toBe(edgeIcon)
  })

  test('phone: canvas is view-only, no toolbar or object library', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'View-only behaviour is phone-specific')

    await page.goto('/b/b001/hld')
    await expect(page.getByText('HLD object library')).toHaveCount(0)
    await expect(page.getByText('Select a device, then create an uplink')).toHaveCount(0)
  })
})
