import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'

// M5b, real mode: a PM assigns a task → the assignee is notified (bell) and
// completes it; the Architect submits the HLD → the Reviewer is notified and
// approves → the Architect is notified; the audit log filtered, opened and
// exported; the new screens at every width with no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const RUN_ID = Date.now()
let owner
let architect
let fe
let reviewer
let orgId
let projectId
let b001
let api
const errors = []
const widths = [[1440, 900], [1024, 768], [768, 1024], [390, 844]]

async function send(page, method, path, data, status) {
  const res = await page.request[method](`${api}${path}`, data === undefined ? undefined : { data })
  expect(res.status(), await res.text()).toBe(status)
  return res.json()
}
async function fitsEveryWidth(page, label, { openBell = false } = {}) {
  for (const [width, height] of widths) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    if (openBell) {
      await page.getByRole('button', { name: /^Notifications/ }).click()
      await expect(page.getByRole('dialog', { name: 'Notifications panel' })).toBeVisible()
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M5B_SHOTS) await page.screenshot({ path: `${process.env.M5B_SHOTS}/${label}-${width}.png`, fullPage: true })
    if (openBell) await page.keyboard.press('Escape').catch(() => {})
    if (openBell) await page.mouse.click(5, 300)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, architect, fe, reviewer]) await p?.context().close()
})

test('set up: a project with B001 surveyed and its HLD generated; an Architect, a Field Engineer and a Reviewer', async ({ browser }) => {
  orgId = await signUpAndSignIn(owner, { email: `m5b-${RUN_ID}@example.com`, organisationName: 'M5b Org' })
  projectId = await createProjectWithHierarchy(owner, orgId, { name: 'M5b Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m5b-fe-${RUN_ID}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m5b-arch-${RUN_ID}@example.com`, role: 'architect', name: 'Ada Architect' })
  reviewer = await inviteAndAccept(owner, browser, { orgId, projectId, email: `m5b-rev-${RUN_ID}@example.com`, role: 'reviewer', name: 'Rex Reviewer' })
  // 409/400/401: deliberate refusals shown in the page.
  for (const [who, page] of [['owner', owner], ['architect', architect], ['fe', fe], ['reviewer', reviewer]]) page.on('console', (m) => m.type() === 'error' && !/status of (400|401|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))

  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const { room: main } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const { room: second } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  for (const roomId of [main.id, second.id]) {
    const { rack } = await send(fe, 'post', '/survey/racks', { roomId }, 201)
    await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  }
  await send(architect, 'post', '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  const targets = [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]
  for (const t of targets) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  const hld = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: hld.design.revision }, 201)
})

test('the PM assigns a task; the assignee is notified, opens it from the bell and completes it', async () => {
  // (The survey left notifications for the Architect; the Field Engineer's bell starts here.)
  await fe.goto(`/orgs/${orgId}/tasks`)
  await expect(fe.getByRole('heading', { name: 'My tasks' })).toBeVisible()
  await expect(fe.getByText('Nothing assigned to you.')).toBeVisible()
  const feBefore = (await (await fe.request.get(`/api/v1/orgs/${orgId}/notifications/unread-count`)).json()).unread

  await owner.goto(`/orgs/${orgId}/projects/${projectId}/tasks`)
  await owner.getByRole('button', { name: 'New task' }).click()
  const form = owner.getByTestId('task-form')
  await form.getByLabel('Task title').fill('Photograph rack fronts')
  await form.getByLabel('Task building').selectOption({ label: 'B001 — Building B001' })
  await expect(form.getByLabel('Task assignee').locator('option', { hasText: 'Fiona Field' })).toHaveCount(1)
  await form.getByLabel('Task assignee').selectOption({ label: 'Fiona Field (field_engineer)' })
  await form.getByLabel('Task deadline').fill(new Date().toISOString().slice(0, 10))
  await form.getByRole('button', { name: 'Assign task' }).click()
  await expect(owner.getByText('Assigned "Photograph rack fronts" to Fiona Field')).toBeVisible()
  const row = owner.getByTestId('task-list').locator('li', { hasText: 'Photograph rack fronts' })
  await expect(row).toContainText('Building B001')
  await fitsEveryWidth(owner, 'project-tasks')

  // The assignee: the bell counts it; opening it lands on the task.
  await fe.goto(`/orgs/${orgId}/tasks`)
  await expect(fe.getByTestId('unread-count')).toHaveText(String(feBefore + 1))
  await fe.getByRole('button', { name: /^Notifications/ }).click()
  const panel = fe.getByRole('dialog', { name: 'Notifications panel' })
  await expect(panel).toContainText('Today')
  await panel.getByTestId('notification').filter({ hasText: 'Task assigned: Photograph rack fronts' }).click()
  await expect(fe).toHaveURL(new RegExp(`/orgs/${orgId}/projects/${projectId}/tasks\\?task=`))
  await expect(fe.getByTestId('unread-count')).toHaveCount(feBefore ? 1 : 0)
  const mine = fe.getByTestId('task-list').locator('li', { hasText: 'Photograph rack fronts' })
  await mine.getByLabel('Status of Photograph rack fronts').selectOption('in_progress')
  await expect(fe.getByText('Photograph rack fronts: In progress')).toBeVisible()
  await fe.getByTestId('task-list').locator('li', { hasText: 'Photograph rack fronts' }).getByLabel('Status of Photograph rack fronts').selectOption('complete')
  await expect(fe.getByText('Photograph rack fronts: Complete')).toBeVisible()
  await fe.goto(`/orgs/${orgId}/tasks`)
  await expect(fe.getByText('Nothing assigned to you.')).toBeVisible()
  await fitsEveryWidth(fe, 'my-tasks', { openBell: true })
  // Visible on the building's dashboard too (complete tasks drop off the open list).
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}`)
  await expect(owner.getByTestId('building-tasks')).toContainText('Tasks (0 open)')
})

test('the Architect submits the HLD; the Reviewer is notified and approves; the Architect is notified', async () => {
  await architect.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}/hld`)
  await architect.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(architect.getByText('Awaiting approval').first()).toBeVisible()
  // The Reviewer's bell.
  await reviewer.goto(`/orgs/${orgId}/projects/${projectId}`)
  await expect(reviewer.getByTestId('unread-count')).toHaveText('1')
  await reviewer.getByRole('button', { name: /^Notifications/ }).click()
  await reviewer.getByTestId('notification').filter({ hasText: 'HLD v1 of B001 submitted for approval' }).click()
  await expect(reviewer).toHaveURL(new RegExp(`/buildings/${b001}/hld$`))
  await reviewer.getByRole('button', { name: 'Approve' }).click()
  await expect(reviewer.getByText('Approved').first()).toBeVisible()
  // The Architect hears it.
  await architect.reload()
  await architect.getByRole('button', { name: /^Notifications/ }).click()
  const panel = architect.getByRole('dialog', { name: 'Notifications panel' })
  await expect(panel.getByTestId('notification').first()).toContainText('HLD of B001 approved')
  await expect(panel.getByTestId('notification').first()).toContainText('Rex Reviewer')
  // Mark all read.
  await panel.getByRole('button', { name: 'Mark all read' }).click()
  await expect(architect.getByTestId('unread-count')).toHaveCount(0)
  // Preferences: the Architect takes HLD decisions by email from now on.
  await architect.goto(`/orgs/${orgId}/notifications/preferences`)
  await architect.getByLabel('Delivery for HLD approved').selectOption('both')
  await expect(architect.getByText('Saved — HLD approved: In-app and email')).toBeVisible()
  await architect.reload()
  await expect(architect.getByLabel('Delivery for HLD approved')).toHaveValue('both')
  await fitsEveryWidth(architect, 'preferences')
})

test('the audit log: filtered by action type, an entry opened with its field changes, exported as CSV', async () => {
  await owner.goto(`/orgs/${orgId}/audit`)
  await expect(owner.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  const filters = owner.getByTestId('audit-filters')
  await filters.getByLabel('Audit project').selectOption({ label: 'M5b Project' })
  await filters.getByLabel('Action type').selectOption('task')
  await filters.getByRole('button', { name: 'Apply filters' }).click()
  const rows = owner.getByTestId('audit-row')
  await expect(rows).toHaveCount(3) // created, updated (in progress), completed
  await expect(rows.first()).toContainText('task.completed')
  await expect(rows.first()).toContainText('Fiona Field')
  await rows.first().click()
  const detail = owner.getByTestId('audit-detail')
  await expect(detail.getByTestId('audit-changes')).toContainText('status: in_progress → complete')
  await fitsEveryWidth(owner, 'audit-log')
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Export CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/)
  const text = await (await import('node:fs')).promises.readFile(await file.path(), 'utf8')
  expect(text.replace(/^﻿/, '').split('\r\n')).toHaveLength(4)
  expect(text).toContain('task.completed')
  // The Reviewer reads it too (v2.3 role table), for their project; the Field Engineer does not.
  await reviewer.goto(`/orgs/${orgId}/audit`)
  await expect(reviewer.getByRole('link', { name: 'Audit log' })).toBeVisible()
  await reviewer.getByTestId('audit-filters').getByLabel('Action type').selectOption('task')
  await reviewer.getByTestId('audit-filters').getByRole('button', { name: 'Apply filters' }).click()
  await expect(reviewer.getByTestId('audit-row')).toHaveCount(3)
  await fe.goto(`/orgs/${orgId}/audit`)
  await expect(fe.getByText('The audit log is open to the Org Admin, PMs, Architects and Reviewers.')).toBeVisible()
  await expect(fe.getByRole('link', { name: 'Audit log' })).toHaveCount(0)
})

// Regression (M5b review, found measuring the LLD page load): the desktop and
// tablet sidebar rails each loaded their own data, so every page fetched the
// project list and the building dashboard twice.
test('a page loads the sidebar data once: the project list and the building dashboard', async () => {
  const calls = []
  const onReq = (r) => r.url().includes('/api/') && calls.push(new URL(r.url()).pathname)
  owner.on('request', onReq)
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001}/hld`)
  await expect(owner.getByRole('link', { name: 'B001' }).first()).toBeVisible()
  await owner.waitForLoadState('networkidle')
  owner.off('request', onReq)
  expect(calls.filter((c) => c === `/api/v1/orgs/${orgId}/projects`)).toHaveLength(1)
  expect(calls.filter((c) => c === `/api/v1/orgs/${orgId}/projects/${projectId}/dashboard/buildings/${b001}`)).toHaveLength(1)
})

test('the Org Admin sets the organisation time zone and digest time', async () => {
  await owner.goto(`/orgs/${orgId}/settings`)
  const section = owner.getByTestId('time-zone')
  await expect(section.getByLabel('Organisation time zone')).toHaveValue('Europe/Berlin')
  await expect(section.getByLabel('Daily digest time')).toHaveValue('07:00')
  await section.getByLabel('Organisation time zone').selectOption('America/New_York')
  await section.getByLabel('Daily digest time').fill('06:30')
  await section.getByRole('button', { name: 'Save time zone' }).click()
  await expect(owner.getByTestId('time-zone').getByLabel('Organisation time zone')).toHaveValue('America/New_York')
  await owner.reload()
  await expect(owner.getByTestId('time-zone').getByLabel('Organisation time zone')).toHaveValue('America/New_York')
  await expect(owner.getByTestId('time-zone').getByLabel('Daily digest time')).toHaveValue('06:30')
  await fitsEveryWidth(owner, 'org-settings')
})

test('no console errors on the new screens', async () => {
  expect(errors, errors.join('\n')).toEqual([])
})
