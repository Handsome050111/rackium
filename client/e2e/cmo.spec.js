import { test, expect } from '@playwright/test'

function setRole(page, label) {
  return page.click('[aria-label="User menu"]').then(() => page.getByText(label, { exact: true }).click())
}

function clientSideNavigate(page, path) {
  return page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

test.describe('CMO Inventory Validation', () => {
  test('loads with no console errors and shows calculated KPIs plus the SAL-wide Unassigned list', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/cmo')
    await expect(page.getByRole('heading', { name: 'CMO Inventory Validation' })).toBeVisible()
    await expect(page.getByText('Devices imported (SAL)')).toBeVisible()
    await expect(page.getByText(/Unassigned at SAL ERL/)).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('PM assigns an unassigned device to a building, and the count updates', async ({ page }) => {
    await page.goto('/b/b001/cmo')
    await expect(page.getByRole('heading', { name: 'CMO Inventory Validation' })).toBeVisible()
    await setRole(page, 'PM')

    const row = page.locator('div.flex.flex-wrap.items-center.justify-between', { hasText: 'SW-UNK-01' })
    await row.locator('select').selectOption('b002')
    await expect(page.getByText('Unassigned at SAL ERL (2)')).toBeVisible()
  })

  test('import wizard validates missing serial, in-file and project duplicates, bad MAC, and routes an unknown building to Unassigned without blocking it', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/cmo')
    await setRole(page, 'PM')
    await page.click('text=Import CMO Inventory')

    const csv = [
      'Hostname,Model,Serial number,MAC address,Building,Floor,Room,Rack,RU',
      'NEW-SW-01,Cisco C9200,DUPEINFILE,00:11:22:33:44:AA,B002,EG,TR-B002-EG-01,R01,10',
      'NEW-SW-02,Cisco C9200,,00:11:22:33:44:BB,B002,EG,TR-B002-EG-01,R01,11',
      'NEW-SW-03,Cisco C9200,DUPEINFILE,00:11:22:33:44:CC,B002,EG,TR-B002-EG-01,R01,12',
      'NEW-SW-04,Cisco C9200,FCW2637A1B2,00:11:22:33:44:DD,B002,EG,TR-B002-EG-01,R01,13',
      'NEW-SW-05,Cisco C9200,NEWSER005,bad-mac,B002,EG,TR-B002-EG-01,R01,14',
      'NEW-SW-06,Cisco C9200,NEWSER006,00:11:22:33:44:EE,Nowhere,EG,TR-X,R01,15',
    ].join('\n')

    await page.setInputFiles('input[type="file"]', { name: 'cmo-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByText(/row\(s\)\. Map each/)).toBeVisible()
    await page.click('text=Preview import')

    await expect(page.getByText('1 valid')).toBeVisible()
    await expect(page.getByText('5 blocked (won\'t be imported)')).toBeVisible()
    await expect(page.getByText('1 going to Unassigned')).toBeVisible()
    await expect(page.locator('tr', { hasText: 'NEW-SW-02' })).toContainText('Missing serial')
    await expect(page.locator('tr', { hasText: 'NEW-SW-04' })).toContainText('Duplicate in project')
    await expect(page.locator('tr', { hasText: 'NEW-SW-05' })).toContainText('Invalid MAC format')
    await expect(page.locator('tr', { hasText: 'NEW-SW-06' })).toContainText('Unknown building')

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('committing an import flips only the receiving building\'s CMO status, without regressing a building that has already progressed past CMO', async ({ page }) => {
    await page.goto('/b/b001/cmo')
    await setRole(page, 'PM')
    await page.click('text=Import CMO Inventory')

    const csv = ['Hostname,Model,Serial number,MAC address,Building,Floor,Room,Rack,RU', 'NEW-SW-10,Cisco C9200,UNIQSER010,00:11:22:33:55:AA,B002,EG,TR-B002-EG-01,R01,10'].join('\n')
    await page.setInputFiles('input[type="file"]', { name: 'cmo-import2.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await page.click('text=Preview import')
    await page.click('button:has-text("Commit import")')
    await expect(page.getByText('12', { exact: true }).first()).toBeVisible()

    // B002's CMO flips to Completed; its "current phase" stays Survey, not
    // regressed back to CMO by the SAL's other unassigned devices.
    await clientSideNavigate(page, '/b/b002')
    await page.waitForSelector('h1:has-text("Building B002")')
    await expect(page.locator('a', { hasText: 'CMO Inventory Validation' }).last()).toContainText('Completed')
    const currentPhaseTile = page.locator('div.flex.flex-col.gap-1', { hasText: 'Current phase' })
    await expect(currentPhaseTile).toContainText('Survey')
  })
})
