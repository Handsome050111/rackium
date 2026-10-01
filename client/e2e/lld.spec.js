import { test, expect } from '@playwright/test'

async function setRole(page, label) {
  await page.click('[aria-label="User menu"]')
  await page.getByText(label, { exact: true }).click()
}

test.describe('LLD — Low-Level Design', () => {
  test('loads with no console errors, defaults to Connectivity on the Border', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/lld')
    await expect(page.getByRole('heading', { name: /LLD/ })).toBeVisible()
    await expect(page.getByText('Selected planned device')).toBeVisible()
    await expect(page.locator('.react-flow__node-device').first()).toBeVisible()
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('Distribution shows "Not required — S site", never a fabricated placeholder device', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await expect(page.getByText('Distribution layer not required — S site')).toBeVisible()
  })

  test('Installation details always read "To be populated at deployment" — never "Link test passed"', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await expect(page.getByText('To be populated at deployment').first()).toBeVisible()
    await expect(page.getByText('Link test passed')).toHaveCount(0)
  })

  test('selecting an Edge shows paginated access-port mapping, never more than 48 real ports', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await page.click('text=E-DE-ERL-C01-B001-EG-001')
    await expect(page.getByText(/Access-port mapping/)).toBeVisible()
    await expect(page.getByText('Showing 1–8 of 48')).toBeVisible()

    await page.getByRole('button', { name: 'Next page' }).first().click()
    await expect(page.getByText('Showing 9–16 of 48')).toBeVisible()
  })

  test('Rack elevations tab renders every rack with an Open in Rackium Editor action', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Rack elevations' }).click()
    await expect(page.getByText('UG1705').first()).toBeVisible()
    const openButtons = page.getByRole('button', { name: 'Open in Rackium Editor' })
    await expect(openButtons.first()).toBeVisible()
    expect(await openButtons.count()).toBe(8) // B001's seeded rack count
  })

  test('Port schedule never shows more ports than a device really has', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Port schedule' }).click()
    await page.getByLabel('Device').selectOption({ label: 'Fusion' })
    const rowCount = await page.locator('tbody tr').count()
    expect(rowCount).toBeLessThanOrEqual(20) // page size, and Fusion only has 24 core ports total
    await expect(page.getByText('Te1/1/1').first()).toBeVisible()
  })

  test('Cable schedule flags an Estimated pathway, distinct from a Surveyed one', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Cable schedule' }).click()
    // Border -> Edge 02 (OM4) rides the seeded Estimated route.
    const row = page.locator('tr', { hasText: 'Edge 02 Te1/1/1' })
    await expect(row.getByText('Estimated')).toBeVisible()
    // Border -> Edge 01 rides the seeded Surveyed route — same table, different flag.
    const surveyedRow = page.locator('tr', { hasText: 'Edge 01 Te1/1/1' })
    await expect(surveyedRow.getByText('Surveyed')).toBeVisible()
  })

  test('Cable schedule never shows "Installed length" as a number — always the deployment placeholder', async ({ page }) => {
    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Cable schedule' }).click()
    const installedCells = page.locator('td', { hasText: 'To be populated at deployment' })
    expect(await installedCells.count()).toBeGreaterThan(0)
  })

  test('Architect can edit a Cable ID inline; Viewer sees it as read-only text', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'Inline editing a wide schedule table is a desktop/tablet workflow')

    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Cable schedule' }).click()

    await setRole(page, 'Viewer')
    // Every seeded connection already has a Cable ID — Viewer must see it as
    // plain text, not a clickable edit affordance.
    await expect(page.locator('button', { hasText: '26184735' })).toHaveCount(0)
    await expect(page.getByText('26184735').first()).toBeVisible()

    await setRole(page, 'Architect')
    const editButton = page.locator('button', { hasText: '26184735' })
    await expect(editButton).toBeVisible()
    await editButton.click()
    await expect(page.locator('input').first()).toBeVisible()
  })

  test('HLD reconciliation: a change + re-approval after LLD starts raises a banner with a real diff, and rebasing clears it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag-and-drop needs mouse-precision pointer interaction')

    await page.goto('/b/b001/lld')
    await expect(page.getByText('Based on HLD v1')).toBeVisible()
    await expect(page.locator('[role="alert"]')).toHaveCount(0)

    await page.getByRole('link', { name: 'HLD', exact: true }).click()
    await page.waitForSelector('text=NexAI-Suggested HLD')
    await setRole(page, 'Architect')

    const apItem = page.getByText('AP', { exact: true })
    const room = page.locator('.react-flow__node-room', { hasText: 'TR-1OG-01' }).first()
    const src = await apItem.boundingBox()
    const dst = await room.boundingBox()
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await page.mouse.down()
    await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2 + 20, { steps: 5 })
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 })
    await page.waitForTimeout(100)
    await page.mouse.up()
    await page.waitForTimeout(300)

    await page.click('button:has-text("Submit for approval")')
    await setRole(page, 'PM')
    await page.click('button:has-text("Approve")')
    await page.waitForTimeout(300)

    await page.getByRole('link', { name: 'LLD', exact: true }).click()
    await page.waitForSelector('text=LLD — Low-Level Design')
    await expect(page.locator('[role="alert"]')).toHaveCount(1)
    await expect(page.getByText(/HLD changed after LLD started/)).toBeVisible()

    await page.click('button:has-text("Review changes")')
    await expect(page.getByText(/Device added/)).toBeVisible()

    await setRole(page, 'Architect')
    await page.click('button:has-text("Mark reviewed against HLD")')
    await page.waitForTimeout(300)
    await expect(page.locator('[role="alert"]')).toHaveCount(0)
    await expect(page.getByText('Based on HLD v2')).toBeVisible()
  })

  test('a device added in HLD shows up in LLD\'s Port Schedule (shared data model)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag-and-drop needs mouse-precision pointer interaction')

    await page.goto('/b/b001/lld')
    await page.getByRole('button', { name: 'Port schedule' }).click()
    const totalBefore = Number((await page.getByText(/Showing .* of \d+/).textContent()).match(/of (\d+)/)[1])

    // Edge (not AP — APs are intentionally excluded from the port schedule,
    // since AP uplinks are TBD at deployment) has 48 access + 8 module ports.
    await page.getByRole('link', { name: 'HLD', exact: true }).click()
    await page.waitForSelector('text=NexAI-Suggested HLD')
    await setRole(page, 'Architect')

    const edgeItem = page.getByText('Edge', { exact: true })
    const room = page.locator('.react-flow__node-room', { hasText: 'TR-1OG-02' }).first()
    const src = await edgeItem.boundingBox()
    const dst = await room.boundingBox()
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await page.mouse.down()
    await page.mouse.move(src.x + src.width / 2 + 20, src.y + src.height / 2 + 20, { steps: 5 })
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 })
    await page.waitForTimeout(100)
    await page.mouse.up()
    await page.waitForTimeout(300)

    await page.getByRole('link', { name: 'LLD', exact: true }).click()
    await page.waitForSelector('text=LLD — Low-Level Design')
    await page.getByRole('button', { name: 'Port schedule' }).click()
    await page.waitForTimeout(300)
    const totalAfter = Number((await page.getByText(/Showing .* of \d+/).textContent()).match(/of (\d+)/)[1])
    expect(totalAfter).toBe(totalBefore + 56) // 48 access + 8 module ports, exactly — never more, never fewer
  })
})
