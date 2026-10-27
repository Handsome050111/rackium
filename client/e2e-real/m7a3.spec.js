import { test, expect } from '@playwright/test'
import { localDate } from '@rackium/shared/timeZone.js'
import { deployedProject } from './handoverSetup.js'
import { inviteAndAccept } from './surveyHelpers.js'
import { PASSWORD } from './helpers.js'

// M7a-3, real mode: the project and organisation dashboards, the workload
// matrix, analytics and reports (on demand and scheduled) — for the Org Admin
// and for a Viewer scoped to one building, at every width, with the
// keyboard, with no overflow and no console errors; the report link from a
// schedule email needs sign-in and opens the recipient's own copy only.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
let owner
let s
let viewer
const errors = []
const today = localDate(new Date(), 'Europe/Berlin')
const daysAgo = (n) => new Date(Date.UTC(...today.split('-').map((v, i) => Number(v) - (i === 1 ? 1 : 0))) - n * 86400000).toISOString().slice(0, 10)
const home = () => `/orgs/${s.orgId}/projects/${s.projectId}`
const meOf = async (page) => (await (await page.request.get('/api/v1/me')).json()).user.id

async function fitsEveryWidth(page, label, check = async () => {}) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('body')).not.toContainText('Loading…')
    await check(width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M7A_SHOTS) await page.screenshot({ path: `${process.env.M7A_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, viewer, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed; a Viewer scoped to B002; an overdue task and an overdue phase', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm7a3' })
  const b002 = (await (await owner.request.get(`${s.api}/cmo`)).json()).buildings.find((b) => b.code === 'B002').id
  s.b002 = b002
  viewer = await inviteAndAccept(owner, browser, { orgId: s.orgId, projectId: s.projectId, email: `m7a3-viewer-${RUN_ID}@example.com`, role: 'viewer', name: 'Vera Viewer', scopes: [{ type: 'building', refId: b002 }] })
  for (const [who, page] of [['owner', owner], ['viewer', viewer], ['fe', s.fe]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  s.feId = await meOf(s.fe)
  await s.send(owner, 'post', '/tasks', { title: 'Label the racks', buildingId: s.b001, assignedTo: s.feId, deadline: daysAgo(2) }, 201)
  await s.send(owner, 'post', '/tasks', { title: 'Photograph B002', buildingId: b002, assignedTo: s.feId }, 201)
  await s.send(owner, 'put', '/schedule/targets', { targets: [{ buildingId: b002, phaseKey: 'survey', targetDate: daysAgo(10) }] }, 200)
})

test('project dashboard: tiles, buildings by phase (keyboard tooltip), the country/SAL rollup with the BOM value, the team — every width', async () => {
  await owner.goto(`${home()}/dashboard`)
  const page = owner.getByTestId('project-dashboard')
  await expect(page.getByTestId('tile-buildings')).toContainText('2')
  await expect(page.getByTestId('tile-overdue')).toContainText('1')
  await expect(page.getByTestId('overdue-list')).toContainText('B002')
  await expect(page.getByTestId('rollup')).toContainText('BOM value')
  await expect(page.getByTestId('rollup').locator('[data-sal="ERL"]')).toContainText('B001, B002')
  await expect(page.getByTestId('team-people').locator('[data-person="Fiona Field"]')).toContainText('2')
  // The keyboard reaches each bar; its tooltip shows the value.
  const bar = page.getByTestId('by-phase').getByRole('img').first()
  await bar.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await fitsEveryWidth(owner, 'project-dashboard')
  // The sidebar leads to it.
  await owner.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Dashboard' }).click()
  await expect(owner).toHaveURL(new RegExp(`${home()}/dashboard$`))
})

test('a Viewer scoped to B002: their building only, no BOM value, no names, no workload', async () => {
  await viewer.goto(`${home()}/dashboard`)
  const page = viewer.getByTestId('project-dashboard')
  await expect(page.getByTestId('tile-buildings')).toContainText('1')
  await expect(page).toContainText('Your scope: 1 building(s)')
  await expect(page.getByTestId('building-rows')).toContainText('B002')
  await expect(page.getByTestId('building-rows')).not.toContainText('B001')
  await expect(page.getByTestId('rollup')).not.toContainText('BOM value')
  await expect(page.getByTestId('team-people')).toHaveCount(0)
  await expect(page).not.toContainText('Fiona')
  await fitsEveryWidth(viewer, 'project-dashboard-viewer')
  await expect(viewer.getByRole('navigation', { name: 'Project' }).getByRole('link', { name: 'Workload' })).toHaveCount(0)
  await viewer.goto(`${home()}/workload`)
  await expect(viewer.getByRole('alert')).toContainText('for the Org Admin and PMs')
  await viewer.goto(`${home()}/analytics`)
  await expect(viewer.getByTestId('metric-surveyCompletion')).toBeVisible()
  await expect(viewer.getByTestId('by-technician')).toHaveCount(0)
})

test('workload matrix: open and overdue tasks per person and building — every width', async () => {
  await owner.goto(`${home()}/workload`)
  const matrix = owner.getByTestId('workload-matrix')
  await expect(matrix.locator('[data-cell="Fiona Field|B001"]')).toContainText('1 overdue')
  await expect(matrix.locator('[data-cell="Fiona Field|B002"]')).toContainText('1')
  await fitsEveryWidth(owner, 'workload')
})

test('analytics: six metrics with trend lines; the keyboard moves the crosshair; survey completion by technician for the Org Admin', async () => {
  await owner.goto(`${home()}/analytics`)
  for (const id of ['phaseDuration', 'blockerFrequency', 'blockerResolution', 'bomAccuracy', 'bomRevisions', 'surveyCompletion', 'approvalTurnaround']) await expect(owner.getByTestId(`metric-${id}`)).toBeVisible()
  await expect(owner.getByTestId('by-technician')).toContainText('Fiona Field')
  // The approvals of the setup were decided this month: a trend point.
  const trend = owner.getByTestId('trend-approvalTurnaround').locator('svg')
  await trend.focus()
  await owner.keyboard.press('ArrowLeft')
  await expect(owner.getByTestId('trend-approvalTurnaround').getByRole('tooltip')).toBeVisible()
  // Touch / pointer too.
  await trend.hover()
  await expect(owner.getByTestId('trend-approvalTurnaround').getByRole('tooltip')).toBeVisible()
  await owner.getByTestId('trend-approvalTurnaround').getByText('Table').click()
  await expect(owner.getByTestId('trend-approvalTurnaround').locator('table')).toBeVisible()
  await fitsEveryWidth(owner, 'analytics')
})

test('reports: a Weekly Status CSV made from the form becomes ready and downloads; a schedule to a member is saved — every width', async () => {
  await owner.goto(`${home()}/reports`)
  const form = owner.getByTestId('report-form')
  await form.getByLabel('Report').selectOption('weekly-status')
  await form.getByLabel('Format').selectOption('csv')
  await form.getByRole('button', { name: 'Make report' }).click()
  const row = owner.getByTestId('my-reports').locator('li').filter({ hasText: 'Weekly Status report' }).first()
  await expect(row.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 30_000 })
  const csv = await (await owner.request.get(await row.getByRole('link', { name: 'Download' }).getAttribute('href'))).text()
  expect(csv).toContain('Covers 2 building(s)')
  // The price choice appears for the BOM Summary only.
  await form.getByLabel('Report').selectOption('bom-summary')
  await expect(form.getByLabel('Prices')).toBeVisible()
  // Schedule to Fiona (a member, chosen by name — there is no email field).
  const sched = owner.getByTestId('schedule-form')
  await expect(sched.locator('input[type="email"]')).toHaveCount(0)
  await sched.getByLabel('Scheduled report').selectOption('installation-progress')
  await sched.getByLabel('Weekday').selectOption('1')
  await sched.getByRole('checkbox', { name: /Fiona Field/ }).check()
  await sched.getByRole('button', { name: 'Schedule' }).click()
  await expect(owner.getByTestId('report-schedules').locator('[data-recipient="Fiona Field"]')).toBeVisible()
  await expect(owner.getByTestId('report-schedules')).toContainText('Weekly on Monday at 07:00')
  await fitsEveryWidth(owner, 'reports')
  // A Viewer sees no schedules section.
  await viewer.goto(`${home()}/reports`)
  await expect(viewer.getByTestId('report-schedules')).toHaveCount(0)
  await expect(viewer.getByTestId('report-form').getByLabel('Report').locator('option[value="resource-utilisation"]')).toHaveCount(0)
})

test('the link in a report email needs sign-in and opens only the recipient’s own copy', async ({ browser }) => {
  const { document } = await s.send(s.fe, 'post', '/documents', { typeKey: 'survey-progress', format: 'pdf' }, 202)
  const link = `${home()}/reports?document=${document.id}`
  // Signed out: the sign-in page, then back to the report.
  const context = await browser.newContext()
  const fresh = await context.newPage()
  await fresh.goto(link)
  await expect(fresh).toHaveURL(/\/login\?next=/)
  await fresh.getByLabel('Email').fill(`m7a3-fe-${RUN_ID}@example.com`)
  await fresh.getByLabel('Password').fill(PASSWORD)
  await fresh.getByRole('button', { name: 'Sign in' }).click()
  await expect(fresh).toHaveURL(new RegExp(`/reports\\?document=${document.id}$`))
  const row = fresh.locator(`[data-report="${document.id}"]`)
  await expect(row).toHaveClass(/ring-brand/)
  await expect(row.getByRole('link', { name: 'Download' })).toBeVisible({ timeout: 30_000 })
  await context.close()
  // Anyone else — the Org Admin too — is told it is not theirs.
  await owner.goto(link)
  await expect(owner.getByTestId('my-reports')).toContainText('not one of yours')
  expect((await owner.request.get(`${s.api}/documents/${document.id}/download`)).status()).toBe(404)
})

test('organisation dashboard: projects, at risk, the BOM total for the Org Admin; none for the Viewer — every width; no console errors anywhere', async () => {
  await owner.goto(`/orgs/${s.orgId}/dashboard`)
  await expect(owner.getByTestId('org-projects')).toContainText('M7A3 Project')
  await expect(owner.getByTestId('org-projects')).toContainText('At risk')
  await expect(owner.getByTestId('org-bom')).toContainText('Total BOM value')
  await expect(owner.getByTestId('org-people')).toContainText('Fiona Field')
  await fitsEveryWidth(owner, 'org-dashboard')
  await viewer.goto(`/orgs/${s.orgId}/dashboard`)
  await expect(viewer.getByTestId('org-projects')).toContainText('(your scope)')
  await expect(viewer.getByTestId('org-bom')).toHaveCount(0)
  await expect(viewer.getByTestId('org-people')).toHaveCount(0)
  await fitsEveryWidth(viewer, 'org-dashboard-viewer')
  await owner.getByRole('navigation', { name: 'Organisation' }).getByRole('link', { name: 'Organisation dashboard' }).click()
  await expect(owner).toHaveURL(new RegExp(`/orgs/${s.orgId}/dashboard$`))
  expect(errors).toEqual([])
})
