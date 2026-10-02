import { test, expect } from '@playwright/test'

function setRole(page, label) {
  return page.click('[aria-label="User menu"]').then(() => page.getByText(label, { exact: true }).click())
}

// This prototype has no backend — all state lives in this tab's JS modules,
// so cross-screen flows use pushState + popstate instead of page.goto(),
// same pattern as every other phase's cross-screen e2e test.
function clientSideNavigate(page, path) {
  return page.evaluate((p) => {
    window.history.pushState({}, '', p)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

async function approveAndDeliverAll(page) {
  await page.goto('/b/b001/solution-package')
  await page.waitForSelector('text=Solution Package — Building B001')
  const token = await page.evaluate(async () => {
    const mod = window.__rackiumTestApi.shareLink
    const link = await mod.generateShareLink('b001', { password: 'client123', expiryDays: 14 })
    return link.token
  })
  await clientSideNavigate(page, `/approve/${token}`)
  await page.waitForSelector('text=password required')
  await page.fill('input[type="password"]', 'client123')
  await page.click('button:has-text("View Package")')
  await expect(page.getByText('Solution Package — Building B001')).toBeVisible()
  await page.fill('input[placeholder="Your full name"]', 'Jane Client')
  await page.check('input[type="checkbox"]')
  await page.click('button:has-text("Approve")')
  await expect(page.getByText('Thank you — your decision has been recorded.')).toBeVisible()

  await clientSideNavigate(page, '/b/b001/bom')
  await page.waitForSelector('text=Suggested BOM')
  await setRole(page, 'PM')
  const selects = page.locator('select')
  const count = await selects.count()
  for (let i = 0; i < count; i++) await selects.nth(i).selectOption('Delivered')
  await page.click('button:has-text("Approve procurement BOM")')
}

// Drives every real device (install -> uplink -> test -> accept) straight
// through the API, bypassing the canvas — Step 8's own e2e suite already
// proves the UI path works; this test is about Handover's own logic, with
// realistic end-state data behind it.
async function finishDeploymentForAllDevices(page) {
  await page.evaluate(async () => {
    const depMod = window.__rackiumTestApi.deploymentDesign
    const netMod = window.__rackiumTestApi.networkStore
    const ctx = await depMod.getDeploymentContext('b001')
    for (const device of ctx.devices) {
      if (device.role === 'wan-circuit') continue
      await depMod.confirmInstallation('b001', device.id, { confirmedRu: device.ru, pduOutlet: 'PDU-A-01' })
      const connections = netMod.getConnections().filter((c) => c.source.deviceId === device.id || c.dest.deviceId === device.id)
      for (const conn of connections) {
        await depMod.confirmUplinking(
          'b001',
          conn.id,
          { media: conn.media, sourceSfp: conn.sourceSfp, destSfp: conn.destSfp, sourcePort: conn.source.port, destPort: conn.dest.port, cableId: conn.cableId ?? `CBL-${conn.id}` },
          device.id
        )
        await depMod.recordLinkTest('b001', conn.id, 'pass')
      }
      await depMod.setDeviceStatus('b001', device.id, 'accepted')
    }
  })
}

test.describe('Handover', () => {
  // Serial — see e2e/deployment.spec.js's identical comment. Handover's own
  // full-workflow test is the single heaviest test in the whole suite.
  test.describe.configure({ mode: 'serial' })

  test('loads with no console errors; the pre-compilation checklist is calculated and starts red', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await page.goto('/b/b001/handover')
    await expect(page.getByRole('heading', { name: /Handover/ })).toBeVisible()
    await expect(page.getByText('Pre-compilation checklist')).toBeVisible()
    await expect(page.getByText('Awaiting client signature')).toBeVisible()
    await expect(page.getByText('Compile package')).toHaveCount(0) // not PM yet

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })

  test('full workflow: compile, mark reviewed, send to client, client accepts, baseline freezes, design phases go read-only (CMDB stays editable)', async ({ page }) => {
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

    await approveAndDeliverAll(page)
    await finishDeploymentForAllDevices(page)

    await clientSideNavigate(page, '/b/b001/handover')
    await page.waitForSelector('h1:has-text("Handover")')
    await setRole(page, 'PM')

    // Checklist is all green and the package can compile.
    await expect(page.getByText('All delivered')).toBeVisible()
    await expect(page.getByText('All tested')).toBeVisible()
    await expect(page.getByText('All accepted')).toBeVisible()
    await page.click('button:has-text("Compile package")')
    await expect(page.getByText('Compiled', { exact: true })).toBeVisible()

    await page.click('button:has-text("Mark reviewed")')
    await expect(page.getByText('Under review', { exact: true })).toBeVisible()

    await page.fill('input[placeholder="Leave blank to auto-generate"]', 'handoverpw')
    await page.click('button:has-text("Send to Client")')
    await expect(page.getByText('Delivered to client', { exact: true })).toBeVisible()

    const linkUrl = await page.locator('input[readonly]').first().inputValue()
    const token = linkUrl.split('/').pop()

    await clientSideNavigate(page, `/approve/${token}`)
    await page.waitForSelector('text=password required')
    await page.fill('input[type="password"]', 'handoverpw')
    await page.click('button:has-text("View Package")')
    await expect(page.getByText('Handover package — Building B001')).toBeVisible()
    await page.fill('input[placeholder="Your full name"]', 'Jane Client')
    await page.check('input[type="checkbox"]')
    await page.click('button:has-text("Accept")')
    await expect(page.getByText(/baseline is now frozen/)).toBeVisible()

    // Baseline frozen, phase badge reads Accepted, design phases lock.
    await clientSideNavigate(page, '/b/b001/handover')
    await page.waitForSelector('h1:has-text("Handover")')
    await expect(page.getByText('Handover Approved')).toBeVisible()
    await expect(page.getByText(/baseline v1\.0 frozen/)).toBeVisible()

    await clientSideNavigate(page, '/b/b001/bom')
    await page.waitForSelector('text=Suggested BOM')
    await expect(page.locator('select')).toHaveCount(0)

    await clientSideNavigate(page, '/b/b001/lld')
    await page.waitForSelector('text=LLD — Low-Level Design')
    await expect(page.getByText('Handover accepted').first()).toBeVisible()

    // CMDB stays editable per the brief's explicit post-handover carve-out
    // — the global banner says so, and CMDB itself shows no lock banner of
    // its own (unlike BOM/LLD above).
    await clientSideNavigate(page, '/b/b001/cmdb')
    await page.waitForSelector('h1:has-text("CMDB")')
    await expect(page.getByText('CMDB remains editable for operational changes')).toBeVisible()

    expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
  })
})
