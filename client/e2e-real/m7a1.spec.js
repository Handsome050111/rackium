import { test, expect } from '@playwright/test'
import { localDate, addDays } from '@rackium/shared/timeZone.js'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept } from './surveyHelpers.js'

// M7a-1, real mode: the Org Admin plans the schedule — targets through the
// panel (keyboard) and by dragging a bar, standard and custom milestones, a
// cross-building dependency (a cycle refused), an SLA with its burn-down,
// the primary Field Engineer; the Architect reads it all; the dashboard
// shows the next milestone; the Gantt at 1440/1024/768 and the list at 390
// with no overflow and no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
const today = localDate(new Date(), 'Europe/Berlin')
let owner
let architect
let fe
let orgId
let projectId
let b001
let b002
let api
const errors = []
const schedulePath = () => `/orgs/${orgId}/projects/${projectId}/schedule`
const barOf = async (page, key) => (await (await page.request.get(`${api}/schedule`)).json()).bars.find((b) => b.key === key)

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect, fe]) await p?.context().close()
})

test('set up: a project with B001 and B002, an Architect and a Field Engineer', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m7a1-${RUN_ID}@example.com`, organisationName: 'M7a1 Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M7a1 Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  const buildings = (await (await owner.request.get(`${api}/cmo`)).json()).buildings
  b001 = buildings.find((b) => b.code === 'B001').id
  b002 = buildings.find((b) => b.code === 'B002').id
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7a1-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m7a1-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  // 409: the deliberate cycle refusal, shown in the page.
  for (const [who, page] of [['owner', owner], ['architect', architect]]) page.on('console', (m) => m.type() === 'error' && !/status of 409/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
})

test('the Org Admin sets targets in the panel and drags a bar; the Gantt follows', async () => {
  await owner.goto(`/orgs/${orgId}/projects/${projectId}`)
  await owner.getByRole('link', { name: 'Schedule' }).click()
  await expect(owner.getByRole('heading', { name: 'Schedule' })).toBeVisible()
  await expect(owner.getByTestId('gantt')).toBeVisible()
  await expect(owner.getByTestId('gantt-today')).toBeVisible()

  const panel = owner.getByTestId('targets-panel')
  await panel.getByLabel('Building').selectOption({ label: 'B001' })
  await panel.getByLabel('CMO target').fill(addDays(today, 7))
  await panel.getByLabel('Physical Site Survey target').fill(addDays(today, 21))
  await panel.getByRole('button', { name: 'Save targets' }).click()
  await expect(owner.getByText('Saved 2 targets for B001')).toBeVisible()
  // Survey starts where CMO ends (no start of its own).
  await expect(panel.getByText(`from ${addDays(today, 7)}`)).toBeVisible()
  const survey = owner.locator(`[data-bar="${b001}|survey"]`)
  await expect(survey).toBeVisible()
  await expect(survey).toHaveAttribute('title', new RegExp(`${addDays(today, 7)} → ${addDays(today, 21)}`))

  // Drag the survey bar a week later (18 px a day in the week zoom).
  await survey.scrollIntoViewIfNeeded()
  const box = await survey.boundingBox()
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await owner.mouse.down()
  for (let i = 1; i <= 7; i++) await owner.mouse.move(box.x + box.width / 2 + i * 18, box.y + box.height / 2)
  await owner.mouse.up()
  await expect(owner.getByText(`B001 Physical Site Survey: ${addDays(today, 14)} → ${addDays(today, 28)}`)).toBeVisible()
  const moved = await barOf(owner, `${b001}|survey`)
  expect([moved.startDate, moved.target]).toEqual([addDays(today, 14), addDays(today, 28)])

  // The primary Field Engineer of B001.
  await panel.getByLabel('Primary Field Engineer').selectOption({ label: 'Fiona Field' })
  await expect(owner.getByText('Primary Field Engineer: Fiona Field')).toBeVisible()
})

test('milestones, a dependency between buildings (a cycle refused), an SLA and its burn-down', async () => {
  const ms = owner.getByTestId('milestones-panel')
  await ms.getByLabel('Milestone name').fill('Kick-off with the client')
  await ms.getByLabel('Milestone due date').fill(addDays(today, 3))
  await ms.getByRole('button', { name: 'Add' }).click()
  await expect(owner.getByText('Added milestone "Kick-off with the client"')).toBeVisible()
  await expect(ms.locator('[data-milestone="Kick-off with the client"]')).toContainText('Project')
  // Dated milestones only, until a building is chosen (then all of its own).
  await expect(ms.locator('[data-milestone="BOM Approved"]')).toHaveCount(0)
  await ms.getByLabel('Show milestones for').selectOption({ label: 'B002 (all)' })
  await expect(ms.locator('[data-milestone="BOM Approved"]')).toHaveCount(1)
  await expect(ms.locator('[data-milestone="Kick-off with the client"]')).toHaveCount(0)
  await ms.getByLabel('Show milestones for').selectOption({ label: 'All dated' })
  // Standard milestone: due from the phase target, overridable.
  const surveyDue = ms.getByLabel('Survey Complete B001 due')
  await expect(surveyDue).toHaveValue(addDays(today, 28))
  await surveyDue.fill(addDays(today, 30))
  await expect(owner.getByText(`Survey Complete: due ${addDays(today, 30)}`)).toBeVisible()
  await expect(owner.getByText(`Next milestone: Kick-off with the client · ${addDays(today, 3)}`)).toBeVisible()

  const deps = owner.getByTestId('dependencies-panel')
  await deps.getByLabel('Dependent building').selectOption({ label: 'B002' })
  await deps.getByLabel('Dependent phase').selectOption({ label: 'CMO' })
  await deps.getByLabel('Prerequisite building').selectOption({ label: 'B001' })
  await deps.getByLabel('Prerequisite phase').selectOption({ label: 'Physical Site Survey' })
  await deps.getByRole('button', { name: 'Add' }).click()
  await expect(owner.getByText('Dependency added')).toBeVisible()
  await expect(deps.locator('li', { hasText: 'waits for' })).toContainText('B002 CMO waits for B001 Physical Site Survey')
  // The way back would be a loop.
  await deps.getByLabel('Dependent building').selectOption({ label: 'B001' })
  await deps.getByLabel('Dependent phase').selectOption({ label: 'CMO' })
  await deps.getByLabel('Prerequisite building').selectOption({ label: 'B002' })
  await deps.getByLabel('Prerequisite phase').selectOption({ label: 'CMO' })
  await deps.getByRole('button', { name: 'Add' }).click()
  await expect(owner.getByRole('alert')).toContainText(/loop|cycle/i)
  await expect(deps.locator('li', { hasText: 'waits for' })).toHaveCount(1)

  const sla = owner.getByTestId('sla-panel')
  await sla.getByLabel('SLA name').fill('Surveys within a month')
  await sla.getByLabel('SLA phase').selectOption({ label: 'Physical Site Survey' })
  await sla.getByLabel('SLA due date').fill(addDays(today, 30))
  await sla.getByRole('button', { name: 'Add SLA' }).click()
  await expect(owner.getByText('Added SLA "Surveys within a month"')).toBeVisible()
  const row = sla.locator('[data-sla="Surveys within a month"]')
  await expect(row).toContainText('On track')
  await expect(row).toContainText('0/2 done')
  await row.getByRole('button', { name: 'Burn-down' }).click()
  await expect(row.getByTestId('burndown').locator('svg')).toBeVisible()
  await expect(row.getByText('Remaining (actual)')).toBeVisible()
  await row.getByRole('button', { name: 'Show table' }).click()
  await expect(row.getByRole('row', { name: new RegExp(today) })).toContainText('2')

  // The dashboard's next milestone.
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}`)
  await expect(owner.getByText(`Kick-off with the client · ${addDays(today, 3)} (project)`)).toBeVisible()
})

test('the Architect reads the schedule: no editing, no dragging', async () => {
  await architect.goto(schedulePath())
  await expect(architect.getByTestId('gantt')).toBeVisible()
  const survey = architect.locator(`[data-bar="${b001}|survey"]`)
  await expect(survey).toHaveAttribute('title', new RegExp(`${addDays(today, 14)} → ${addDays(today, 28)}`))
  await expect(architect.getByRole('button', { name: 'Save targets' })).toHaveCount(0)
  await expect(architect.getByLabel('Milestone name')).toHaveCount(0)
  await expect(architect.getByLabel('SLA name')).toHaveCount(0)
  await expect(architect.getByTestId('schedule-settings')).toHaveCount(0)
  await expect(architect.getByTestId('targets-panel').getByLabel('CMO target')).toBeDisabled()
  await expect(architect.getByTestId('targets-panel')).toContainText('Fiona Field')
  // A drag does nothing.
  await survey.scrollIntoViewIfNeeded()
  const box = await survey.boundingBox()
  await architect.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await architect.mouse.down()
  await architect.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2)
  await architect.mouse.up()
  expect((await barOf(architect, `${b001}|survey`)).target).toBe(addDays(today, 28))
  // The API agrees.
  const res = await architect.request.put(`${api}/schedule/targets`, { data: { targets: [{ buildingId: b001, phaseKey: 'cmo', targetDate: today }] } })
  expect(res.status()).toBe(403)
})

test('the Gantt at 1440/1024/768 and the list on a phone, no overflow, no console errors', async () => {
  await owner.goto(schedulePath())
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await owner.setViewportSize({ width, height })
    await expect(owner.locator('body')).not.toContainText('Loading…')
    if (width >= 768) {
      await expect(owner.getByTestId('gantt')).toBeVisible()
      await expect(owner.getByTestId('targets-panel')).toBeVisible()
      // A one-day bar (CMO: no start) has no clipped label; the Today tag sits clear of the week labels.
      await expect(owner.locator(`[data-bar="${b001}|cmo"]`)).toHaveText('')
      const tag = await owner.getByTestId('gantt-today-label').boundingBox()
      for (const tick of await owner.getByTestId('gantt-tick').all()) {
        const t = await tick.boundingBox()
        if (t) expect(tag.y >= t.y + t.height - 1 || tag.x >= t.x + t.width || tag.x + tag.width <= t.x, `Today tag over ${await tick.textContent()} at ${width}px`).toBe(true)
      }
    } else {
      await expect(owner.getByTestId('gantt')).toHaveCount(0)
      await expect(owner.getByTestId('schedule-list')).toBeVisible()
      await expect(owner.getByTestId('schedule-list').locator(`[data-row="${b001}|survey"]`)).toContainText(`${addDays(today, 14)} → ${addDays(today, 28)}`)
      await expect(owner.getByTestId('targets-panel')).toHaveCount(0)
    }
    const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `schedule at ${width}px`).toBe(0)
    if (process.env.M7A_SHOTS) await owner.screenshot({ path: `${process.env.M7A_SHOTS}/schedule-${width}.png`, fullPage: true })
  }
  await owner.setViewportSize({ width: 1440, height: 900 })
  // The list view on a wide screen.
  await owner.getByRole('button', { name: 'List' }).click()
  await expect(owner.getByTestId('schedule-list')).toContainText('Critical')
  expect(errors).toEqual([])
})
