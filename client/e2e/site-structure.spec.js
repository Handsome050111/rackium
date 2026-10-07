import { test, expect } from '@playwright/test'

// The room-code label and its "+ Add rack" button are siblings inside the
// room box, not nested — a plain `div, {hasText}` filter matches both the
// box and the label itself ambiguously. This walks from the label (unique
// by its class) up to its exact parent, the room box.
function roomBox(page, code) {
  return page.locator('div.text-xs.font-semibold.text-text', { hasText: code }).locator('xpath=..')
}

test.describe('Physical Site Survey — Site Structure', () => {
  test('single-building view loads with no console errors', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/b/b001/survey')
    await expect(page.getByRole('heading', { name: /Building & Room Structure/ })).toBeVisible()
    await expect(page.getByText('TR-EG-01')).toBeVisible()
    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('multi-building header reads "SAL ERL · Campus C01", not the render\'s "SAL Code C01"', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('text=View all buildings in campus C01')
    await expect(page.getByRole('heading', { name: /Multi-Building Structure/ })).toBeVisible()
    await expect(page.getByText('SAL ERL · Campus C01')).toBeVisible()
    await expect(page.getByText('SAL Code C01')).toHaveCount(0)

    // All three buildings present, with B002/B003 room naming matching the render.
    await expect(page.getByText('Building B002 · Production')).toBeVisible()
    await expect(page.getByText('Building B003 · Logistics')).toBeVisible()
    await expect(page.getByText('TR-B002-EG-01')).toBeVisible()
  })

  test('selecting a room shows its captured survey facts', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('text=TR-EG-01')
    await expect(page.getByText('Room ID')).toBeVisible()
    // Status is rendered as <select> values, not plain text — option text
    // isn't "visible" while the dropdown is closed, so assert on value.
    const accessValue = await page.locator('select').nth(0).inputValue()
    const powerValue = await page.locator('select').nth(1).inputValue()
    expect(accessValue).toBe('verified')
    expect(powerValue).toBe('available')
  })

  test('"Add communication room" creates a room on an empty floor', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('button:has-text("Add communication room")')
    await expect(page.getByText('TR-3OG-01')).toBeVisible()
  })

  test('the + button adds a rack to a room, numbered after its existing racks', async ({ page }) => {
    await page.goto('/b/b001/survey')
    // TR-1OG-02 starts with exactly one rack (R01) in the seed data.
    const room = roomBox(page, 'TR-1OG-02')
    await room.locator('button[title="Add rack"]').click()
    await expect(room.getByText('R02', { exact: true })).toBeVisible()
  })

  test('building connection: click two rooms to connect, then set route status and distance', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('button:has-text("Building connection")')
    await page.click('text=TR-EG-01')
    await page.click('text=TR-1OG-01')

    await expect(page.getByText('Route status')).toBeVisible()
    await expect(page.locator('dd', { hasText: 'TR-EG-01' })).toBeVisible()
    await expect(page.locator('dd', { hasText: 'TR-1OG-01' })).toBeVisible()

    await page.selectOption('select >> nth=0', 'surveyed')
    await page.fill('input[type="number"]', '15')
    await expect(page.getByText(/surveyed pathway length/)).toBeVisible()
  })

  test('"Validate structure" flags a rack with no room details captured', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('button:has-text("Add communication room")') // TR-3OG-01, no meta
    const newRoom = roomBox(page, 'TR-3OG-01')
    await newRoom.locator('button[title="Add rack"]').click()
    await page.click('text=Validate structure')
    await expect(page.getByText(/no room details captured/)).toBeVisible()
  })

  test('Rack Survey stepper link opens the Step 3 rack survey screen', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('text=Rack Survey')
    await expect(page).toHaveURL(/\/survey\/rack\?rack=/)
    await expect(page.getByRole('heading', { name: /Rack Layout & Installation Readiness/ })).toBeVisible()
  })

  test('role gating: Org Admin is read-only (only Field Engineer/PM/Architect edit)', async ({ page }) => {
    await page.goto('/b/b001/survey')
    await page.click('button[aria-label="User menu"]')
    await page.getByText('Org Admin', { exact: true }).click()

    await expect(page.getByText('Survey object library')).toHaveCount(0)
    await expect(page.getByText(/sees the structure read-only/)).toBeVisible()
  })

  test('role gating: PM and Architect can edit, per v2.3 "PM or Architect may pre-create"', async ({ page }) => {
    await page.goto('/b/b001/survey')

    await page.click('button[aria-label="User menu"]')
    await page.getByText('PM', { exact: true }).click()
    await expect(page.getByText('Survey object library')).toBeVisible()

    await page.click('button[aria-label="User menu"]')
    await page.getByText('Architect', { exact: true }).click()
    await expect(page.getByText('Survey object library')).toBeVisible()
  })

  test('drag a Rack from the library onto a room (desktop only)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Drag-and-drop needs mouse-precision pointer interaction')

    await page.goto('/b/b001/survey')
    const rackTool = page.locator('div', { hasText: 'Rack' }).filter({ hasText: /^Rack$/ }).last()
    const targetRoom = roomBox(page, 'TR-1OG-02')
    // boundingBox() does not auto-wait, unlike expect(...).toBeVisible() —
    // this can otherwise race the structure's render.
    await expect(rackTool).toBeVisible()
    await expect(targetRoom).toBeVisible()

    const src = await rackTool.boundingBox()
    const dst = await targetRoom.boundingBox()
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
    await page.mouse.down()
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 10 })
    await page.waitForTimeout(100)
    await page.mouse.up()

    await expect(targetRoom.getByText('R02', { exact: true })).toBeVisible()
  })
})
