import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { localDate } from '@rackium/shared/timeZone.js'
import { deployedProject } from './handoverSetup.js'
import { fixture, signUpAndSignIn } from './helpers.js'

// M7a-2, real mode: the top bar's global search (keyboard and mouse, on a
// phone too, nothing from another organisation), the DGUV compliance
// dashboard (drill-down, status filter, CSV), field help (the Org Admin's
// plain text and a photo; the ⓘ in the survey form, keyboard and touch), at
// every width with no overflow and no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
let owner
let s
let other
const errors = []
const today = localDate(new Date(), 'Europe/Berlin')
const monthsAgo = (n) => {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - n, Math.min(d, 28))).toISOString().slice(0, 10)
}
const home = () => `/orgs/${s.orgId}/projects/${s.projectId}`
const surveyTab = () => `${home()}/buildings/${s.b001}/survey/room?tab=location-details`
const MARKUP = '<img src=x onerror="window.__xss=1"> e.g. ERL-B001'
let edge
let mains

async function fitsEveryWidth(page, label, check = async () => {}) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    await check(width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M7A_SHOTS) await page.screenshot({ path: `${process.env.M7A_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
async function typeSearch(page, text) {
  // On a phone the desktop box is in the page but hidden: the visible one.
  const box = page.locator('input[role="combobox"]:visible')
  await box.fill('')
  await box.fill(text)
  await expect(page.locator('[data-testid="search-results"]:visible')).toBeVisible()
  await expect(page.locator('[data-testid="search-results"]:visible')).not.toContainText('Searching…')
  return box
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, other, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed and accepted; two DGUV inspections re-recorded (overdue, expiring soon); another organisation', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm7a2' })
  // Console errors and uncaught exceptions alike.
  for (const [who, page] of [['owner', owner], ['fe', s.fe], ['reviewer', s.reviewer]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|404)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  edge = s.deployment.devices.find((d) => d.role === 'edge')
  mains = s.deployment.devices.filter((d) => d.mainsPowered)
  expect(mains.length).toBeGreaterThanOrEqual(2)
  await s.send(s.fe, 'put', `/deployment/devices/${mains[0].id}/dguv`, { inspectionDate: monthsAgo(50), inspector: 'Elektro Meyer' }, 200)
  await s.send(s.fe, 'put', `/deployment/devices/${mains[1].id}/dguv`, { inspectionDate: monthsAgo(46), inspector: 'Elektro Meyer' }, 200)
  other = await browser.newPage()
  await signUpAndSignIn(other, { email: `m7a2-other-${RUN_ID}@example.com`, organisationName: 'M7a2 Other Org' })
})

test('search from the top bar: a hostname opens the LLD, the keyboard opens a building, a serial opens the CMDB, a cable opens its connection', async () => {
  await owner.goto(home())
  // Mouse: the Edge by hostname → its LLD.
  await typeSearch(owner, edge.hostname)
  await owner.getByRole('option', { name: new RegExp(edge.hostname) }).first().click()
  await expect(owner).toHaveURL(new RegExp(`/buildings/${s.b001}/lld$`))
  // Keyboard: ↓ ↑ and Enter on the first result.
  const box = await typeSearch(owner, 'B001')
  await expect(owner.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await box.press('ArrowDown')
  await box.press('ArrowUp')
  await box.press('Enter')
  await expect(owner).toHaveURL(new RegExp(`/buildings/${s.b001}$`))
  // The as-built serial → the CMDB.
  const serial = s.deployment.devices.find((d) => d.installation?.serial)?.installation.serial ?? `SN-edge-${RUN_ID}`
  await typeSearch(owner, serial)
  await owner.getByTestId('search-results').getByRole('option').first().click()
  await expect(owner).toHaveURL(new RegExp(`/buildings/${s.b001}/cmdb$`))
  // A cable ID → the connection's own screen.
  const cable = s.deployment.connections.find((c) => c.segments?.[0]?.cableId)?.segments[0].cableId
  await typeSearch(owner, cable)
  await owner.getByTestId('search-results').locator('[data-result="cable"]').first().click()
  await expect(owner).toHaveURL(new RegExp(`/buildings/${s.b001}/(cmdb|deployment)`))
  // Escape closes; nothing found says so.
  const none = await typeSearch(owner, 'zz-nothing-zz')
  await expect(owner.getByTestId('search-results')).toContainText('Nothing found for “zz-nothing-zz”')
  await none.press('Escape')
  await expect(owner.getByTestId('search-results')).toHaveCount(0)
  // Another organisation finds none of it.
  for (const q of [edge.hostname, serial, cable, 'B001']) {
    await typeSearch(other, q)
    await expect(other.getByTestId('search-results')).toContainText('Nothing found')
  }
})

test('DGUV compliance: the rollup drills down to the rack, a status filters the devices, the CSV has them', async () => {
  await owner.goto(home())
  await owner.getByRole('link', { name: 'DGUV compliance' }).click()
  await expect(owner.getByRole('heading', { name: 'DGUV V3 compliance' })).toBeVisible()
  const node = owner.getByTestId('dguv-node')
  await expect(node).toContainText(`${mains.length} device(s)`)
  await expect(node.getByText('Overdue', { exact: true })).toBeVisible()
  // Down: country → SAL → building → floor → room → rack.
  const LABEL = { country: 'Country', sal: 'SAL', building: 'Building', floor: 'Floor', room: 'Room', rack: 'Rack' }
  for (const level of ['country', 'sal', 'building', 'floor', 'room', 'rack']) {
    await owner.getByTestId('dguv-rows').getByRole('button').first().click()
    await expect(owner).toHaveURL(new RegExp(`level=${level}`))
    // The level's own data, before the next click.
    await expect(owner.getByTestId('dguv-node').getByRole('heading')).toContainText(`${LABEL[level]}:`)
  }
  await expect(owner.getByRole('navigation', { name: 'Location' })).toContainText('B001')
  // Back to the project; only the overdue device.
  await owner.getByRole('navigation', { name: 'Location' }).getByRole('button').first().click()
  await owner.getByLabel('Show status').selectOption('overdue')
  const rows = owner.getByTestId('dguv-devices').locator('tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(mains[0].hostname ?? mains[0].label)
  // The CSV of what is shown.
  const download = owner.waitForEvent('download')
  await owner.getByRole('link', { name: 'CSV' }).click()
  const file = await download
  const text = fs.readFileSync(await file.path(), 'utf8').trim().split('\r\n')
  expect(text[0]).toBe('Building,Floor,Room,Rack,Device,Status,Last inspection,Due date,Days remaining,Inspector')
  expect(text).toHaveLength(2)
  expect(text[1]).toContain('Overdue')
  // From the building dashboard too.
  await owner.goto(`${home()}/buildings/${s.b001}`)
  await owner.getByRole('link', { name: 'Compliance details' }).click()
  await expect(owner).toHaveURL(/level=building/)
  await expect(owner.getByTestId('dguv-node')).toContainText('Building: B001')
})

test('field help: the Org Admin writes plain text and adds a photo; the ⓘ shows it as text, a placeholder is marked; keyboard and touch', async ({ browser }) => {
  await owner.goto(`/orgs/${s.orgId}/settings`)
  const admin = owner.getByTestId('field-help-admin')
  await admin.getByLabel('Find a field').fill('Location ID')
  const row = admin.locator('[data-field="survey:location-details:location_id"]')
  await expect(row).toContainText('No help yet')
  await row.getByRole('button', { name: 'Edit' }).click()
  await row.getByLabel('Location ID: What this field means').fill('The Technonex site ID of the building.')
  await row.getByLabel('Location ID: Example value').fill(MARKUP)
  await row.getByRole('button', { name: 'Save help' }).click()
  await expect(row.getByRole('status')).toHaveText('Saved')
  await row.getByLabel('Photo caption').fill('ID plate at the entrance')
  await row.getByLabel('Add reference photo').setInputFiles(fixture('photo.jpg'))
  await expect(row.getByRole('status')).toHaveText('Photo added')
  await expect(row.getByRole('img', { name: 'ID plate at the entrance' })).toBeVisible()
  await expect(row).toContainText('Organisation text')

  // The Field Engineer in the survey form: the text exactly as typed, never markup.
  await s.fe.goto(surveyTab())
  const info = s.fe.getByRole('button', { name: 'Help: Location ID' })
  await info.click()
  const help = s.fe.getByRole('dialog', { name: 'Help: Location ID' })
  await expect(help).toContainText('The Technonex site ID of the building.')
  await expect(help).toContainText(MARKUP)
  await expect(help.locator('img[src="x"]')).toHaveCount(0)
  expect(await s.fe.evaluate(() => window.__xss)).toBeUndefined()
  const photo = help.getByRole('img', { name: 'ID plate at the entrance' })
  await expect(photo).toBeVisible()
  expect(await photo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(help).not.toContainText('Placeholder text')
  // Keyboard: Esc closes and gives the focus back; Enter opens again.
  await s.fe.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
  await expect(info).toBeFocused()
  await s.fe.keyboard.press('Enter')
  await expect(help).toBeVisible()
  await help.getByRole('button', { name: 'Close help' }).click()
  // A field with only the template hint: marked as a placeholder.
  await s.fe.getByRole('button', { name: /^Help: Building SAL code\/Name/ }).click()
  await expect(s.fe.getByRole('dialog', { name: /^Help: Building SAL code\/Name/ })).toContainText('Placeholder text')

  // Touch, on a phone.
  const context = await browser.newContext({ storageState: await s.fe.context().storageState(), hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  const phone = await context.newPage()
  phone.on('console', (m) => m.type() === 'error' && !/status of (401|404)/.test(m.text()) && errors.push(`phone: ${m.text()}`))
  phone.on('pageerror', (err) => errors.push(`phone: ${err.message}`))
  await phone.goto(surveyTab())
  await phone.getByRole('button', { name: 'Help: Location ID' }).tap()
  await expect(phone.getByRole('dialog', { name: 'Help: Location ID' })).toContainText(MARKUP)
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
  await context.close()
})

test('search, DGUV, field help and the survey ⓘ at 1440/1024/768/390: no overflow, no console errors', async () => {
  await owner.goto(home())
  await fitsEveryWidth(owner, 'search', async (width) => {
    if (width < 640) {
      await owner.getByRole('button', { name: 'Search' }).click()
      await expect(owner.getByTestId('phone-search')).toBeVisible()
      await typeSearch(owner, 'B001')
      await expect(owner.getByRole('option').first()).toBeVisible()
      await owner.getByRole('button', { name: 'Close search' }).click()
    } else {
      await typeSearch(owner, 'B00')
      await expect(owner.getByRole('option').first()).toBeVisible()
      await owner.keyboard.press('Escape')
    }
  })
  await owner.goto(`${home()}/dguv`)
  await fitsEveryWidth(owner, 'dguv', async () => expect(owner.getByTestId('dguv-node')).toBeVisible())
  await owner.goto(`/orgs/${s.orgId}/settings`)
  await owner.getByTestId('field-help-admin').getByLabel('Find a field').fill('Location ID')
  await owner.getByTestId('field-help-admin').getByRole('button', { name: 'Edit' }).first().click()
  await fitsEveryWidth(owner, 'field-help-admin', async () => expect(owner.getByTestId('field-help-editor')).toBeVisible())
  await s.fe.goto(surveyTab())
  await fitsEveryWidth(s.fe, 'survey-field-help', async (width) => {
    const button = s.fe.getByRole('button', { name: 'Help: Location ID' })
    if ((await s.fe.getByRole('dialog', { name: 'Help: Location ID' }).count()) === 0) await button.click()
    const dialog = s.fe.getByRole('dialog', { name: 'Help: Location ID' })
    await expect(dialog).toBeVisible()
    // Kept with its button when the window is resized.
    const [b, p] = [await button.boundingBox(), await dialog.boundingBox()]
    expect(Math.abs(p.y - (b.y + b.height + 4)) < 2 || Math.abs(p.y + p.height - (b.y - 4)) < 2, `help next to its button at ${width}px`).toBe(true)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x + p.width).toBeLessThanOrEqual(width)
  })
  expect(errors).toEqual([])
})
