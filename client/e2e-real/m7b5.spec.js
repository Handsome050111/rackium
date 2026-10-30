import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M7b-5, real mode (DATA-MODEL §3.11; v2.2 §3.4): the Architect builds a
// project rule with a live preview, the Org Admin an organisation rule; the
// findings carry the Custom badge in the HLD's validation; a Critical rule
// blocks submit until it is switched off. Every width, no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
let owner
let architect
let orgId
let projectId
let b001
let api
const errors = []
const send = async (page, method, path, data, status) => {
  const res = await page.request[method](`${api}${path}`, data === undefined ? undefined : { data })
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(status)
  return res.json()
}
const hldUrl = () => `/orgs/${orgId}/projects/${projectId}/buildings/${b001}/hld`
const rulesUrl = () => `/orgs/${orgId}/projects/${projectId}/settings?tab=rules`

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

test('set up: a verified survey and the generated HLD', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m7b5-${RUN_ID}@example.com`, organisationName: 'M7B5 Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M7B5 Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b5-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7b5-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  for (const [who, page] of [['owner', owner], ['architect', architect]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const rooms = []
  for (let i = 0; i < 2; i++) rooms.push((await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)).room)
  for (const room of rooms) {
    const { rack } = await send(fe, 'post', '/survey/racks', { roomId: room.id }, 201)
    await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  }
  await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms[0].id, toRoomId: rooms[1].id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  for (const t of [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...rooms.flatMap((room) => ROOM_TABS.map((tab) => ({ tab, roomId: room.id })))]) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  await fe.context().close()
  const v = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: v.design.revision }, 201)
})

test('the Architect builds a project rule: what is missing is said, the preview flags the Edge, the rule is saved — every width', async () => {
  await architect.goto(rulesUrl())
  const panel = architect.getByTestId('project-rules')
  await expect(panel).toContainText('No project rules yet.')
  await panel.getByRole('button', { name: 'Add a rule' }).click()
  const form = architect.getByTestId('rule-form')
  // Nothing filled in: saving says what is missing, and nothing is sent.
  await form.getByRole('button', { name: 'Save rule' }).click()
  await expect(form).toContainText('Name the rule')
  await expect(form).toContainText('Enter a number')
  await form.getByLabel('Rule name').fill('Edge without redundancy')
  await form.getByLabel('Only this role').selectOption('edge')
  await form.getByLabel('If its').selectOption('uplinkCount')
  await form.getByLabel('Condition').selectOption('lte')
  await form.getByLabel('Value').fill('2')
  await form.getByLabel('Then show as').selectOption('warning')
  // A placeholder that does not exist is refused where it is typed.
  await form.getByLabel('Message (optional)').fill('{rack_label}')
  await form.getByRole('button', { name: 'Preview' }).click()
  await expect(form).toContainText('{rack_label} is not available here')
  await form.getByLabel('Message (optional)').fill('Edge switch {hostname} has {value} uplinks')
  await form.getByRole('button', { name: 'Preview' }).click()
  const preview = form.getByTestId('rule-preview')
  await expect(preview.getByRole('status')).toHaveText('Would flag 1 item in the HLD now.')
  await expect(preview).toContainText(/Edge switch E-DE-ERL-C01-B001-EG-\d{3} has 2 uplinks/)
  await fitsEveryWidth(architect, 'm7b5-builder', async () => expect(architect.getByTestId('rule-form')).toBeVisible())
  await form.getByRole('button', { name: 'Save rule' }).click()
  await expect(form).toHaveCount(0)
  await expect(panel).toContainText('Edge without redundancy')
  await expect(panel).toContainText('Device (Edge) · Uplink count is at most 2')
})

test('the Org Admin builds an organisation rule; the project shows it read-only; the Architect cannot change it', async () => {
  await owner.goto(`/orgs/${orgId}/settings`)
  const panel = owner.getByTestId('org-rules')
  await panel.getByRole('button', { name: 'Add a rule' }).click()
  const form = owner.getByTestId('rule-form')
  await form.getByLabel('Rule name').fill('Racks must be 48U')
  await form.getByLabel('Checks each').selectOption('rack')
  await form.getByLabel('If its').selectOption('heightU')
  await form.getByLabel('Condition').selectOption('neq')
  await form.getByLabel('Value').fill('48')
  await form.getByLabel('Then show as').selectOption('critical')
  await form.getByLabel('Message (optional)').fill('Rack {rack_label} is {value}U')
  // Tried on a building of a project of the organisation's.
  await form.getByLabel('Try it on').selectOption({ label: 'M7B5 Project · B001' })
  await form.getByRole('button', { name: 'Preview' }).click()
  await expect(form.getByTestId('rule-preview').getByRole('status')).toHaveText('Would flag 2 items in the HLD now.')
  await form.getByRole('button', { name: 'Save rule' }).click()
  await expect(panel).toContainText('Racks must be 48U')
  await fitsEveryWidth(owner, 'm7b5-org-rules', async () => expect(owner.getByTestId('org-rules')).toBeVisible())
  await architect.goto(rulesUrl())
  const inherited = architect.getByTestId('inherited-rules')
  await expect(inherited).toContainText('Racks must be 48U')
  await expect(inherited.getByRole('button', { name: 'Edit' })).toHaveCount(0)
})

test('in the HLD: Custom findings with their messages; the Critical rule blocks submit until it is switched off — every width', async () => {
  await architect.goto(hldUrl())
  await architect.getByRole('button', { name: 'Validate', exact: true }).click()
  const findings = architect.getByTestId('hld-validation')
  await expect(findings.getByTestId('custom-badge').first()).toHaveText('Custom')
  await expect(findings).toContainText('Racks must be 48U')
  await expect(findings).toContainText(/Rack R\d+ is 42U/)
  await expect(findings).toContainText('Edge without redundancy')
  await expect(architect.getByText(/Critical finding\(s\) must be fixed before submitting/)).toBeVisible()
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeDisabled()
  await fitsEveryWidth(architect, 'm7b5-hld-findings', async () => expect(architect.getByTestId('mode-toggles')).toBeVisible())
  // Off: Submit is open again.
  await owner.getByTestId('org-rules').getByLabel('Racks must be 48U on').click()
  await expect(owner.getByTestId('org-rules').getByText('Off', { exact: true })).toBeVisible()
  await architect.reload()
  await expect(architect.getByRole('button', { name: 'Submit for approval' })).toBeEnabled()
  // Edited and deleted by the Architect: gone from the list.
  await architect.goto(rulesUrl())
  const panel = architect.getByTestId('project-rules')
  await panel.getByRole('button', { name: 'Edit' }).click()
  await architect.getByTestId('rule-form').getByLabel('Value').fill('1')
  await architect.getByTestId('rule-form').getByRole('button', { name: 'Save rule' }).click()
  await expect(panel).toContainText('Uplink count is at most 1')
  await panel.getByRole('button', { name: 'Delete', exact: true }).click()
  await panel.getByRole('button', { name: 'Delete for good' }).click()
  await expect(panel).toContainText('No project rules yet.')
  expect(errors).toEqual([])
})
