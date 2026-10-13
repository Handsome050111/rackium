import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'
import { REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'

// M5a, real mode: an approved LLD (set up through the API) → the Draft BOM →
// Solution Package inputs → the PM sends it by share link → the client
// approves on the public page → the design freezes → procurement → a change
// request changes a cable → the client re-approves → the BOM is re-approved.
// M5a review: a second change request adds an Edge in the HLD and maps it in
// the LLD, with a per-cable length; both get new frozen versions. Cage nuts
// per RU are an organisation setting.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
let owner
let architect
let client
let orgId
let projectId
let b001
let api
const errors = []
const base = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}`
let link
let secondRoomId
let racks
const widths = [[1440, 900], [1024, 768], [768, 1024], [390, 844]]
async function fitsEveryWidth(page, label) {
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M5A_SHOTS) await page.screenshot({ path: `${process.env.M5A_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

async function send(page, method, path, data, status) {
  const res = await page.request[method](`${api}${path}`, data === undefined ? undefined : { data })
  expect(res.status(), await res.text()).toBe(status)
  return res.json()
}
const lld = async () => send(architect, 'get', `/lld/buildings/${b001}`, undefined, 200)
const byRole = (v, role) => v.devices.find((d) => d.inDesign && d.role === role)
const linkOf = (v, a, b) => {
  const ids = [byRole(v, a).id, byRole(v, b).id].sort().join()
  return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === ids)
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect, client]) await p?.context().close()
})

test('set up: an approved HLD and an approved LLD for B001', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m5a-${RUN_ID}@example.com`, organisationName: 'M5a Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M5a Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m5a-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Field Engineer' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m5a-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  // 409/400/401: deliberate refusals shown in the page.
  for (const [who, page] of [['architect', architect], ['owner', owner]]) page.on('console', (m) => m.type() === 'error' && !/status of (400|401|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))

  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const { room: main } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const { room: second } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  secondRoomId = second.id
  racks = [(await send(fe, 'post', '/survey/racks', { roomId: main.id }, 201)).rack, (await send(fe, 'post', '/survey/racks', { roomId: second.id }, 201)).rack]
  for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  // The main room's PDU has C13 sockets (brief §6.7: the PDU socket decides the cord).
  await send(fe, 'patch', `/survey/racks/${racks[0].id}/facts`, { mountingPower: { cageNutType: 'M6', pduA: { totalSockets: 24, freeSockets: 20, socketType: 'C13' } } }, 200)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  const targets = [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]
  for (const t of targets) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()

  const hld = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: hld.design.revision }, 201)
  await send(architect, 'post', '/hld/submit', { buildingId: b001, baseRevision: (await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)).design.revision }, 201)
  await send(owner, 'post', '/hld/decision', { buildingId: b001, decision: 'approved' }, 200)

  // The LLD: placements, a patch panel, ports and cable IDs, submitted and approved.
  await send(architect, 'post', '/lld/start', { buildingId: b001 }, 201)
  let v = await lld()
  const save = async (method, path, body, status = 200) => {
    v = await lld()
    const res = await send(architect, method, path, { ...body, baseRevision: v.design.revision }, status)
    return res
  }
  await save('put', `/lld/devices/${byRole(v, 'border').id}/placement`, { rackId: racks[0].id, ru: 40, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'fusion').id}/placement`, { rackId: racks[0].id, ru: 38, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'edge').id}/placement`, { rackId: racks[1].id, ru: 40, face: 'front' })
  const panel = (await save('post', '/lld/devices', { buildingId: b001, catalogueKey: 'Generic Cat6A Patch Panel 24-port', rackId: racks[1].id, ru: 42, face: 'front' }, 201)).device
  v = await lld()
  for (const [a, b, ports, cableId, hops] of [
    ['border', 'fusion', ['Te1/1/1', 'Te1/1/1'], 'C-BF-1'],
    ['border', 'edge', ['Te1/1/2', 'Te1/1/1'], 'C-BE-1'],
    ['edge', 'ap', ['Gi1/0/1', 'Eth0'], 'C-EA-1', [{ patchPanelId: panel.id, inPort: '01', outPort: '02' }]],
  ]) {
    v = await lld()
    const c = linkOf(v, a, b)
    const first = c.source.deviceId === byRole(v, a).id
    await save('patch', `/lld/connections/${c.id}`, { source: { deviceId: c.source.deviceId, portId: first ? ports[0] : ports[1] }, dest: { deviceId: c.dest.deviceId, portId: first ? ports[1] : ports[0] }, cableId, ...(hops ? { hops } : {}) })
  }
  await save('post', '/lld/submit', { buildingId: b001 }, 201)
  await send(owner, 'post', '/lld/decision', { buildingId: b001, decision: 'approved' }, 200)
})

test('the Draft BOM: lines with source tags, reconciliation, prices for the PM, procurement locked', async () => {
  await owner.goto(`${base()}/bom`)
  await expect(owner.getByRole('heading', { name: /Suggested BOM — Building B001/ })).toBeVisible()
  await expect(owner.getByText('Draft', { exact: true })).toBeVisible()
  await expect(owner.getByTestId('procurement-locked')).toContainText('procurement unlocks after the client approves')
  await expect(owner.getByText('C9300-48UX').first()).toBeVisible()
  await expect(owner.getByText('BOM reconciles with HLD/LLD: 4/4 devices')).toBeVisible()
  // The main room's PDU socket (C13) decides the Border's and Fusion's cords.
  await expect(owner.getByText('Power cord C13/C14')).toBeVisible()
  await expect(owner.getByTestId('pricing')).toContainText('Total incl. margin')
  // The Architect sees no prices (organisation setting off).
  await architect.goto(`${base()}/bom`)
  await expect(architect.getByText('C9300-48UX').first()).toBeVisible()
  await expect(architect.getByTestId('pricing')).toHaveCount(0)
  await expect(architect.locator('thead')).not.toContainText('Unit price')
})

test('Solution Package inputs: group 1 with CIDR/VLAN checks in the browser, the rest through the API; warnings accepted', async () => {
  await architect.goto(`${base()}/solution-package`)
  await expect(architect.getByRole('heading', { name: /Solution Package — Building B001/ })).toBeVisible()
  await expect(architect.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  await architect.getByRole('tab', { name: '2. Required Inputs' }).click()
  const form = architect.getByTestId('input-group')
  await form.getByRole('button', { name: 'Add entry' }).click()
  await expect(form.getByPlaceholder('10.10.20.0/23')).toHaveCount(1)
  await form.getByPlaceholder('e.g. Data VLAN').fill('Users')
  await form.getByPlaceholder('e.g. Data VLAN').blur()
  await form.getByPlaceholder('1-4094').fill('5000')
  await form.getByPlaceholder('1-4094').blur()
  await expect(form.getByText('VLAN ID must be between 1 and 4094')).toBeVisible()
  await form.getByPlaceholder('1-4094').fill('10')
  await form.getByPlaceholder('1-4094').blur()
  await form.getByPlaceholder('10.10.20.0/23').fill('10.10.0.0/24')
  await form.getByPlaceholder('10.10.20.0/23').blur()
  await expect(form.getByText('All entries pass format, uniqueness and overlap checks.')).toBeVisible()
  await expect(architect.locator('tbody tr').filter({ hasText: 'Network addressing and segmentation' })).toContainText('Completed')
  // Groups 2–12 through the API (the same calls the form makes).
  for (const g of REQUIRED_INPUT_GROUPS.filter((x) => x.key !== 'addressing')) {
    const sp = await send(architect, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
    await send(architect, 'put', `/solution-package/groups/${g.key}`, { buildingId: b001, kvPairs: [{ id: 'k1', key: 'Owner', value: 'Client IT' }], baseRevision: sp.revision }, 200)
  }
  // The PM accepts the remaining warnings on page 3.
  await owner.goto(`${base()}/solution-package`)
  await owner.getByRole('tab', { name: '3. Validation & Approval' }).click()
  await expect(owner.getByTestId('readiness-blockers')).toContainText('warning area(s) not accepted')
  while ((await owner.getByRole('button', { name: 'Accept', exact: true }).count()) > 0) {
    const before = await owner.getByRole('button', { name: 'Accept', exact: true }).count()
    await owner.getByRole('button', { name: 'Accept', exact: true }).first().click()
    await expect(owner.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(before - 1)
  }
  await expect(owner.getByText('Owner (PM)').first()).toBeVisible()
  await expect(owner.getByTestId('readiness-blockers')).toHaveCount(0)
})

test('the PM sends the package: link and password shown once', async () => {
  const panel = owner.getByTestId('share-links')
  await panel.getByPlaceholder('Leave blank to auto-generate').fill('Client-Pass-2026')
  await panel.getByRole('button', { name: 'Submit for Client Approval' }).click()
  await expect(panel.getByText('Copy the link and password now — they are shown only once.')).toBeVisible()
  const values = await panel.locator('input[readonly]').evaluateAll((els) => els.map((e) => e.value))
  link = { url: new URL(values[0]).pathname, password: values[1] }
  expect(link.url).toMatch(/^\/approve\/[A-Za-z0-9_-]{43}$/)
  expect(link.password).toBe('Client-Pass-2026')
  await expect(owner.getByText('Awaiting approval').first()).toBeVisible()
  await expect(owner.getByTestId('share-link-row')).toContainText('active')
})

test('the client approves on the public page: password, name, role, comments, signature, acceptance', async ({ browser }) => {
  client = await (await browser.newContext()).newPage()
  client.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`client: ${m.text()}`))
  await client.goto(link.url)
  await expect(client.getByRole('banner')).toHaveCount(0) // no app shell
  await client.getByLabel('Password').fill('wrong-one')
  await client.getByRole('button', { name: 'View Solution Package' }).click()
  await expect(client.getByRole('alert')).toContainText('Incorrect password (4 attempt(s) left')
  await client.getByLabel('Password').fill(link.password)
  await client.getByRole('button', { name: 'View Solution Package' }).click()
  const summary = client.getByTestId('package-summary')
  await expect(summary).toContainText('Solution Package v1 — Building B001')
  await expect(summary).toContainText('C9300-48UX')
  // The package and decision form fit every width (checked before deciding).
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await client.setViewportSize({ width, height })
    expect(await client.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `approval page at ${width}px`).toBe(0)
    if (process.env.M5A_SHOTS) await client.screenshot({ path: `${process.env.M5A_SHOTS}/approve-open-${width}.png`, fullPage: true })
  }
  await client.setViewportSize({ width: 1440, height: 900 })
  await client.getByPlaceholder('Your full name').fill('Clara Client')
  await client.getByPlaceholder('e.g. IT Director').fill('IT Director')
  await client.locator('textarea').fill('Approved for procurement')
  const canvas = client.locator('canvas')
  const box = await canvas.boundingBox()
  await client.mouse.move(box.x + 20, box.y + 30)
  await client.mouse.down()
  await client.mouse.move(box.x + 120, box.y + 60, { steps: 5 })
  await client.mouse.up()
  await client.getByRole('checkbox').check()
  await client.getByRole('button', { name: 'Approve' }).click()
  await expect(client.getByTestId('decision-recorded')).toContainText('You approved this Solution Package.')
})

test('approval freezes the design and unlocks procurement; the PM approves the procurement BOM and updates a line', async () => {
  await owner.goto(`${base()}/solution-package`)
  await owner.getByRole('tab', { name: '3. Validation & Approval' }).click()
  await expect(owner.getByTestId('approval-history')).toContainText('Clara Client, IT Director · signed · terms accepted')
  await owner.goto(`${base()}/lld`)
  await expect(owner.getByTestId('lld-frozen')).toContainText('Frozen by the Solution Package approval')
  await owner.goto(`${base()}/bom`)
  await expect(owner.getByText('Draft', { exact: true })).toHaveCount(0)
  await owner.getByRole('button', { name: 'Approve procurement BOM' }).click()
  await expect(owner.getByText('Procurement BOM approved')).toBeVisible()
  await owner.getByRole('button', { name: /Update procurement of C9300-48UX/ }).click()
  const editor = owner.getByTestId('procurement-editor')
  await editor.getByLabel('Procurement status').selectOption('quotation_requested')
  await editor.getByLabel('Vendor').fill('SERVON')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(owner.getByText('Procurement line saved')).toBeVisible()
  await owner.getByRole('button', { name: /Update procurement of C9300-48UX/ }).click()
  await owner.getByTestId('procurement-editor').getByLabel('Procurement status').selectOption('quoted')
  await owner.getByTestId('procurement-editor').getByRole('button', { name: 'Save' }).click()
  await owner.getByRole('button', { name: /Update procurement of C9300-48UX/ }).click()
  await owner.getByTestId('procurement-editor').getByLabel('Procurement status').selectOption('ordered')
  await owner.getByTestId('procurement-editor').getByRole('button', { name: 'Save' }).click()
  await expect(owner.getByRole('alert')).toContainText('An ordered line needs a PO number')
  await owner.getByTestId('procurement-editor').getByLabel('PO number').fill('PO-4711')
  await owner.getByTestId('procurement-editor').getByRole('button', { name: 'Save' }).click()
  await expect(owner.getByRole('row', { name: /^\d+ C9300-48UX E-DE/ })).toContainText('Ordered')
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Export BOM' }).click()
  expect((await download).suggestedFilename()).toBe('B001-bom-procurement.xlsx')
  const clientDownload = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Client export' }).click()
  expect((await clientDownload).suggestedFilename()).toBe('B001-bom-client.xlsx')
})

test('a change request changes a cable on its branch; the client approves it; the BOM is re-approved', async ({ browser }) => {
  await architect.goto(`${base()}/solution-package`)
  const panel = architect.getByTestId('change-requests')
  await panel.getByRole('button', { name: 'New change request' }).click()
  await panel.getByLabel('Change request title').fill('Longer trunk to TR-EG-02')
  await panel.getByLabel('Change request reason').fill('Cable route changed')
  await panel.getByRole('button', { name: 'Create' }).click()
  await expect(panel.getByTestId('change-request-detail')).toContainText('CR-1 · Draft')
  // Edit the cable on the change request's branch (the LLD itself stays frozen).
  await panel.getByRole('link', { name: 'Edit the LLD on its branch' }).click()
  await expect(architect.getByTestId('lld-frozen')).toContainText("This is a change request's branch")
  await architect.getByRole('tab', { name: 'Cable Schedule' }).click()
  const row = architect.locator('tbody tr', { hasText: 'C-BE-1' })
  await row.getByRole('button', { name: '50' }).click()
  await row.getByRole('spinbutton').fill('75')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(architect.locator('tbody tr', { hasText: 'C-BE-1' }).getByRole('button', { name: '75' })).toBeVisible()
  await architect.goto(`${base()}/solution-package`)
  await architect.getByTestId('change-requests').getByRole('button', { name: /CR-1 Longer trunk/ }).click()
  const detail = architect.getByTestId('change-request-detail')
  await expect(detail.getByTestId('bom-impact')).toContainText('50 m): 1 → 0')
  await expect(detail.getByTestId('bom-impact')).toContainText('75 m): 0 → 1')
  await detail.getByRole('button', { name: 'Submit change request' }).click()
  await expect(detail).toContainText('CR-1 · Submitted')
  // The PM sends it to the client.
  await owner.goto(`${base()}/solution-package`)
  await owner.getByTestId('change-requests').getByRole('button', { name: /CR-1 Longer trunk/ }).click()
  const pmDetail = owner.getByTestId('change-request-detail')
  await pmDetail.getByRole('button', { name: 'Send to the client' }).click()
  await expect(pmDetail.locator('input[readonly]').first()).toHaveValue(/\/approve\//)
  const values = await pmDetail.locator('input[readonly]').evaluateAll((els) => els.map((e) => e.value))
  const crLink = { url: new URL(values[0]).pathname, password: values[1] }
  // The client approves the change.
  const crClient = await (await browser.newContext()).newPage()
  await crClient.goto(crLink.url)
  await crClient.getByLabel('Password').fill(crLink.password)
  await crClient.getByRole('button', { name: 'View Change request' }).click()
  await expect(crClient.getByTestId('change-summary')).toContainText('CR-1: Longer trunk to TR-EG-02')
  await crClient.getByPlaceholder('Your full name').fill('Clara Client')
  await crClient.getByRole('checkbox').check()
  await crClient.getByRole('button', { name: 'Approve' }).click()
  await expect(crClient.getByTestId('decision-recorded')).toContainText('You approved this Change request.')
  await crClient.context().close()
  // Applied to the frozen LLD; the BOM changed since its approval and is re-approved.
  await owner.goto(`${base()}/bom`)
  await expect(owner.getByTestId('bom-changed')).toContainText('75 m): 0 → 1')
  await owner.getByRole('button', { name: 'Re-approve procurement BOM' }).click()
  await expect(owner.getByTestId('bom-changed')).toHaveCount(0)
  await owner.goto(`${base()}/solution-package`)
  await expect(owner.getByTestId('change-requests')).toContainText('CR-1 Longer trunk to TR-EG-02')
  await expect(owner.getByTestId('change-requests')).toContainText('Approved')
})

test('a change request adds an Edge in the HLD and maps it in the LLD, with a per-cable length; the client approves; HLD and LLD get new frozen versions', async ({ browser }) => {
  await architect.goto(`${base()}/solution-package`)
  const panel = architect.getByTestId('change-requests')
  await panel.getByRole('button', { name: 'New change request' }).click()
  await panel.getByLabel('Change request title').fill('Second edge in TR-EG-02')
  await panel.getByRole('button', { name: 'Create' }).click()
  await expect(panel.getByTestId('change-request-detail')).toContainText('CR-2 · Draft')
  await panel.getByRole('link', { name: 'Edit the HLD on its branch' }).click()
  await expect(architect.getByTestId('hld-branch-banner')).toContainText('CR-2 Second edge in TR-EG-02')
  const branchId = new URL(architect.url()).searchParams.get('branch')
  // The Edge and its uplink through the API (the canvas drag has its own HLD spec).
  let hld = await send(architect, 'get', `/hld/buildings/${b001}?branchId=${branchId}`, undefined, 200)
  const { device } = await send(architect, 'post', '/hld/devices', { buildingId: b001, branchId, role: 'edge', roomId: secondRoomId, baseRevision: hld.design.revision }, 201)
  hld = await send(architect, 'get', `/hld/buildings/${b001}?branchId=${branchId}`, undefined, 200)
  const border = hld.devices.find((d) => d.role === 'border')
  await send(architect, 'post', '/hld/uplinks', { buildingId: b001, branchId, source: { deviceId: border.id }, dest: { deviceId: device.id }, media: 'os2', speed: '10G', baseRevision: hld.design.revision }, 201)
  await architect.reload()
  await expect(architect.locator('.react-flow')).toContainText(device.hostname)
  await fitsEveryWidth(architect, 'hld-branch')
  // Out of step until the LLD maps it: shown on the change request.
  await architect.goto(`${base()}/solution-package`)
  await architect.getByTestId('change-requests').getByRole('button', { name: /CR-2 Second edge/ }).click()
  await expect(architect.getByTestId('cr-inconsistent')).toContainText(`${device.hostname}: in the HLD, not mapped in the LLD`)
  // Mapped in the branch's LLD against the change's own HLD.
  await architect.getByTestId('change-request-detail').getByRole('link', { name: 'Edit the LLD on its branch' }).click()
  const rec = architect.getByTestId('cr-reconciliation')
  await expect(rec.getByRole('button', { name: 'Copy into LLD' })).toHaveCount(2)
  await rec.getByRole('button', { name: 'Copy into LLD' }).first().click()
  await expect(rec.getByRole('button', { name: 'Copy into LLD' })).toHaveCount(1)
  await rec.getByRole('button', { name: 'Copy into LLD' }).click()
  await expect(rec).toContainText('The LLD of this change matches its HLD.')
  // Every cable has its own length: the cable after the panel, on the schedule.
  const onBranch = await send(architect, 'get', `/lld/buildings/${b001}?branchId=${branchId}`, undefined, 200)
  const ea = linkOf(onBranch, 'edge', 'ap')
  await architect.getByRole('tab', { name: 'Cable Schedule' }).click()
  await expect(architect.getByTestId(`cable-${ea.id}-0`)).toContainText('Patch cord')
  await architect.getByTestId(`cable-${ea.id}-1`).getByRole('button', { name: /Cable 2 of C-EA-1/ }).click()
  await architect.getByTestId(`cable-${ea.id}-1`).getByRole('spinbutton').fill('15')
  await architect.getByTestId(`cable-${ea.id}-1`).getByRole('button', { name: 'Save' }).click()
  await expect(architect.getByTestId(`cable-${ea.id}-1`).getByRole('button', { name: /Cable 2 of C-EA-1/ })).toHaveText('15')
  await fitsEveryWidth(architect, 'lld-branch-cables')
  // The Editor shows the same cable with its own length.
  await architect.goto(`${base()}/lld/editor?rack=${racks[1].id}&connection=${ea.id}&branch=${branchId}`)
  await expect(architect.getByLabel('Hop 1 cable Engineer Selected length')).toHaveValue('15')
  await fitsEveryWidth(architect, 'editor-branch')
  if (process.env.M5A_SHOTS) {
    for (const [width, height] of widths) {
      await architect.setViewportSize({ width, height })
      await architect.getByTestId('hops').screenshot({ path: `${process.env.M5A_SHOTS}/editor-hops-${width}.png` })
    }
    await architect.setViewportSize({ width: 1440, height: 900 })
  }
  // Submit; the PM sends it; the client approves.
  await architect.goto(`${base()}/solution-package`)
  await architect.getByTestId('change-requests').getByRole('button', { name: /CR-2 Second edge/ }).click()
  const detail = architect.getByTestId('change-request-detail')
  await expect(detail.getByTestId('cr-inconsistent')).toHaveCount(0)
  await expect(detail).toContainText('HLD devices')
  await detail.getByRole('button', { name: 'Submit change request' }).click()
  await expect(detail).toContainText('CR-2 · Submitted')
  await owner.goto(`${base()}/solution-package`)
  await owner.getByTestId('change-requests').getByRole('button', { name: /CR-2 Second edge/ }).click()
  const pmDetail = owner.getByTestId('change-request-detail')
  await pmDetail.getByRole('button', { name: 'Send to the client' }).click()
  await expect(pmDetail.locator('input[readonly]').first()).toHaveValue(/\/approve\//)
  const values = await pmDetail.locator('input[readonly]').evaluateAll((els) => els.map((e) => e.value))
  const crClient = await (await browser.newContext()).newPage()
  await crClient.goto(new URL(values[0]).pathname)
  await crClient.getByLabel('Password').fill(values[1])
  await crClient.getByRole('button', { name: 'View Change request' }).click()
  await crClient.getByPlaceholder('Your full name').fill('Clara Client')
  await crClient.getByRole('checkbox').check()
  await crClient.getByRole('button', { name: 'Approve' }).click()
  await expect(crClient.getByTestId('decision-recorded')).toContainText('You approved this Change request.')
  await crClient.context().close()
  // The frozen HLD has the Edge (a new frozen version); the LLD maps it, with the cable length.
  await owner.goto(`${base()}/hld`)
  await expect(owner.getByTestId('hld-frozen')).toBeVisible()
  await expect(owner.locator('.react-flow')).toContainText(device.hostname)
  const hldAfter = await send(owner, 'get', `/hld/buildings/${b001}`, undefined, 200)
  expect(hldAfter.versions[0]).toMatchObject({ frozen: true, number: 2 })
  const lldAfter = await lld()
  expect(lldAfter.devices.some((d) => d.inDesign && d.hldRef === device.id)).toBe(true)
  expect(linkOf(lldAfter, 'edge', 'ap').segments[1]).toMatchObject({ engineerSelectedM: 15, effectiveM: 15 })
  expect(lldAfter.versions[0]).toMatchObject({ label: 'CR-2 Second edge in TR-EG-02', frozen: true })
  await fitsEveryWidth(owner, 'hld-frozen')
})

test('cage nuts per RU and face are an organisation setting; the BOM follows', async () => {
  const nuts = async () => (await send(owner, 'get', `/bom/buildings/${b001}`, undefined, 200)).lines.filter((l) => l.key.startsWith('cage:')).reduce((n, l) => n + l.qty, 0)
  const before = await nuts()
  await owner.goto(`/orgs/${orgId}/settings`)
  const section = owner.getByTestId('cage-nuts')
  await expect(section.getByLabel('Cage nuts per RU, front face')).toHaveValue('4')
  await section.getByLabel('Cage nuts per RU, front face').fill('2')
  await section.getByLabel('Cage nuts per RU, rear face').fill('0')
  await section.getByRole('button', { name: 'Save cage nuts' }).click()
  await expect(owner.getByTestId('cage-nuts').getByLabel('Cage nuts per RU, front face')).toHaveValue('2')
  await owner.reload()
  await expect(owner.getByTestId('cage-nuts').getByLabel('Cage nuts per RU, front face')).toHaveValue('2')
  expect(await nuts()).toBe(before / 2)
  await fitsEveryWidth(owner, 'org-settings')
})

test('the BOM, the Solution Package and the public approval page fit every width', async ({ browser }) => {
  const pub = await (await browser.newContext()).newPage()
  for (const [page, url] of [
    [owner, `${base()}/bom`],
    [owner, `${base()}/solution-package`],
    [pub, link.url],
  ]) {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height })
      await page.goto(url)
      await expect(page.locator('body')).not.toContainText('Loading…')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${url} at ${width}px`).toBe(0)
      if (process.env.M5A_SHOTS) await page.screenshot({ path: `${process.env.M5A_SHOTS}/${url.split('/').pop().slice(0, 20)}-${width}.png`, fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await pub.context().close()
  expect(errors, errors.join('\n')).toEqual([])
})
