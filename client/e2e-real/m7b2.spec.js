import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as XLSX from 'xlsx'
import { deployedProject } from './handoverSetup.js'

// M7b-2, real mode (addendum v2.3 Q5; DATA-MODEL §5.19): an installed switch
// renamed through a change request end to end — the Architect renames it on
// the branch, the PM sends it, the client approves; its old name is kept and
// shown "old → new" in the LLD, deployment, CMDB, search, the CMDB export and
// the audit export; the primary Field Engineer gets the reprint-label task,
// prints the label sheet for its cables and completes it. Every width, no
// overflow, no console errors.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
const NEW_NAME = 'E-DE-ERL-C01-B001-EG-009'
let owner
let s
let oldName
const errors = []
const home = () => `/orgs/${s.orgId}/projects/${s.projectId}`
const base = () => `${home()}/buildings/${s.b001}`
const renamed = () => `${oldName} → ${NEW_NAME}`

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
async function pdfText(path) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path)), useSystemFonts: true, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '))
  return pages
}
const flat = (pages) => pages.join(' ').replace(/\s+/g, '')

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed and accepted; the Field Engineer is its primary Field Engineer', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm7b2' })
  for (const [who, page] of [['owner', owner], ['architect', s.architect], ['fe', s.fe]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  oldName = s.deployment.devices.find((d) => d.role === 'edge').hostname
  const feId = (await (await s.fe.request.get('/api/v1/me')).json()).user.id
  await s.send(owner, 'patch', `/schedule/buildings/${s.b001}/assignees`, { primaryFieldEngineerId: feId }, 200)
})

test('the Architect renames the installed Edge on a change request branch (preview, apply); the PM sends it; the client approves', async ({ browser }) => {
  const architect = s.architect
  await architect.goto(`${base()}/solution-package`)
  const panel = architect.getByTestId('change-requests')
  await panel.getByRole('button', { name: 'New change request' }).click()
  await panel.getByLabel('Change request title').fill('Rename to the client naming')
  await panel.getByLabel('Change request reason').fill('Client naming convention')
  await panel.getByRole('button', { name: 'Create' }).click()
  await expect(panel.getByTestId('change-request-detail')).toContainText('CR-1 · Draft')
  await panel.getByRole('link', { name: 'Edit the LLD on its branch' }).click()
  await expect(architect.getByTestId('lld-frozen')).toContainText("This is a change request's branch")
  await architect.getByRole('button', { name: 'Rename hostnames' }).click()
  const dialog = architect.getByRole('dialog', { name: 'Rename hostnames' })
  await dialog.getByLabel(`New hostname for ${oldName}`).fill(NEW_NAME)
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByTestId('rename-preview')).toContainText(NEW_NAME)
  await dialog.getByRole('button', { name: 'Apply 1 rename' }).click()
  await expect(dialog).toHaveCount(0)
  // The change request's diff names the rename; submitted, sent, approved.
  await architect.goto(`${base()}/solution-package`)
  await architect.getByTestId('change-requests').getByRole('button', { name: /CR-1 Rename to the client naming/ }).click()
  const detail = architect.getByTestId('change-request-detail')
  await expect(detail).toContainText(NEW_NAME)
  await detail.getByRole('button', { name: 'Submit change request' }).click()
  await expect(detail).toContainText('CR-1 · Submitted')
  await owner.goto(`${base()}/solution-package`)
  await owner.getByTestId('change-requests').getByRole('button', { name: /CR-1 Rename to the client naming/ }).click()
  const pmDetail = owner.getByTestId('change-request-detail')
  await pmDetail.getByRole('button', { name: 'Send to the client' }).click()
  await expect(pmDetail.locator('input[readonly]').first()).toHaveValue(/\/approve\//)
  const values = await pmDetail.locator('input[readonly]').evaluateAll((els) => els.map((e) => e.value))
  const client = await (await browser.newContext()).newPage()
  await client.goto(new URL(values[0]).pathname)
  await client.getByLabel('Password').fill(values[1])
  await client.getByRole('button', { name: 'View Change request' }).click()
  await client.getByPlaceholder('Your full name').fill('Clara Client')
  await client.getByRole('checkbox').check()
  await client.getByRole('button', { name: 'Approve' }).click()
  await expect(client.getByTestId('decision-recorded')).toContainText('You approved this Change request.')
  await client.context().close()
})

test('"old → new" in the LLD, the deployment tree and the CMDB, and search finds the old name — every width', async () => {
  await owner.goto(`${base()}/lld`)
  await expect(owner.locator('body')).toContainText(renamed())
  await fitsEveryWidth(owner, 'lld-renamed')
  await owner.goto(`${base()}/deployment`)
  const tree = owner.getByTestId('location-tree')
  await expect(tree.getByRole('button', { name: new RegExp(`^${renamed()}`) })).toBeVisible()
  // Shown whole, not cut off: the engineer finds the device on site by its old name.
  await fitsEveryWidth(owner, 'deployment-renamed', async () => {
    const name = owner.getByTestId('location-tree').getByRole('button', { name: new RegExp(`^${renamed()}`) }).locator('span').first()
    await expect(name).toHaveText(renamed())
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  })
  await owner.goto(`${base()}/cmdb`)
  await expect(owner.locator('table').first()).toContainText(renamed())
  await owner.locator('table').first().getByText(renamed()).click()
  await expect(owner.locator('body')).toContainText('Legacy hostname')
  await fitsEveryWidth(owner, 'cmdb-renamed')
  // The Excel export carries the old name in its own column.
  const download = owner.waitForEvent('download')
  await owner.getByRole('button', { name: 'Excel' }).click()
  const book = XLSX.read(fs.readFileSync(await (await download).path()))
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 })
  expect(rows[0].slice(0, 2)).toEqual(['Hostname', 'Legacy hostname'])
  expect(rows.find((r) => r[0] === NEW_NAME)?.[1]).toBe(oldName)
  // Search: the old name finds the switch, shown old → new.
  const box = owner.locator('input[role="combobox"]:visible')
  await box.fill(oldName)
  const results = owner.locator('[data-testid="search-results"]:visible')
  await expect(results).not.toContainText('Searching…')
  await expect(results).toContainText(renamed())
  await expect(results).toContainText('Old hostname')
  // The audit export holds the rename and the kept name.
  const audit = await (await owner.request.get(`/api/v1/orgs/${s.orgId}/audit/export.csv?projectId=${s.projectId}`)).text()
  for (const text of ['device.hostname.renamed', 'device.legacy_hostname.set', oldName, NEW_NAME]) expect(audit).toContain(text)
})

test('the primary Field Engineer: the reprint task → Print labels opens the label dialog with its cables → the sheet prints "old → new" → completed — every width', async () => {
  const fe = s.fe
  await fe.goto(`${home()}/tasks`)
  const task = fe.getByTestId('task-list').locator('li', { hasText: 'Reprint labels — CR-1' })
  await expect(task.getByTestId('reprint-details')).toContainText(renamed())
  await fitsEveryWidth(fe, 'reprint-task')
  await task.getByRole('link', { name: 'Print labels (2 connections)' }).click()
  await expect(fe).toHaveURL(/\/deployment\?labels=/)
  const dialog = fe.getByRole('dialog', { name: 'Print cable labels' })
  await expect(dialog).toContainText('2 of 3 connection(s)')
  await dialog.getByLabel('Label stock').selectOption('avery-l7160')
  const download = fe.waitForEvent('download', { timeout: 90_000 })
  await dialog.getByRole('button', { name: 'Create label sheet' }).click()
  expect(flat(await pdfText(await (await download).path()))).toContain(`${oldName}→${NEW_NAME}`.replace(/\s+/g, ''))
  await dialog.getByRole('button', { name: 'Close' }).last().click()
  await expect(fe).toHaveURL(/\/deployment$/)
  // Labels fixed: the task is completed.
  await fe.goto(`${home()}/tasks`)
  const status = task.getByRole('combobox', { name: /^Status of Reprint labels — CR-1/ })
  await status.selectOption('in_progress')
  await expect(status).toHaveValue('in_progress')
  await status.selectOption('complete')
  await expect(status).toHaveValue('complete')
  expect(errors).toEqual([])
})
