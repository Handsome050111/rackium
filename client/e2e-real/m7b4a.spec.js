import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M7b-4a, real mode (addendum v2.3 Q5; DATA-MODEL §5.21): the CMO / IMO / FMO
// toggles and the CMO ghost overlay on the HLD canvas, a CMO device's decision
// (Keep / Replace / Remove) with Undo and Redo, interim kit, the state labels
// configured in Project settings, and the toggles on the LLD canvas. Every
// width, no console errors. All names and serials are synthetic.

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
const node = (page, name) => page.locator('.react-flow__node-device > div').filter({ hasText: name })
const send = async (page, method, path, data, status) => {
  const res = await page.request[method](`${api}${path}`, data === undefined ? undefined : { data })
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(status)
  return res.json()
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

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect]) await p?.context().close()
})

test('set up: a verified survey with two rooms, two CMO switches imported, the generated HLD', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m7b4a-${RUN_ID}@example.com`, organisationName: 'M7B4A Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M7B4A Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  const cmo = await (await owner.request.get(`${api}/cmo`)).json()
  b001 = cmo.buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b4a-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b4a-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  for (const [who, page] of [['owner', owner], ['architect', architect]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const created = []
  for (let i = 0; i < 2; i++) created.push((await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)).room)
  rooms = { main: created[0], second: created[1] }
  const racks = []
  for (const room of created) racks.push((await send(fe, 'post', '/survey/racks', { roomId: room.id }, 201)).rack)
  for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms.main.id, toRoomId: rooms.second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  for (const t of [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...created.flatMap((room) => ROOM_TABS.map((tab) => ({ tab, roomId: room.id })))]) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()
  const row = (i, hostname, serial) => ({ rowIndex: i, hostname, vendor: null, model: 'Legacy Switch 48', serial, mac: null, building: 'B001', floor: null, room: rooms.main.code, rack: null, ru: null })
  await send(owner, 'post', '/cmo/import', { salId: cmo.sals.find((s) => s.code === 'ERL').id, rows: [row(0, 'OLD-SW-01', 'SYN-E2E-001'), row(1, 'OLD-SW-02', 'SYN-E2E-002')], fileName: 'cmo.xlsx' }, 201)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: (await hld()).design.revision }, 201)
})

test('the canvas: CMO hidden by default; overlaid it is a ghost with its decision; shown it is solid — every width', async () => {
  await architect.goto(hldUrl())
  const toggles = architect.getByTestId('mode-toggles')
  await expect(toggles).toBeVisible()
  await expect(node(architect, 'OLD-SW-01')).toHaveCount(0)
  await toggles.getByRole('radio', { name: 'Overlay CMO' }).click()
  await expect(node(architect, 'OLD-SW-01')).toHaveAttribute('data-ghost', 'true')
  await expect(node(architect, 'OLD-SW-01')).toHaveAttribute('data-mode-badge', 'CMO')
  await expect(node(architect, 'OLD-SW-01')).toContainText('No decision yet')
  await fitsEveryWidth(architect, 'm7b4a-hld-overlay', async () => {
    await expect(toggles.getByRole('radio', { name: 'Overlay CMO' })).toHaveAttribute('aria-checked', 'true')
    await expect(node(architect, 'OLD-SW-02')).toBeVisible()
  })
  await toggles.getByRole('radio', { name: 'Show CMO' }).click()
  await expect(node(architect, 'OLD-SW-01')).not.toHaveAttribute('data-ghost', 'true')
  // Undecided CMO gear is a warning in the validation, never a block.
  const v = await (await architect.request.get(`${api}/hld/buildings/${b001}/validation`)).json()
  expect(v.findings.filter((f) => f.rule === 'W-NO-DECISION')).toHaveLength(2)
  expect(v.summary.blocksSubmit).toBe(false)
})

test('a CMO device’s decision: Keep with a role (the new name previewed), Replace by the Edge, Remove; Undo and Redo — every width', async () => {
  await node(architect, 'OLD-SW-01').click()
  const panel = architect.getByTestId('cmo-decision')
  await expect(panel).toContainText('SYN-E2E-001')
  await expect(panel.getByTestId('cmo-decision-text')).toHaveText('No decision yet')
  await panel.getByRole('radio', { name: 'Keep' }).click()
  await panel.getByLabel('Role in the future design').selectOption('edge')
  await panel.getByRole('button', { name: 'Save decision' }).click()
  await expect(architect.getByTestId('cmo-decision').getByTestId('cmo-decision-text')).toHaveText(/^Keep → E-DE-ERL-C01-B001-EG-\d{3}$/)
  // Kept: part of the future design — badge CMO → FMO, still there with CMO hidden.
  await expect(node(architect, 'OLD-SW-01')).toHaveAttribute('data-mode-badge', 'CMO → FMO')
  await architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Hide CMO' }).click()
  await expect(node(architect, 'OLD-SW-01')).toBeVisible()
  await expect(node(architect, 'OLD-SW-02')).toHaveCount(0)
  await architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Show CMO' }).click()
  await fitsEveryWidth(architect, 'm7b4a-cmo-decision', async (width) => {
    if (width >= 768) await expect(architect.getByTestId('cmo-decision')).toBeVisible()
  })
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await hld()).cmoDevices.find((d) => d.hostname === 'OLD-SW-01').cmoDecision).toBeNull()
  await architect.getByTitle('Redo').click()
  await expect.poll(async () => (await hld()).cmoDevices.find((d) => d.hostname === 'OLD-SW-01').cmoDecision?.decision).toBe('keep')

  // Replace the second by the Edge, then Remove it.
  const edge = (await hld()).devices.find((d) => d.role === 'edge')
  await node(architect, 'OLD-SW-02').click()
  const second = architect.getByTestId('cmo-decision')
  await second.getByRole('radio', { name: 'Replace' }).click()
  await second.getByLabel('Replaced by').selectOption(edge.id)
  await second.getByRole('button', { name: 'Save decision' }).click()
  await expect(architect.getByTestId('cmo-decision').getByTestId('cmo-decision-text')).toHaveText(`Replaced by ${edge.hostname}`)
  await expect(node(architect, 'OLD-SW-02')).toContainText(`Replaced by ${edge.hostname}`)
  await architect.getByTestId('cmo-decision').getByRole('radio', { name: 'Remove' }).click()
  await architect.getByTestId('cmo-decision').getByRole('button', { name: 'Save decision' }).click()
  await expect(architect.getByTestId('cmo-decision').getByTestId('cmo-decision-text')).toHaveText('Remove (CMO only)')
  await architect.getByTitle('Undo').click()
  await expect.poll(async () => (await hld()).cmoDevices.find((d) => d.hostname === 'OLD-SW-02').cmoDecision?.decision).toBe('replace')
  const v = await (await architect.request.get(`${api}/hld/buildings/${b001}/validation`)).json()
  expect(v.findings.filter((f) => f.rule === 'W-NO-DECISION')).toEqual([])
})

test('interim kit: a device made IMO carries the badge and hides with IMO; an IMO link is dotted and labelled', async () => {
  const ap = (await hld()).devices.find((d) => d.role === 'ap')
  await node(architect, ap.hostname).click()
  await architect.getByTestId('hld-device').getByLabel('Device mode state').selectOption('interim')
  await expect(node(architect, ap.hostname)).toHaveAttribute('data-mode-badge', 'IMO')
  // Its FMO link to the Edge is now Critical: made IMO in the Edit Uplink wizard.
  const v = await hld()
  const edge = v.devices.find((d) => d.role === 'edge')
  const ea = v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [edge.id, ap.id].sort().join())
  const val = await (await architect.request.get(`${api}/hld/buildings/${b001}/validation`)).json()
  expect(val.findings.find((f) => f.rule === 'E-MODE-LINK')?.objectId).toBe(ea.id)
  await architect.getByTestId(`rf__edge-${ea.id}`).dispatchEvent('click')
  const wizard = architect.getByTestId('edit-uplink')
  await wizard.getByLabel('Uplink mode state').selectOption('interim')
  // Step 4: the check passes for an IMO link, then save.
  await wizard.getByRole('button', { name: /Validate$/ }).click()
  await wizard.getByRole('button', { name: 'Run NexAI validation' }).click()
  await wizard.getByRole('button', { name: 'Save uplink' }).click()
  await expect.poll(async () => (await hld()).connections.find((c) => c.id === ea.id).modeState).toBe('interim')
  await expect(architect.getByTestId(`rf__edge-${ea.id}`)).toBeAttached()
  await expect(architect.locator('.react-flow__edgelabel-renderer')).toContainText('IMO')
  // IMO hidden: the device and its link leave the canvas.
  await architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Hide IMO' }).click()
  await expect(node(architect, ap.hostname)).toHaveCount(0)
  await expect(architect.getByTestId(`rf__edge-${ea.id}`)).toHaveCount(0)
  await architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Show IMO' }).click()
  await expect(node(architect, ap.hostname)).toBeVisible()
})

test('the labels are configuration: Project settings sets As-Is / Transition / To-Be; the HLD and the CMO page use them; cleared again', async () => {
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/settings`)
  const form = owner.getByTestId('mode-labels')
  await form.getByLabel('Label: what exists today').fill('As-Is')
  await form.getByLabel('Label: temporary, during the migration').fill('Transition')
  await form.getByLabel('Label: the target design').fill('To-Be')
  await form.getByRole('button', { name: 'Save labels' }).click()
  await expect(form.getByRole('status')).toHaveText('Saved.')
  await fitsEveryWidth(owner, 'm7b4a-labels', async () => expect(owner.getByTestId('mode-labels')).toBeVisible())
  await architect.goto(hldUrl())
  await expect(architect.getByTestId('mode-toggles')).toContainText('As-Is')
  await expect(architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Overlay As-Is' })).toBeVisible()
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}/cmo`)
  await expect(owner.getByRole('heading', { name: 'As-Is Inventory Validation' })).toBeVisible()
  // Cleared: back to CMO / IMO / FMO.
  await send(owner, 'patch', '/mode-labels', { modeLabels: { current: null, interim: null, future: null } }, 200)
  await architect.reload()
  await expect(architect.getByTestId('mode-toggles').getByRole('radio', { name: 'Overlay CMO' })).toBeVisible()
})

test('the LLD canvas has the same toggles: CMO gear overlaid with its decision — every width', async () => {
  // The interim AP back to FMO, the HLD approved, the LLD started.
  const ap = (await hld()).devices.find((d) => d.role === 'ap')
  await send(architect, 'patch', `/hld/devices/${ap.id}`, { modeState: 'future', baseRevision: (await hld()).design.revision }, 200)
  await send(owner, 'patch', '', { activePhaseKeys: ['cmo', 'survey', 'hld', 'lld'] }, 200)
  await send(architect, 'post', '/hld/submit', { buildingId: b001, baseRevision: (await hld()).design.revision }, 201)
  await send(owner, 'post', '/hld/decision', { buildingId: b001, decision: 'approved' }, 200)
  await send(architect, 'post', '/lld/start', { buildingId: b001 }, 201)
  await architect.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}/lld`)
  const toggles = architect.getByTestId('mode-toggles')
  await expect(toggles).toBeVisible()
  await expect(node(architect, 'OLD-SW-02')).toHaveCount(0)
  await toggles.getByRole('radio', { name: 'Overlay CMO' }).click()
  await expect(node(architect, 'OLD-SW-02')).toHaveAttribute('data-ghost', 'true')
  await expect(node(architect, 'OLD-SW-02')).toContainText('Replaced by')
  await fitsEveryWidth(architect, 'm7b4a-lld-overlay', async () => expect(node(architect, 'OLD-SW-01')).toBeVisible())
  expect(errors).toEqual([])
})
