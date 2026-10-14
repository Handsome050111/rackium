import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'
import { REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'

// M6a, real mode: an approved, frozen LLD with procurement delivered (set up
// through the API) → the Field Engineer installs the Edge switch on a phone
// (serial, MAC, a different RU), logs the RU difference as an exception,
// patches the AP link cable by cable with Installed lengths and tests it →
// the PM accepts the exception on the desktop → configured, tested, DGUV →
// the PM accepts the device and the link → the Edge appears in the CMDB with
// its provenance → the port's route traced through the patch panel →
// warranty dates imported from a CSV.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
let owner
let architect
let fe
let orgId
let projectId
let b001
let api
const errors = []
const base = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}`
const widths = [[1440, 900], [1024, 768], [768, 1024], [390, 844]]
let edge
let ap
let border
let panel
let eaId
let beId

async function send(page, method, p, data, status) {
  const res = await page.request[method](`${api}${p}`, data === undefined ? undefined : { data })
  expect(res.status(), `${method} ${p}: ${await res.text()}`).toBe(status)
  return res.json()
}
const lld = async () => send(architect, 'get', `/lld/buildings/${b001}`, undefined, 200)
const dep = async (page = owner) => send(page, 'get', `/deployment/buildings/${b001}`, undefined, 200)
const byRole = (v, role) => v.devices.find((d) => (d.inDesign ?? true) && d.role === role)
const linkOf = (v, a, b) => {
  const ids = [byRole(v, a).id, byRole(v, b).id].sort().join()
  return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === ids)
}
async function fitsEveryWidth(page, label) {
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('[data-page-state="ready"]')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M6A_SHOTS) await page.screenshot({ path: `${process.env.M6A_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect, fe]) await p?.context().close()
})

test('set up: a frozen LLD for B001 and every procurement line delivered', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m6a-${RUN_ID}@example.com`, organisationName: 'M6a Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M6a Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m6a-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m6a-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  // 400/409: deliberate refusals shown in the page.
  for (const [who, page] of [['owner', owner], ['fe', fe], ['architect', architect]]) page.on('console', (m) => m.type() === 'error' && !/status of (400|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))

  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const { room: main } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const { room: second } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const racks = [(await send(fe, 'post', '/survey/racks', { roomId: main.id }, 201)).rack, (await send(fe, 'post', '/survey/racks', { roomId: second.id }, 201)).rack]
  for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  for (const t of [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  const hld = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: hld.design.revision }, 201)
  await send(architect, 'post', '/hld/submit', { buildingId: b001, baseRevision: (await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)).design.revision }, 201)
  await send(owner, 'post', '/hld/decision', { buildingId: b001, decision: 'approved' }, 200)
  await send(architect, 'post', '/lld/start', { buildingId: b001 }, 201)
  let v = await lld()
  const save = async (method, p, body, status = 200) => {
    v = await lld()
    return send(architect, method, p, { ...body, baseRevision: v.design.revision }, status)
  }
  await save('put', `/lld/devices/${byRole(v, 'border').id}/placement`, { rackId: racks[0].id, ru: 40, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'fusion').id}/placement`, { rackId: racks[0].id, ru: 38, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'edge').id}/placement`, { rackId: racks[1].id, ru: 40, face: 'front' })
  const pp = (await save('post', '/lld/devices', { buildingId: b001, catalogueKey: 'Generic Cat6A Patch Panel 24-port', rackId: racks[1].id, ru: 42, face: 'front' }, 201)).device
  for (const [a, b, ports, cableId, hops] of [
    ['border', 'fusion', ['Te1/1/1', 'Te1/1/1'], 'C-BF-1'],
    ['border', 'edge', ['Te1/1/2', 'Te1/1/1'], 'C-BE-1'],
    ['edge', 'ap', ['Gi1/0/1', 'Eth0'], 'C-EA-1', [{ patchPanelId: pp.id, inPort: '01', outPort: '02', segmentCableId: 'C-EA-1b' }]],
  ]) {
    v = await lld()
    const c = linkOf(v, a, b)
    const first = c.source.deviceId === byRole(v, a).id
    await save('patch', `/lld/connections/${c.id}`, { source: { deviceId: c.source.deviceId, portId: first ? ports[0] : ports[1] }, dest: { deviceId: c.dest.deviceId, portId: first ? ports[1] : ports[0] }, cableId, ...(hops ? { hops } : {}) })
  }
  await save('post', '/lld/submit', { buildingId: b001 }, 201)
  await send(owner, 'post', '/lld/decision', { buildingId: b001, decision: 'approved' }, 200)

  // The Solution Package, approved by the client through the public API: the design freezes.
  for (const g of REQUIRED_INPUT_GROUPS) {
    const sp = await send(architect, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
    const body = g.key === 'addressing' ? { addressingEntries: [{ id: 'a1', label: 'Users', vlanId: 10, cidr: '10.10.0.0/24', gateway: '10.10.0.1' }] } : { kvPairs: [{ id: 'k1', key: 'Owner', value: 'Client IT' }] }
    await send(architect, 'put', `/solution-package/groups/${g.key}`, { buildingId: b001, ...body, baseRevision: sp.revision }, 200)
  }
  let sp = await send(owner, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
  for (const area of sp.validationAreas.filter((a) => a.result === 'warning')) {
    await send(owner, 'post', '/solution-package/accept-warning', { buildingId: b001, areaKey: area.key, baseRevision: sp.revision }, 200)
    sp = await send(owner, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
  }
  const { shareLink } = await send(owner, 'post', '/solution-package/submit', { buildingId: b001 }, 201)
  const decided = await owner.request.post(`/api/v1/public/share-links/${shareLink.token}/decision`, { data: { password: shareLink.password, decision: 'approved', name: 'Clara Client', role: 'IT Director', comments: '', termsAccepted: true } })
  expect(decided.status(), await decided.text()).toBe(200)
  await send(owner, 'post', '/bom/approve', { buildingId: b001 }, 201)
  // Every line delivered — except the Fusion's, which stays Ordered (gating shown in the UI).
  const d0 = await dep()
  const fusionLine = byRole(d0, 'fusion').delivery.lineKey
  const bom = await send(owner, 'get', `/bom/buildings/${b001}`, undefined, 200)
  for (const key of new Set(d0.devices.map((d) => d.delivery.lineKey))) {
    let version = bom.lines.find((l) => l.key === key)?.procurement.version ?? 0
    for (const body of key === fusionLine ? [{ status: 'ordered', poNumber: 'PO-1' }] : [{ status: 'ordered', poNumber: 'PO-1' }, { status: 'shipped' }, { status: 'delivered', actualDelivery: '2026-10-01' }]) {
      await send(owner, 'patch', '/bom/lines', { buildingId: b001, lineKey: key, ...body, version }, 200)
      version += 1
    }
  }
  const d = await dep()
  edge = byRole(d, 'edge')
  ap = byRole(d, 'ap')
  border = byRole(d, 'border')
  panel = d.devices.find((x) => x.isPanel)
  eaId = linkOf(d, 'edge', 'ap').id
  beId = linkOf(d, 'border', 'edge').id
  expect(byRole(d, 'fusion').status).toBe('ordered')
})

test('phone: the Field Engineer installs the Edge — serial, MAC, a different RU — and logs the difference as an exception', async () => {
  await fe.setViewportSize({ width: 390, height: 844 })
  await fe.goto(`${base()}/deployment`)
  await expect(fe.getByRole('heading', { name: 'Deployment & Installation — B001' })).toBeVisible()
  await expect(fe.getByTestId('pipeline')).toContainText('devices planned')
  // A device not delivered says so and cannot be recorded.
  const fusion = (await dep(fe)).devices.find((x) => x.role === 'fusion')
  await fe.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${fusion.hostname}`) }).click()
  const screen = fe.getByTestId('device-screen')
  await expect(screen.getByRole('status').filter({ hasText: 'Awaiting delivery' })).toContainText('procurement line is ordered')
  await expect(screen.getByLabel('Serial number')).toBeDisabled()
  await screen.getByRole('button', { name: 'Back to devices' }).click()

  await fe.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${edge.hostname}`) }).click()
  await expect(screen.getByTestId('device-status')).toHaveText('Delivered')
  await screen.getByLabel('Serial number').fill('FOC2611X0AB')
  await screen.getByLabel('MAC address').fill('zz')
  await expect(screen.getByText('A MAC address has 12 hexadecimal digits')).toBeVisible()
  await expect(screen.getByRole('button', { name: 'Mark installed' })).toBeDisabled()
  await screen.getByLabel('MAC address').fill('70b3.1755.2a01')
  await screen.getByLabel('RU').fill('30')
  await screen.getByLabel('PDU outlet').fill('B-04')
  await screen.getByRole('button', { name: 'Mark installed' }).click()
  await expect(screen.getByRole('status').filter({ hasText: 'installed' })).toBeVisible()
  await expect(screen.getByTestId('device-status')).toHaveText('Installed')
  await expect(screen.getByLabel('MAC address')).toHaveValue('70:b3:17:55:2a:01')
  // The RU differs from the frozen LLD: detected, and logged as an exception with a reason.
  const deviations = screen.getByRole('list', { name: 'Deviations from the design' })
  await expect(deviations).toContainText('RU')
  await expect(deviations).toContainText('designed 40, installed 30')
  await deviations.getByRole('button', { name: 'Log exception' }).click()
  const dialog = fe.getByRole('dialog', { name: 'Log exception' })
  await dialog.getByLabel('Reason').fill('RU 40 is still taken by the old router until cut-over')
  await dialog.getByLabel('Add exception photo').setInputFiles(fixture('photo.jpg'))
  await expect(dialog).toContainText('photo.jpg')
  await dialog.getByRole('button', { name: 'Log exception' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(deviations).toContainText('exception logged')
  await expect(screen.getByLabel('Before acceptance')).toContainText('1 exception(s) not yet accepted')
})

test('phone: the AP link patched cable by cable with Installed lengths, confirmed and tested', async () => {
  // The other end devices and the panel installed through the API (the same calls).
  for (const d of [ap, panel, border]) await send(fe, 'put', `/deployment/devices/${d.id}/installation`, { ...(d.serialised ? { serial: `SN-${d.role}-${RUN_ID}` } : {}), ...(d.rackId ? { rackId: d.rackId, ru: d.ru, face: d.face } : {}), markInstalled: true }, 200)
  await fe.reload()
  const screen = fe.getByTestId('device-screen')
  const card = screen.getByTestId(`connection-${eaId}`)
  await expect(card).toContainText('via ')
  await card.getByLabel('Cable 1 installed length').fill('1')
  await card.getByRole('checkbox', { name: 'Confirmed' }).first().check()
  await card.getByRole('button', { name: 'Confirm patching' }).click()
  await expect(screen.getByRole('alert')).toContainText('cable 2')
  await card.getByLabel('Cable 2 installed length').fill('14.5')
  await card.getByRole('checkbox', { name: 'Confirmed' }).nth(1).check()
  await card.getByRole('button', { name: 'Confirm patching' }).click()
  await expect(screen.getByRole('status').filter({ hasText: 'Patching confirmed' })).toBeVisible()
  await expect(screen.getByTestId(`connection-${eaId}`)).toContainText('Installed')
  await screen.getByTestId(`connection-${eaId}`).getByRole('button', { name: 'Test passed' }).click()
  await expect(screen.getByTestId(`connection-${eaId}`)).toContainText('Link test passed')
  // The trunk to the Border as designed, through the API.
  const be = (await dep(fe)).connections.find((c) => c.id === beId)
  await send(fe, 'put', `/deployment/connections/${beId}/installation`, { segments: be.segments.map((s) => ({ index: s.index, cableId: s.cableId, installedM: s.effectiveM, confirmed: true })), confirm: true }, 200)
  await send(fe, 'post', `/deployment/connections/${beId}/test`, { result: 'pass' }, 200)
  await fe.reload()
  await screen.getByRole('button', { name: 'Mark configured' }).click()
  await expect(screen.getByTestId('device-status')).toHaveText('Configured')
  await screen.getByRole('button', { name: 'Mark tested' }).click()
  await expect(screen.getByTestId('device-status')).toHaveText('Tested')
  // DGUV V3 on the phone: date and inspector.
  await screen.getByLabel('Inspector').fill('Elektro Meyer GmbH')
  await screen.getByRole('button', { name: 'Record inspection' }).click()
  await expect(screen.getByTestId('dguv-status')).toContainText('Valid')
  await expect(screen.getByTestId('dguv-status')).toContainText('Elektro Meyer GmbH')
  const overflow = await fe.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
})

test('desktop: the PM accepts the exception, the device and the link; the pipeline counts', async () => {
  await owner.goto(`${base()}/deployment`)
  const register = owner.getByRole('region', { name: 'Exception register' })
  await expect(register).toContainText('designed 40 → installed 30')
  await expect(register).toContainText('RU 40 is still taken by the old router')
  await expect(register).toContainText('1 photo(s)')
  await register.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(owner.getByRole('status').filter({ hasText: 'Exception accepted' })).toBeVisible()
  await owner.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${edge.hostname}`) }).click()
  const panelEl = owner.getByTestId('installation-panel')
  await expect(panelEl.getByTestId('device-status')).toHaveText('Tested')
  await panelEl.getByRole('button', { name: 'Accept device' }).click()
  await expect(panelEl.getByTestId('device-status')).toHaveText('Accepted')
  await panelEl.getByTestId(`connection-${eaId}`).getByRole('button', { name: 'Accept connection' }).click()
  await expect(owner.getByTestId('installation-panel').getByTestId(`connection-${eaId}`)).toContainText('Accepted')
  // The AP too (through the API), so the link is fully as-built.
  for (const s of ['configured', 'tested']) await send(fe, 'post', `/deployment/devices/${ap.id}/status`, { status: s }, 200)
  await send(owner, 'post', `/deployment/devices/${ap.id}/status`, { status: 'accepted' }, 200)
  await owner.reload()
  await expect(owner.getByTestId('pipeline')).toContainText('devices installed')
  await expect(owner.getByTestId('location-tree')).toContainText('ready')
  await fitsEveryWidth(owner, 'deployment')
})

test('the Edge in the CMDB with provenance; search by cable ID; the port route traced; Excel export', async () => {
  await owner.goto(`${base()}/cmdb`)
  await expect(owner.getByRole('heading', { name: 'CMDB — B001' })).toBeVisible()
  const table = owner.locator('table')
  await expect(table).toContainText(edge.hostname)
  await expect(table).toContainText('FOC2611X0AB')
  await expect(table).not.toContainText(border.hostname) // installed, not accepted
  await owner.getByLabel('Search inventory').fill('c-ea-1b')
  await expect(table.locator('tbody tr')).toHaveCount(2)
  await owner.getByLabel('Search inventory').fill('')
  await table.getByText(edge.hostname).click()
  const detail = owner.getByTestId('record-detail')
  await expect(detail).toContainText('70:b3:17:55:2a:01')
  await expect(detail.getByLabel(/^Source: Deployment, Fiona Field/).first()).toBeVisible()
  await expect(detail.getByLabel(/^Source: Design/).first()).toBeVisible()
  await expect(owner.getByTestId('reconciliation')).toContainText('In the CMDB (accepted)')
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Excel' }).click()
  expect((await download).suggestedFilename()).toBe('CMDB-B001.xlsx')

  await owner.getByRole('tab', { name: 'Cable matrix' }).click()
  await expect(owner.locator('table')).toContainText('C-EA-1, C-EA-1b')
  await owner.locator('table').getByRole('button', { name: 'Gi1/0/1' }).click()
  await expect(owner.getByRole('tab', { name: 'Port connectivity' })).toHaveAttribute('aria-selected', 'true')
  const trace = owner.getByTestId('port-trace')
  await expect(trace).toContainText('Cable IDs: C-EA-1, C-EA-1b')
  await expect(trace).toContainText('Test: pass')
  await expect(trace.getByTestId('route-path')).toHaveAttribute('stroke', '#094F9A') // Cat6A in its media colour
  await expect(trace.getByTestId('route-path')).toHaveAttribute('d', /^M [\d.]+ [\d.]+( [HV] [\d.]+)+$/) // orthogonal only
  await expect(trace.getByTestId('route-diagram')).toContainText('C-EA-1b')
  if (process.env.M6A_SHOTS) await trace.screenshot({ path: `${process.env.M6A_SHOTS}/port-trace.png` })
  await owner.getByRole('tab', { name: 'Connection map' }).click()
  await expect(owner.locator('.react-flow__node').first()).toBeVisible()
  await owner.getByRole('tab', { name: 'Change log' }).click()
  await expect(owner.getByRole('list', { name: 'Change log' })).toContainText('deployment.device.accepted')
  await owner.getByRole('tab', { name: 'Asset inventory' }).click()
  await fitsEveryWidth(owner, 'cmdb')
})

test('lifecycle: warranty dates imported from a CSV by serial; operational edit flagged; the Field Engineer reads only', async () => {
  await owner.goto(`${base()}/cmdb?tab=lifecycle&record=${edge.id}`)
  const csv = path.join(os.tmpdir(), `m6a-lifecycle-${RUN_ID}.csv`)
  fs.writeFileSync(csv, 'Serial,Warranty start,Warranty end\nfoc2611x0ab,2026-10-01,01.10.2031\nUNKNOWN-1,2026-10-01,2030-01-01\n')
  try {
    await owner.getByLabel('Lifecycle import file').setInputFiles(csv)
    const preview = owner.getByTestId('import-preview')
    await expect(preview).toContainText('1 row(s) ready, 1 with problems')
    await expect(preview).toContainText('No CMDB record with serial or hostname "UNKNOWN-1"')
    await preview.getByRole('button', { name: 'Import 1 row(s)' }).click()
  } finally {
    fs.rmSync(csv, { force: true })
  }
  await expect(owner.getByRole('status')).toContainText('1 device(s) updated')
  await expect(owner.locator('table')).toContainText('2031-10-01')
  const detail = owner.getByTestId('record-detail')
  await expect(detail.getByLabel(/^Source: Import/)).toBeVisible()
  await detail.getByRole('button', { name: 'Operational edit' }).click()
  await detail.getByLabel('Asset tag').fill('INV-0042')
  await detail.getByRole('button', { name: 'Save change' }).click()
  await expect(owner.getByRole('status')).toContainText('Operational change saved')
  await expect(owner.getByTestId('record-detail')).toContainText('INV-0042')
  await owner.getByRole('tab', { name: 'Change log' }).click()
  await expect(owner.getByRole('list', { name: 'Change log' }).locator('li').first()).toContainText('Operational change')
  // The Field Engineer reads the CMDB but cannot edit it.
  await fe.setViewportSize({ width: 1440, height: 900 })
  await fe.goto(`${base()}/cmdb?record=${edge.id}`)
  await expect(fe.getByTestId('record-detail')).toContainText('INV-0042')
  await expect(fe.getByRole('button', { name: 'Operational edit' })).toHaveCount(0)
})

test('no console errors on any page', async () => {
  expect(errors).toEqual([])
})
