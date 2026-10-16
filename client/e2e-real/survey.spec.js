import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M3b, real mode: the Physical Site Survey on the backend. The Field
// Engineer builds the site structure and surveys a rack; the Storage Area
// tab goes through the whole workflow in the browser (fill + photo, submit,
// Architect rejects with a reason, resubmit, verify); the remaining tabs are
// filled and verified through the same API with each role's session, and
// the survey phase shows Approved. Then an offline edit and photo are made
// with the network really cut, and sync on reconnect.

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const RUN_ID = Date.now()
let owner
let fe
let architect
let orgId
let projectId
let b001Id
let b002Id
let roomId
const errors = []
// A survey field's label also carries its requirement badge ("Must").
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const field = (page, label) => page.getByLabel(new RegExp(`^${escapeRegExp(label)}`))

const surveyUrl = (rest = '') => `/orgs/${orgId}/projects/${projectId}/buildings/${b001Id}/survey${rest}`
let networkCut = false
const watch = (page, who) =>
  page.on('console', (m) => {
    // Failed requests are expected only while the network is deliberately cut.
    if (m.type() === 'error' && !(networkCut && /ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/.test(m.text()))) errors.push(`${who}: ${m.text()}`)
  })

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, fe, architect]) await p?.context().close()
})

test('set up: a project with two buildings, a Field Engineer and an Architect', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `survey-${RUN_ID}@example.com`, organisationName: 'Survey Org' })
  watch(owner, 'owner') // after sign-in: the signed-out session check is an expected 401
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'Survey Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  const cmo = await (await owner.request.get(`/api/v1/orgs/${orgId}/projects/${projectId}/cmo`)).json()
  b001Id = cmo.buildings.find((b) => b.code === 'B001').id
  b002Id = cmo.buildings.find((b) => b.code === 'B002').id
  fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `arch-${RUN_ID}@example.com`, role: 'architect', name: 'Arno Architect' })
  watch(fe, 'fe')
  watch(architect, 'architect')
})

test('Field Engineer builds the structure: floor, two rooms, a rack, room facts and a pathway', async () => {
  await fe.goto(surveyUrl())
  await expect(fe.getByRole('heading', { name: /Building & Room Structure/ })).toBeVisible()
  await expect(fe.getByText('No floors yet')).toBeVisible()
  await fe.getByLabel('Floor code').fill('EG')
  await fe.getByLabel('Floor name').fill('Ground floor')
  await fe.getByRole('button', { name: 'Add floor' }).click()
  await fe.getByRole('button', { name: 'Add room' }).click()
  await expect(fe.getByText('TR-EG-01')).toBeVisible()
  await fe.getByRole('button', { name: 'Add room' }).click()
  await expect(fe.getByText('TR-EG-02')).toBeVisible()
  await fe.getByTitle('Add rack').first().click()
  await expect(fe.getByTitle('Rack R01 — open Rack Survey')).toBeVisible()

  // Room facts.
  await fe.getByText('TR-EG-01', { exact: true }).first().click()
  await fe.getByLabel('Access').selectOption('verified')
  await fe.getByLabel('Power').selectOption('available')
  await expect(fe.getByLabel('Access')).toHaveValue('verified')

  // A surveyed pathway between the two rooms.
  await fe.getByRole('button', { name: 'Building connection', exact: true }).click()
  await fe.getByText('TR-EG-01', { exact: true }).first().click()
  await fe.getByText('TR-EG-02', { exact: true }).first().click()
  await expect(fe.getByLabel('Route status')).toBeVisible()
  await fe.getByLabel('Route status').selectOption('surveyed')
  const saved = fe.waitForResponse((r) => r.url().includes('/survey/pathways/') && r.request().method() === 'PATCH' && r.request().postData()?.includes('42'))
  await fe.locator('input[type="number"]').fill('42')
  await saved
  await expect(fe.getByRole('button', { name: /TR-EG-01 → TR-EG-02.*Surveyed · 42 m/ })).toBeVisible()
  await fe.reload()
  await expect(fe.getByRole('button', { name: /TR-EG-01 → TR-EG-02.*Surveyed · 42 m/ })).toBeVisible()

  // Regression: a distance typed just before leaving the page (inside the
  // save pause) was lost. Leaving now saves it.
  await fe.getByRole('button', { name: /TR-EG-01 → TR-EG-02/ }).click()
  await fe.locator('input[type="number"]').fill('57')
  await fe.getByTitle('Rack R01 — open Rack Survey').click()
  await expect(fe.getByRole('heading', { name: /Rack Layout & Installation Readiness/ })).toBeVisible()
  await fe.goBack()
  await expect(fe.getByRole('button', { name: /TR-EG-01 → TR-EG-02.*Surveyed · 57 m/ })).toBeVisible()
})

test('Field Engineer surveys the rack: a device placed by RU, saved and read back with its readiness', async () => {
  await fe.getByTitle('Rack R01 — open Rack Survey').click()
  await expect(fe.getByRole('heading', { name: /Rack Layout & Installation Readiness/ })).toBeVisible()
  roomId = null
  const libraryItem = fe.locator('div', { hasText: '24-port switch' }).last()
  const frontPanel = fe.locator('text=FRONT').locator('..')
  const targetRow = frontPanel.locator('span', { hasText: /^20$/ }).first()
  await expect(libraryItem).toBeVisible()
  await expect(targetRow).toBeVisible()
  const src = await libraryItem.boundingBox()
  const dst = await targetRow.boundingBox()
  await fe.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await fe.mouse.down()
  await fe.mouse.move(dst.x + 40, dst.y + 10, { steps: 10 })
  await fe.waitForTimeout(100)
  await fe.mouse.up()
  await expect(fe.getByText('24-port switch · 1U')).toBeVisible()
  await expect(fe.getByText(/^Saved/)).toBeVisible({ timeout: 10_000 })

  // An entered serial; then facts that make the depth check pass.
  await fe.getByPlaceholder('e.g. FCW2637A1B2').fill('E2E-SERIAL-1')
  await expect(fe.getByText(/^Saved/)).toBeVisible({ timeout: 10_000 })
  await fe.getByLabel('Usable depth (mm)').fill('800')
  await fe.getByLabel('Usable depth (mm)').blur()
  await fe.getByRole('button', { name: 'Save Version' }).click()
  await expect(fe.getByText('Version 1')).toBeVisible()

  await fe.reload()
  await expect(fe.getByText('24-port switch · 1U')).toBeVisible()
  await expect(fe.getByLabel('Usable depth (mm)')).toHaveValue('800')
})

test('Rack Survey: an existing label recorded on site is shown instead of the library name; a CMO device without a serial is picked from the CMO list (fix/cmo-naming-gaps)', async () => {
  // The PM imports the customer's list: a patch panel with no serial.
  const imported = await owner.request.post(`/api/v1/orgs/${orgId}/projects/${projectId}/cmo/import`, {
    data: { rows: [{ rowIndex: 0, hostname: 'VT-A-01', vendor: 'Panduit', model: 'Patch panel 24', serial: null, mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }] },
  })
  expect(imported.status()).toBe(201)
  await fe.reload()
  await expect(fe.getByText('24-port switch · 1U')).toBeVisible()

  // The switch placed above: the label on it, as the customer uses it (free text).
  await fe.getByText('24-port switch · 1U').click()
  await fe.getByLabel('Existing label / name').fill('Schrank 3 / Feld A')
  await expect(fe.getByText('Schrank 3 / Feld A · 1U')).toBeVisible()
  await expect(fe.getByText(/^Saved/)).toBeVisible({ timeout: 10_000 })

  // A library patch panel, then identified from the CMO list — it has no serial.
  // (Typing scrolled the page: back to the top, so the library and the RU are both on screen.)
  await fe.evaluate(() => document.querySelector('main').scrollTo(0, 0))
  const libraryItem = fe.locator('div', { hasText: '24-port patch panel' }).last()
  const targetRow = fe.locator('text=FRONT').locator('..').locator('span', { hasText: /^30$/ }).first()
  const src = await libraryItem.boundingBox()
  const dst = await targetRow.boundingBox()
  await fe.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await fe.mouse.down()
  await fe.mouse.move(dst.x + 40, dst.y + 10, { steps: 10 })
  await fe.waitForTimeout(100)
  await fe.mouse.up()
  await expect(fe.getByText('24-port patch panel · 1U')).toBeVisible()
  await fe.getByLabel('Pick a CMO device').selectOption({ label: 'VT-A-01 · Panduit Patch panel 24 · No serial' })
  await expect(fe.getByLabel('Existing label / name')).toHaveValue('VT-A-01')
  await expect(fe.getByText('No serial — picked from the CMO list, not serial-validated.')).toBeVisible()
  await expect(fe.getByText('VT-A-01 · Patch panel 24')).toBeVisible()
  await expect(fe.getByText(/^Saved/)).toBeVisible({ timeout: 10_000 })

  // The identity panels fit every width.
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await fe.setViewportSize({ width, height })
    await expect(fe.getByLabel('Existing label / name')).toBeVisible()
    const overflow = await fe.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth + (document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth))
    expect(overflow, `rack survey at ${width}px`).toBe(0)
    if (process.env.SURVEY_SHOTS) {
      await fe.getByLabel('Existing label / name').scrollIntoViewIfNeeded()
      await fe.screenshot({ path: `${process.env.SURVEY_SHOTS}/rack-identity-${width}.png` })
    }
  }
  await fe.setViewportSize({ width: 1440, height: 900 })

  await fe.reload()
  await expect(fe.getByText('Schrank 3 / Feld A · 1U')).toBeVisible()
  await expect(fe.getByText('VT-A-01 · Patch panel 24')).toBeVisible()
})

test('Storage Area: filled with a photo, submitted, rejected with a reason, resubmitted and verified', async () => {
  await fe.goto(surveyUrl('/room?tab=storage-area'))
  await expect(fe.getByRole('tab', { name: /Storage Area/, selected: true })).toBeVisible()
  await expect(fe.getByRole('button', { name: 'Submit for verification' })).toBeDisabled()
  const texts = ['Staging Area Location', 'New Devices Receiving / Storage Location', 'Tools / Trolleys availability for Device Movement', 'Staging Space', 'Staging Power Sockets Type', 'Staging Network Connection (Count & Type)', 'Packaging Waste Disposable Location']
  for (const label of texts) await field(fe, label).fill('Basement B1')
  await field(fe, 'Staging Area Power Sockets Count').fill('4')
  await fe.getByLabel('Add photo: Staging area photos').setInputFiles(fixture('photo.jpg'))
  await expect(fe.getByAltText('Staging area photos photo')).toBeVisible()
  await expect(fe.getByText('100% complete')).toBeVisible({ timeout: 10_000 })
  await fe.getByRole('button', { name: 'Submit for verification' }).click()
  await expect(fe.getByTestId('tab-status')).toHaveText('Submitted')

  await architect.goto(surveyUrl('/room?tab=storage-area'))
  await architect.getByRole('button', { name: 'Reject' }).click()
  await architect.getByPlaceholder('Reason for rejection').fill('Photo shows the wrong room')
  await architect.getByRole('button', { name: 'Confirm reject' }).click()
  await expect(architect.getByTestId('tab-status')).toHaveText('Rejected')

  await fe.reload()
  await expect(fe.getByText('— Photo shows the wrong room')).toBeVisible()
  await field(fe, 'Staging Space').fill('Basement B2')
  await expect(fe.getByTestId('tab-status')).toHaveText('Draft', { timeout: 10_000 })
  await fe.getByRole('button', { name: 'Submit for verification' }).click()
  await expect(fe.getByTestId('tab-status')).toHaveText('Submitted')

  await architect.reload()
  await architect.getByRole('button', { name: 'Verify' }).click()
  await expect(architect.getByTestId('tab-status')).toHaveText('Verified')
  await expect(architect.getByTestId('verified-count')).toHaveText('1/30 tabs Verified') // 6 building tabs + 12 per room × 2
})

test('every other tab verified: the survey phase is Approved on Room Details, the dashboard and the sidebar', async () => {
  const structure = await (await fe.request.get(`/api/v1/orgs/${orgId}/projects/${projectId}/survey/buildings/${b001Id}/structure`)).json()
  const roomIds = structure.buildings[0].floors[0].rooms.map((r) => r.id)
  roomId = roomIds[0]
  const targets = [...BUILDING_TABS.filter((t) => t !== 'Storage Area').map((tab) => ({ tab, roomId: null })), ...roomIds.flatMap((id) => ROOM_TABS.map((tab) => ({ tab, roomId: id })))]
  for (const t of targets) {
    const target = { orgId, projectId, buildingId: b001Id, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }

  await architect.reload()
  await expect(architect.getByTestId('verified-count')).toHaveText('30/30 tabs Verified')
  await expect(architect.getByText('Survey phase')).toBeVisible()
  await expect(architect.getByRole('button', { name: 'Import into HLD' })).toBeEnabled()

  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001Id}`)
  await expect(owner.getByRole('link', { name: /Physical Site Survey.*Approved/ })).toBeVisible()
  await expect(owner.getByRole('navigation', { name: 'Phases' }).getByRole('link', { name: /Survey/ })).toBeVisible()
})

test('offline: an edit and a photo made with the network cut sync on reconnect', async () => {
  const b002Url = `/orgs/${orgId}/projects/${projectId}/buildings/${b002Id}/survey/room?tab=storage-area`
  await fe.goto(b002Url)
  await expect(fe.getByRole('tab', { name: /Storage Area/, selected: true })).toBeVisible()
  await expect(field(fe, 'Staging Space')).toBeEditable()

  networkCut = true
  await fe.context().setOffline(true)
  await field(fe, 'Staging Space').fill('Written offline')
  await fe.getByLabel('Add photo: Staging area photos').setInputFiles(fixture('photo.jpg'))
  await expect(fe.getByAltText('Staging area photos photo')).toBeVisible()
  await expect(fe.getByText(/Offline — survey tabs already open keep working; 3 changes waiting to sync/)).toBeVisible({ timeout: 10_000 })

  await fe.context().setOffline(false)
  networkCut = false
  const report = fe.getByTestId('sync-report')
  await expect(report).toBeVisible({ timeout: 20_000 })
  await expect(report.getByText(/synced/)).toHaveCount(2)
  await expect(fe.getByText(/waiting to sync/)).toHaveCount(0)

  // On the server: the value and the uploaded photo (thumbnail through the API).
  await fe.reload()
  await expect(field(fe, 'Staging Space')).toHaveValue('Written offline')
  const thumb = fe.getByAltText('Staging area photos photo')
  await expect(thumb).toBeVisible()
  await expect(thumb).toHaveAttribute('src', /\/files\/[a-f0-9]{24}\/thumbnail$/)
  await expect.poll(() => thumb.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
})

test('no console errors on the survey screens', async () => {
  expect(errors, errors.join('\n')).toEqual([])
})
