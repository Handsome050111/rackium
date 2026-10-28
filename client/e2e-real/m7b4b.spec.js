import { test, expect } from '@playwright/test'
import { deployedProject } from './handoverSetup.js'

// M7b-4b, real mode (addendum v2.3 Q5; DATA-MODEL §5.22): after cutover the
// Field Engineer removes the interim switch and the old switches from the
// deployment screen; the handover checklist blocks on installed interim kit
// and warns on old gear left on site, which the PM keeps with a reason (and
// can withdraw); the CMDB shows and filters the mode. Every width, no
// console errors. All names and serials are synthetic.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
let owner
let s
const errors = []
const depUrl = () => `/orgs/${s.orgId}/projects/${s.projectId}/buildings/${s.b001}/deployment`
const handoverUrl = () => `/orgs/${s.orgId}/projects/${s.projectId}/buildings/${s.b001}/handover`

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
  for (const p of [owner, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed and accepted, with two old switches (replaced, removed) and an interim switch', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm7b4b', cutover: true })
  for (const [who, page] of [['owner', owner], ['fe', s.fe]]) {
    page.on('console', (m) => m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
    page.on('pageerror', (err) => errors.push(`${who}: ${err.message}`))
  }
  expect(s.deployment.removals.map((r) => r.kind).sort()).toEqual(['cmo', 'cmo', 'interim'])
})

test('the handover checklist: the installed interim switch blocks; the old switches on site are a warning', async () => {
  await owner.goto(handoverUrl())
  await expect(owner.getByTestId('checklist-interim')).toContainText('1 still installed')
  await expect(owner.getByTestId('checklist-old-gear')).toContainText('2 still on site: OLD-SW-01, OLD-SW-02')
  // Not ready: no Compile button.
  await expect(owner.getByRole('button', { name: /Compile/ })).toHaveCount(0)
})

test('deployment: the Field Engineer removes the interim switch (with a note) and OLD-SW-02 after cutover — every width', async () => {
  await s.fe.goto(depUrl())
  const list = s.fe.getByTestId('cutover-removals')
  await expect(list).toContainText('3 of 3 still to remove')
  const interim = s.deployment.removals.find((r) => r.kind === 'interim')
  const two = s.deployment.removals.find((r) => r.label === 'OLD-SW-02')
  await expect(list.getByTestId(`removal-${two.id}`)).toContainText('CMO · remove')
  await expect(list.getByTestId(`removal-${s.deployment.removals.find((r) => r.label === 'OLD-SW-01').id}`)).toContainText('CMO · replaced by')
  const row = list.getByTestId(`removal-${interim.id}`)
  await expect(row).toContainText('IMO')
  await row.getByLabel(`Removal note for ${interim.label}`).fill('Cutover done')
  await row.getByRole('button', { name: 'Mark removed' }).click()
  await expect(s.fe.getByRole('status')).toHaveText('Removed after cutover')
  await expect(row).toContainText('Removed by Fiona Field')
  await expect(row.getByRole('button', { name: 'Mark removed' })).toHaveCount(0)
  await list.getByTestId(`removal-${two.id}`).getByRole('button', { name: 'Mark removed' }).click()
  await expect(list).toContainText('1 of 3 still to remove')
  await fitsEveryWidth(s.fe, 'm7b4b-deployment', async () => expect(s.fe.getByTestId('cutover-removals')).toBeVisible())
})

test('handover: the PM keeps OLD-SW-01 on site with a reason, withdraws it and keeps it again — every width', async () => {
  await owner.goto(handoverUrl())
  await expect(owner.getByTestId('checklist-interim')).toContainText('None installed')
  const item = owner.getByTestId('checklist-old-gear')
  await expect(item).toContainText('1 still on site: OLD-SW-01')
  await expect(item.getByRole('button', { name: 'Keep on site' })).toBeDisabled()
  await item.getByLabel('Reason to keep it on site').fill('Kept as a spare until the client collects it')
  await item.getByRole('button', { name: 'Keep on site' }).click()
  await expect(item).toContainText('Kept on site (1): Kept as a spare until the client collects it')
  await item.getByRole('button', { name: 'Withdraw keeping it on site' }).click()
  await expect(item).toContainText('1 still on site: OLD-SW-01')
  await item.getByLabel('Reason to keep it on site').fill('Kept as a spare until the client collects it')
  await item.getByRole('button', { name: 'Keep on site' }).click()
  await expect(item).toContainText('Kept on site (1)')
  await fitsEveryWidth(owner, 'm7b4b-handover', async () => expect(owner.getByTestId('checklist-old-gear')).toBeVisible())
})

test('the CMDB: a Mode column and filter — the FMO records; the removed interim switch is not a record', async () => {
  await owner.goto(`/orgs/${s.orgId}/projects/${s.projectId}/buildings/${s.b001}/cmdb`)
  const modes = owner.getByTestId('cmdb-mode')
  await expect(modes.first()).toHaveText('FMO')
  const all = await modes.count()
  expect(await modes.allTextContents()).toEqual(Array(all).fill('FMO'))
  await owner.getByLabel('Mode', { exact: true }).selectOption('interim')
  await expect(modes).toHaveCount(0)
  await owner.getByLabel('Mode', { exact: true }).selectOption('future')
  await expect(modes).toHaveCount(all)
  await fitsEveryWidth(owner, 'm7b4b-cmdb', async () => expect(owner.getByLabel('Mode', { exact: true })).toBeVisible())
  expect(errors).toEqual([])
})
