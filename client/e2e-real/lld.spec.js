import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M4b, real mode: LLD on the backend. A verified survey and an approved HLD
// (set up through the API), then in the browser: start the LLD from the
// approved HLD → place devices → map ports with a patch-panel hop in the
// Rackium Editor → Cable ID + length → schedules export → save a version →
// diff → submit → the PM approves; then a newer HLD → reconciliation banner.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
let owner
let architect
let orgId
let projectId
let b001
let api
let racks
const errors = []
const base = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}`
const lldUrl = () => `${base()}/lld`

async function lld(page = architect) {
  const res = await page.request.get(`${api}/lld/buildings/${b001}`)
  expect(res.status(), await res.text()).toBe(200)
  return res.json()
}
const byRole = (view, role) => view.devices.find((d) => d.inDesign && d.role === role)
const linkOf = (view, a, b) => {
  const ids = [byRole(view, a).id, byRole(view, b).id].sort().join()
  return view.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === ids)
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect]) await p?.context().close()
})

test('set up: a verified survey and an approved HLD for B001', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `lld-${RUN_ID}@example.com`, organisationName: 'LLD Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'LLD Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `lld-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Field Engineer' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `lld-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  // 400/409: the deliberately refused overlap placement (shown to the user in the page).
  architect.on('console', (m) => m.type() === 'error' && !/status of (400|409)/.test(m.text()) && errors.push(`architect: ${m.text()}`))
  owner.on('console', (m) => m.type() === 'error' && errors.push(`owner: ${m.text()}`))

  const send = async (page, method, path, data, status = 201) => {
    const res = await page.request[method](`${api}${path}`, { data })
    expect(res.status(), await res.text()).toBe(status)
    return res.json()
  }
  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 })
  const { room: main } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id })
  const { room: second } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id })
  racks = [(await send(fe, 'post', '/survey/racks', { roomId: main.id })).rack, (await send(fe, 'post', '/survey/racks', { roomId: second.id })).rack]
  for (const rack of racks) {
    await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  }
  await send(architect, 'post', '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 })
  const targets = [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]
  for (const t of targets) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()

  const hld = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: hld.design.revision })
  const generated = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/submit', { buildingId: b001, baseRevision: generated.design.revision })
  await send(owner, 'post', '/hld/decision', { buildingId: b001, decision: 'approved' }, 200)
})

test('the Architect starts the LLD from the approved HLD', async () => {
  await architect.goto(lldUrl())
  await expect(architect.getByTestId('lld-not-started')).toContainText('latest approved HLD (v1)')
  await architect.getByRole('button', { name: 'Start LLD from HLD v1' }).click()
  await expect(architect.getByTestId('lld-hld-baseline')).toHaveText('Based on HLD v1')
  for (const name of ['Physical Connections', 'Rack Elevations', 'Port Schedule', 'Cable Schedule']) await expect(architect.getByRole('tab', { name })).toBeVisible()
  await expect(architect.getByRole('tab', { name: 'Connectivity' })).toHaveCount(0)
})

test('Rack Elevations: place devices by RU and face; an overlap is refused; add a patch panel', async () => {
  const view = await lld()
  await architect.getByRole('tab', { name: 'Rack Elevations' }).click()
  const panel = architect.getByTestId('lld-placement')
  await expect(panel).toContainText('Not placed yet')
  const place = async (deviceId, rackId, ru) => {
    await panel.getByLabel('Device to place').selectOption(deviceId)
    await panel.getByLabel('Rack').first().selectOption(rackId)
    await panel.getByLabel('RU').first().fill(String(ru))
    await panel.getByRole('button', { name: 'Place', exact: true }).click()
  }
  await place(byRole(view, 'border').id, racks[0].id, 40)
  await expect(architect.getByText(/B-DE-ERL-C01-B001-EG-001 \(R01 RU40 front\)/)).toBeAttached()
  // The Fusion on the Border's RU and face is refused by the shared rack rules.
  await place(byRole(view, 'fusion').id, racks[0].id, 40)
  await expect(architect.getByRole('alert').filter({ hasText: /F-DE-ERL-C01-B001-EG-001/ })).toBeVisible()
  await place(byRole(view, 'fusion').id, racks[0].id, 38)
  await place(byRole(view, 'edge').id, racks[1].id, 40)
  await expect(panel).toContainText('Every rack-mounted device has a rack and RU')
  // A patch panel from the catalogue in the Edge's rack.
  await panel.getByLabel('Passive item').selectOption({ label: 'Cat6A Patch Panel 24-port' })
  await panel.getByLabel('Rack').nth(1).selectOption(racks[1].id)
  await panel.getByLabel('RU').nth(1).fill('42')
  await panel.getByRole('button', { name: 'Add to rack' }).click()
  // Drawn on the elevation (the block's title is its label).
  await expect(architect.getByTitle('PP-R01-01')).toBeVisible()
})

test('Rackium Editor: ports from the catalogue, suggestions applied by the user, a patch-panel hop, a Cable ID', async () => {
  const view = await lld()
  const ea = linkOf(view, 'edge', 'ap')
  await architect.goto(`${lldUrl()}/editor?rack=${racks[1].id}&connection=${ea.id}`)
  const editor = architect.getByTestId('rackium-editor')
  await expect(editor).toContainText('Edit connection')
  // Suggested, never assigned: nothing is selected until the user clicks "use".
  await expect(editor.getByTestId('end-source')).toContainText('No port selected')
  await editor.getByTestId('end-source').getByRole('button', { name: /Suggested:/ }).click()
  await editor.getByTestId('end-destination').getByRole('button', { name: /Suggested:/ }).click()
  await expect(editor.getByTestId('end-source')).toContainText(/(Gi1\/0\/1|Eth0) selected/)
  await editor.getByRole('button', { name: 'Add hop' }).click()
  await editor.getByLabel('Hop 1 panel').selectOption({ index: 1 })
  const hops = editor.getByTestId('hops')
  await hops.getByRole('button', { name: 'Suggested: 01 — use' }).first().click()
  await expect(hops.getByLabel('Hop 1 in (rear)')).toHaveValue('01')
  await hops.getByRole('button', { name: 'Suggested: 01 — use' }).click()
  await expect(hops.getByLabel('Hop 1 out (front)')).toHaveValue('01')
  await editor.getByLabel('Hop 1 segment Cable ID').fill('SEG-EA-1')
  await editor.getByRole('button', { name: view.cableIdSuggestion }).click()
  await expect(editor.getByLabel('Cable ID', { exact: true })).toHaveValue(view.cableIdSuggestion)
  await editor.getByRole('button', { name: 'Save connection' }).click()
  await expect(editor.getByText('Saved')).toBeVisible()
  const after = linkOf(await lld(), 'edge', 'ap')
  expect(after).toMatchObject({ cableId: view.cableIdSuggestion, hops: [{ inPort: '01', outPort: '01', segmentCableId: 'SEG-EA-1' }] })
  expect(after.source.portId && after.dest.portId).toBeTruthy()
  // The same Edge port is now shown as occupied for another connection.
  const be = linkOf(view, 'border', 'edge')
  await architect.goto(`${lldUrl()}/editor?rack=${racks[1].id}&connection=${be.id}`)
  const edgeEnd = be.source.deviceId === byRole(view, 'edge').id ? 'end-source' : 'end-destination'
  const edgePort = after.source.deviceId === byRole(view, 'edge').id ? after.source.portId : after.dest.portId
  await expect(architect.getByTestId(edgeEnd).getByRole('button', { name: edgePort.split('/').pop(), exact: true }).first()).toBeDisabled()
})

test('Cable Schedule: Cable ID first; Engineer Selected length; Estimated flag; both schedules export to Excel', async () => {
  // The other two uplinks get their ports and Cable IDs through the API (the editor flow is covered above).
  let view = await lld()
  for (const [a, b, ports, cableId] of [
    ['border', 'fusion', ['Te1/1/1', 'Te1/1/1'], 'C-BF-1'],
    ['border', 'edge', ['Te1/1/2', 'Te1/1/1'], 'C-BE-1'],
  ]) {
    const c = linkOf(view, a, b)
    const first = c.source.deviceId === byRole(view, a).id
    const res = await architect.request.patch(`${api}/lld/connections/${c.id}`, {
      data: { source: { deviceId: c.source.deviceId, portId: first ? ports[0] : ports[1] }, dest: { deviceId: c.dest.deviceId, portId: first ? ports[1] : ports[0] }, cableId, baseRevision: view.design.revision },
    })
    expect(res.status(), await res.text()).toBe(200)
    view = await lld()
  }
  await architect.goto(lldUrl())
  await architect.getByRole('tab', { name: 'Cable Schedule' }).click()
  await expect(architect.locator('thead th').first()).toHaveText('Cable ID')
  const row = architect.locator('tbody tr', { hasText: 'C-BE-1' })
  await expect(row).toContainText('50') // 42 m surveyed pathway + slack, rounded up to stock
  await row.getByRole('button', { name: '50' }).click()
  await row.getByRole('spinbutton').fill('47')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect(row.getByRole('button', { name: '47' })).toBeVisible()
  const cableDownload = architect.waitForEvent('download')
  await architect.getByRole('button', { name: 'Export' }).click()
  expect((await cableDownload).suggestedFilename()).toBe('B001-cable-schedule.xlsx')
  await architect.getByRole('tab', { name: 'Port Schedule' }).click()
  await expect(architect.getByText('C-BE-1').first()).toBeVisible()
  const portDownload = architect.waitForEvent('download')
  await architect.getByRole('button', { name: 'Export' }).click()
  expect((await portDownload).suggestedFilename()).toBe('B001-port-schedule.xlsx')
})

test('versions: save with a label, change something, see the visual diff', async () => {
  const versions = architect.getByTestId('lld-versions')
  await versions.getByLabel('Version label').fill('Ports mapped')
  await versions.getByRole('button', { name: 'Save version' }).click()
  await expect(versions.getByLabel('Version history')).toContainText('v1 Ports mapped')
  // A change after the version: the Border–Fusion Cable ID.
  await architect.getByRole('tab', { name: 'Cable Schedule' }).click()
  const row = architect.locator('tbody tr', { hasText: 'C-BF-1' })
  await row.getByRole('button', { name: 'C-BF-1' }).click()
  // The cell is now an input (the row no longer shows the ID as text).
  const editing = architect.locator('tbody tr', { has: architect.getByRole('textbox') })
  await editing.getByRole('textbox').fill('C-BF-2')
  await editing.getByRole('button', { name: 'Save' }).click()
  await expect(architect.locator('tbody tr', { hasText: 'C-BF-2' })).toBeVisible()
  await versions.getByLabel('Compare to').selectOption('current')
  await versions.getByRole('button', { name: 'Show diff' }).click()
  const diff = versions.getByTestId('design-diff')
  await expect(diff).toContainText('Changed (1)')
  await expect(diff).toContainText('cableId: C-BF-1 → C-BF-2')
})

test('submit; the Architect cannot approve; the PM approves; versions freeze; renaming is locked', async () => {
  await architect.getByRole('button', { name: 'Validate LLD' }).click()
  await expect(architect.getByText('No findings — the LLD can be submitted.').or(architect.getByText(/Warning/).first())).toBeVisible()
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
  await architect.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(architect.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await owner.goto(lldUrl())
  await owner.getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText('Approved').first()).toBeVisible()
  await expect(owner.getByTestId('lld-versions')).toContainText('Approved · frozen')
  await expect(owner.getByText(/renaming needs a change request/)).toBeVisible()
  await owner.goto(base())
  await expect(owner.getByRole('link', { name: /LLD.*Approved/ })).toBeVisible()
})

test('a newer approved HLD: banner, side-by-side reconciliation, copy into the LLD, mark reviewed', async () => {
  // HLD v2: a firewall in the main room, approved by the PM.
  const hld = await (await architect.request.get(`${api}/hld/buildings/${b001}`)).json()
  const room = hld.rooms.find((r) => r.isMainRoom) ?? hld.rooms[0]
  expect((await architect.request.post(`${api}/hld/devices`, { data: { buildingId: b001, role: 'firewall', roomId: room.id, baseRevision: hld.design.revision } })).status()).toBe(201)
  const v = await (await architect.request.get(`${api}/hld/buildings/${b001}`)).json()
  expect((await architect.request.post(`${api}/hld/submit`, { data: { buildingId: b001, baseRevision: v.design.revision } })).status()).toBe(201)
  expect((await owner.request.post(`${api}/hld/decision`, { data: { buildingId: b001, decision: 'approved' } })).status()).toBe(200)

  await architect.goto(lldUrl())
  await expect(architect.getByTestId('lld-hld-baseline')).toHaveText('Based on HLD v1 — HLD has changed')
  await architect.getByRole('button', { name: 'Review changes' }).click()
  const rec = architect.getByTestId('lld-reconciliation')
  await expect(rec).toContainText('In the HLD, not in the LLD (1)')
  await expect(rec).toContainText('FW-DE-ERL-C01-B001-EG-001')
  await rec.getByRole('button', { name: 'Copy into LLD' }).click()
  // Clicked straight away, while the copy is still saving and reloading: the
  // write waits for it and uses the new revision (regression: it went out
  // stale and the refusal was wiped by the reload).
  await architect.getByRole('button', { name: 'Mark reviewed against HLD v2' }).click()
  await expect(architect.getByTestId('lld-hld-baseline')).toHaveText('Based on HLD v2')
})

test('the LLD, the Rackium Editor and the stock-length settings fit every width', async () => {
  for (const [page, url] of [
    [architect, lldUrl()],
    [architect, `${lldUrl()}/editor?rack=${racks[1].id}`],
    [owner, `/orgs/${orgId}/settings`],
  ]) {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
      await page.setViewportSize({ width, height })
      await page.goto(url)
      await expect(page.locator('main')).not.toContainText('Loading…')
      for (const tab of url.endsWith('/lld') ? ['Physical Connections', 'Rack Elevations', 'Port Schedule', 'Cable Schedule'] : [null]) {
        if (tab) await page.getByRole('tab', { name: tab }).click()
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('main')
          return document.documentElement.scrollWidth - document.documentElement.clientWidth + (main.scrollWidth - main.clientWidth)
        })
        expect(overflow, `${url} ${tab ?? ''} at ${width}px`).toBe(0)
        if (process.env.LLD_SHOTS) await page.screenshot({ path: `${process.env.LLD_SHOTS}/${url.includes('editor') ? 'editor' : url.includes('settings') ? 'settings' : `lld-${tab.replace(/\s/g, '')}`}-${width}.png`, fullPage: true })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  expect(errors, errors.join('\n')).toEqual([])
})
