import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M4a, real mode: HLD on the backend. A verified survey (two comms rooms with
// racks and a surveyed pathway), then in the browser: Generate HLD → edit an
// uplink (the wrong optic is blocked by the wizard's validation, then fixed)
// → a Critical finding blocks Submit → fixed → submit → the PM approves.

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const RUN_ID = Date.now()
let owner
let architect
let orgId
let projectId
let b001
const errors = []
const hldUrl = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}/hld`

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect]) await p?.context().close()
})

test('set up: a project whose B001 survey is verified', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `hld-${RUN_ID}@example.com`, organisationName: 'HLD Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'HLD Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  const api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `hld-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Field Engineer' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `hld-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  architect.on('console', (m) => m.type() === 'error' && !/status of 409/.test(m.text()) && errors.push(`architect: ${m.text()}`))
  owner.on('console', (m) => m.type() === 'error' && errors.push(`owner: ${m.text()}`))

  const post = async (page, path, data) => {
    const res = await page.request.post(`${api}${path}`, { data })
    expect(res.status(), await res.text()).toBe(201)
    return res.json()
  }
  const { floor } = await post(fe, '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 })
  const { room: main } = await post(fe, '/survey/rooms', { floorId: floor.id })
  const { room: second } = await post(fe, '/survey/rooms', { floorId: floor.id })
  const racks = [(await post(fe, '/survey/racks', { roomId: main.id })).rack, (await post(fe, '/survey/racks', { roomId: second.id })).rack]
  // Each rack has a PDU (the HLD suggests racks for its devices; VAL-003 needs power there).
  for (const rack of racks) {
    const res = await fe.request.patch(`${api}/survey/racks/${rack.id}/placements`, { data: { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] } })
    expect(res.status(), await res.text()).toBe(200)
  }
  await post(architect, '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 })
  const targets = [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]
  for (const t of targets) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()
})

test('the Architect generates the HLD from the verified survey', async () => {
  await architect.goto(hldUrl())
  await expect(architect.getByRole('heading', { name: /NexAI-Suggested HLD — Building B001/ })).toBeVisible()
  await architect.getByLabel('Blueprint preset').selectOption('M')
  await expect(architect.getByLabel('Blueprint variant')).toHaveValue('single_path')
  await architect.getByRole('button', { name: 'Generate HLD' }).click()
  for (const host of ['F-DE-ERL-C01-B001-EG-001', 'B-DE-ERL-C01-B001-EG-001', 'E-DE-ERL-C01-B001-EG-001', 'A-DE-ERL-C01-B001-EG-001']) {
    await expect(architect.getByText(host, { exact: true }).first()).toBeVisible()
  }
  await expect(architect.getByText('No blocked links')).toBeVisible()
  // The newly wired library items are there, with their hostname codes.
  await expect(architect.getByText('Firewall (FW)')).toBeVisible()
  await expect(architect.getByText('WAN/SP connection')).toBeVisible()
})

test('editing an uplink: an optic on a copper port is blocked by validation; the fix is saved; Undo and Redo', async () => {
  const view = await (await architect.request.get(`/api/v1/orgs/${orgId}/projects/${projectId}/hld/buildings/${b001}`)).json()
  const border = view.devices.find((d) => d.role === 'border')
  const edge = view.devices.find((d) => d.role === 'edge')
  const uplink = view.connections.find((c) => c.source.deviceId === border.id && c.dest.deviceId === edge.id)
  await architect.getByTestId(`rf__edge-${uplink.id}`).click({ force: true })
  await expect(architect.getByText('Edit Uplink')).toBeVisible()

  // An optic on the Edge's RJ45 access port: the wizard's check blocks it (VAL-002).
  await architect.getByRole('button', { name: 'Next' }).click() // ports (optional in HLD)
  await architect.getByLabel(/^Destination port/).fill('Gi1/0/1')
  await architect.getByRole('button', { name: 'Next' }).click() // medium & SFP: OS2 with LR optics
  await architect.getByRole('button', { name: 'Next' }).click()
  await architect.getByRole('button', { name: 'Run NexAI validation' }).click()
  await expect(architect.getByText('BLOCKED — resolve the failing checks above')).toBeVisible()
  await expect(architect.getByText(/VAL-002/)).toBeVisible()
  await expect(architect.getByRole('button', { name: 'Save uplink' })).toBeDisabled()

  // Fix it: the SFP+ uplink module port.
  await architect.getByRole('button', { name: 'Back' }).click()
  await architect.getByRole('button', { name: 'Back' }).click()
  await architect.getByLabel(/^Destination port/).fill('Te1/1/1')
  await architect.getByRole('button', { name: 'Next' }).click()
  await architect.getByRole('button', { name: 'Next' }).click()
  await architect.getByRole('button', { name: 'Run NexAI validation' }).click()
  await expect(architect.getByText('VALID CONNECTION')).toBeVisible()
  await expect(architect.getByText('Estimated length: 44 m')).toBeVisible()
  await architect.getByRole('button', { name: 'Save uplink' }).click()
  await expect(architect.getByText('Edit Uplink')).toHaveCount(0)

  const destPort = async () => (await (await architect.request.get(`/api/v1/orgs/${orgId}/projects/${projectId}/hld/buildings/${b001}`)).json()).connections.find((c) => c.id === uplink.id).dest.portId
  await expect.poll(destPort).toBe('Te1/1/1')
  await architect.getByTitle('Undo').click()
  await expect.poll(destPort).toBeNull()
  await architect.getByTitle('Redo').click()
  await expect.poll(destPort).toBe('Te1/1/1')
})

test('a Critical finding blocks Submit until it is fixed; then submit', async () => {
  await architect.getByText('B-DE-ERL-C01-B001-EG-001', { exact: true }).first().click()
  await expect(architect.getByTestId('hld-device')).toBeVisible()
  await architect.getByLabel('PSUs configured').selectOption('1')
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
  await expect(architect.getByText('1 Critical finding(s) must be fixed before submitting')).toBeVisible()
  await architect.getByTitle('Validate').click()
  const panel = architect.getByTestId('hld-validation')
  await expect(panel.getByText('VAL-005')).toBeVisible()
  await panel.getByText('VAL-005').click()
  await architect.getByLabel('PSUs configured').selectOption('2')
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
  await architect.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(architect.getByText('Awaiting approval').first()).toBeVisible()
  // Locked while awaiting a decision: no toolbar, no Approve for the Architect.
  await expect(architect.getByTitle('Create Uplink')).toBeDisabled()
  await expect(architect.getByRole('button', { name: 'Approve' })).toHaveCount(0)
})

test('the HLD and naming settings fit every width', async () => {
  for (const [page, url] of [[architect, hldUrl()], [owner, `/orgs/${orgId}/settings`]]) {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height })
      await page.goto(url)
      await expect(page.locator('main')).not.toContainText('Loading…')
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')
        return document.documentElement.scrollWidth - document.documentElement.clientWidth + (main.scrollWidth - main.clientWidth)
      })
      expect(overflow, `${url} at ${width}px`).toBe(0)
      if (process.env.HLD_SHOTS) await page.screenshot({ path: `${process.env.HLD_SHOTS}/${page === owner ? 'settings' : 'hld'}-${width}.png` })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
})

test('the PM approves; the HLD phase shows Approved', async () => {
  await owner.goto(hldUrl())
  await owner.getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText('Approved').first()).toBeVisible()
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}`)
  await expect(owner.getByRole('link', { name: /HLD.*Approved/ })).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
})
