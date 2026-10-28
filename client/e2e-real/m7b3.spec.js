import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M7b-3, real mode (addendum v2.3 Q1; DATA-MODEL §5.20): the five HLD design
// tools from the toolbar — Reroute through a third room (the length grows),
// Replace Endpoint (a new cable ID), Split with a new Distribution and Merge
// back (it stays, unlinked), Break with a reason (archived, listed, "uplink
// needed" a warning) — each undone and redone. Long names are shown whole on
// the HLD canvas and the LLD device cards. Every width, no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
let owner
let architect
let orgId
let projectId
let b001
let api
let rooms
const errors = []
const hldUrl = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}/hld`
const hld = async () => (await architect.request.get(`${api}/hld/buildings/${b001}`)).json()
const link = (view, a, b) => {
  const id = (role) => view.devices.find((d) => d.role === role)?.id
  return view.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [id(a), id(b)].sort().join())
}

async function fitsEveryWidth(page, label, check = async () => {}) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    await check(width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M7B_SHOTS) await page.screenshot({ path: `${process.env.M7B_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}
// A design tool from the toolbar on an uplink: the tool, then the uplink on the canvas.
async function toolOnUplink(name, uplinkId) {
  await architect.getByRole('button', { name, exact: true }).click()
  // Straight to the uplink: a short one sits under the device nodes on a dense canvas.
  await architect.getByTestId(`rf__edge-${uplinkId}`).dispatchEvent('click')
  const panel = architect.getByTestId('hld-tool-panel')
  await expect(panel.getByTestId('hld-tool-uplink')).toBeVisible()
  return panel
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect]) await p?.context().close()
})

test('set up: a verified survey with three rooms and their pathways; the generated HLD', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m7b3-${RUN_ID}@example.com`, organisationName: 'M7B3 Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M7B3 Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b3-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b3-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  for (const [who, page] of [['owner', owner], ['architect', architect]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  const send = async (page, method, path, data, status) => {
    const res = await page.request[method](`${api}${path}`, data === undefined ? undefined : { data })
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(status)
    return res.json()
  }
  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const created = []
  for (let i = 0; i < 3; i++) created.push((await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)).room)
  rooms = { main: created[0], second: created[1], third: created[2] }
  const racks = []
  for (const room of created) racks.push((await send(fe, 'post', '/survey/racks', { roomId: room.id }, 201)).rack)
  for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms.main.id, toRoomId: rooms.second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms.main.id, toRoomId: rooms.third.id, routeStatus: 'surveyed', distanceM: 30 }, 201)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms.third.id, toRoomId: rooms.second.id, routeStatus: 'surveyed', distanceM: 25 }, 201)
  for (const t of [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...created.flatMap((room) => ROOM_TABS.map((tab) => ({ tab, roomId: room.id })))]) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()
  const v = await hld()
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: v.design.revision }, 201)
  // A cable ID on the Edge–AP uplink and a second AP: for Replace Endpoint.
  const after = await hld()
  await send(architect, 'patch', `/hld/uplinks/${link(after, 'edge', 'ap').id}`, { cableId: 'C-EA-1', baseRevision: after.design.revision }, 200)
  await send(architect, 'post', '/hld/devices', { buildingId: b001, role: 'ap', roomId: rooms.second.id, baseRevision: (await hld()).design.revision }, 201)
})

test('Reroute: Border–Edge through the third room — the length grows; Undo and Redo', async () => {
  await architect.goto(hldUrl())
  const be = link(await hld(), 'border', 'edge')
  const panel = await toolOnUplink('Reroute', be.id)
  await panel.getByLabel('Room to route through').selectOption({ label: rooms.third.code })
  await panel.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(panel).toContainText(`Route: ${rooms.main.code} → ${rooms.third.code} → ${rooms.second.code}`)
  await panel.getByRole('button', { name: 'Reroute', exact: true }).click()
  await expect(panel).toHaveCount(0)
  const routed = async () => link(await hld(), 'border', 'edge')
  await expect.poll(async () => (await routed()).route?.viaRoomIds).toEqual([rooms.third.id])
  expect((await routed()).length.suggestedM).toBeGreaterThan(be.length.suggestedM)
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await routed()).route).toBeNull()
  await architect.getByTitle('Redo').click()
  await expect.poll(async () => (await routed()).route?.viaRoomIds).toEqual([rooms.third.id])
})

test('Replace Endpoint: Edge–AP moves to the second AP with a new cable ID; Undo moves it back', async () => {
  const before = await hld()
  const ea = link(before, 'edge', 'ap')
  const [ap1, ap2] = before.devices.filter((d) => d.role === 'ap')
  const apEnd = ea.source.deviceId === ap1.id ? 'source' : 'dest'
  const panel = await toolOnUplink('Replace Endpoint', ea.id)
  await panel.getByRole('radio', { name: ap1.hostname }).check()
  await panel.getByLabel('New device for this end').selectOption({ label: ap2.hostname })
  await panel.getByRole('button', { name: 'Replace endpoint', exact: true }).click()
  await expect(panel).toHaveCount(0)
  const current = async () => (await hld()).connections.find((c) => c.id === ea.id)
  await expect.poll(async () => (await current())[apEnd].deviceId).toBe(ap2.id)
  const reissued = (await current()).cableId
  expect(reissued).toBeTruthy()
  expect(reissued).not.toBe('C-EA-1')
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await current())[apEnd].deviceId).toBe(ap1.id)
  // Undo keeps the issued ID (C-EA-1 is retired, never reused).
  expect((await current()).cableId).toBe(reissued)
})

test('Split Border–Edge with a new Distribution, then Merge it back out: it stays, unlinked; both Undo', async () => {
  const be = link(await hld(), 'border', 'edge')
  const panel = await toolOnUplink('Split', be.id)
  await panel.getByLabel('Role of the new device').selectOption({ label: 'Distribution' })
  await panel.getByLabel('Room of the new device').selectOption({ label: rooms.main.code })
  await panel.getByRole('button', { name: 'Split uplink', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect.poll(async () => (await hld()).devices.filter((d) => d.role === 'distribution').length).toBe(1)
  const split = await hld()
  const dist = split.devices.find((d) => d.role === 'distribution')
  expect(split.connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(dist.id))).toHaveLength(2)
  expect(split.archivedUplinks.map((a) => a.tool)).toEqual(['split'])

  // Merge: the tool, then the Distribution on the canvas.
  await architect.getByRole('button', { name: 'Merge', exact: true }).click()
  await architect.getByText(dist.hostname, { exact: true }).first().click()
  const merge = architect.getByTestId('hld-tool-panel')
  await expect(merge).toContainText('stays in place, unlinked')
  await merge.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(merge).toHaveCount(0)
  await expect.poll(async () => (await hld()).archivedUplinks.filter((a) => a.tool === 'merge').length).toBe(2)
  const merged = await hld()
  expect(merged.devices.map((d) => d.id)).toContain(dist.id)
  expect(merged.connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(dist.id))).toEqual([])
  expect(link(merged, 'border', 'edge').cableId).toBeTruthy()
  // Undo the merge: the Distribution is back in the path.
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await hld()).connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(dist.id)).length).toBe(2)
})

test('Break Uplink with a reason: archived and listed, "uplink needed" a warning; Undo draws it again — every width', async () => {
  const view = await hld()
  const dist = view.devices.find((d) => d.role === 'distribution')
  const target = view.connections.find((c) => [c.source.deviceId, c.dest.deviceId].includes(dist.id))
  const panel = await toolOnUplink('Break Uplink', target.id)
  await expect(panel.getByRole('button', { name: 'Break uplink', exact: true })).toBeDisabled()
  await panel.getByLabel('Reason for breaking the uplink').fill('Distribution not needed in this phase')
  await panel.getByRole('button', { name: 'Break uplink', exact: true }).click()
  await expect(panel).toHaveCount(0)
  const archived = architect.getByTestId('archived-uplinks')
  await archived.getByText(/^Archived uplinks/).click()
  await expect(archived).toContainText('Broken')
  await expect(archived).toContainText('Distribution not needed in this phase')
  await expect(archived).toContainText('Ada Architect')
  await architect.getByTitle('Validate').click()
  const validation = architect.getByTestId('hld-validation')
  await expect(validation).toContainText('W-UPLINK-NEEDED')
  await expect(validation).toContainText('Distribution not needed in this phase')
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
  await fitsEveryWidth(architect, 'hld-tools', async (width) => {
    if (width >= 768) await expect(architect.getByTestId('archived-uplinks')).toBeVisible()
  })
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await hld()).connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(dist.id)).length).toBe(2)
  await architect.getByTitle('Validate').click()
  await expect(architect.getByTestId('hld-validation')).not.toContainText('W-UPLINK-NEEDED')
})

test('long names are shown whole: the HLD canvas nodes and the LLD device cards — every width', async () => {
  const whole = async (locator) => locator.evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight + 1)
  const host = (await hld()).devices.find((d) => d.role === 'edge').hostname
  await architect.goto(hldUrl())
  const node = architect.locator('.react-flow__node').getByText(host, { exact: true })
  await expect(node).toBeVisible()
  expect(await whole(node)).toBe(true)
  // The LLD: approve the HLD and start it.
  const v = await hld()
  let res = await architect.request.post(`${api}/hld/submit`, { data: { buildingId: b001, baseRevision: v.design.revision } })
  expect(res.status(), await res.text()).toBe(201)
  res = await owner.request.post(`${api}/hld/decision`, { data: { buildingId: b001, decision: 'approved' } })
  expect(res.status(), await res.text()).toBe(200)
  res = await architect.request.post(`${api}/lld/start`, { data: { buildingId: b001 } })
  expect(res.status(), await res.text()).toBe(201)
  await architect.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}/lld`)
  const card = architect.getByRole('button', { name: new RegExp(host) }).first()
  await expect(card).toBeVisible()
  await fitsEveryWidth(architect, 'lld-names', async () => {
    const name = architect.getByText(host, { exact: true }).first()
    if (await name.isVisible()) expect(await whole(name)).toBe(true)
  })
  expect(errors).toEqual([])
})
