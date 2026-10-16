import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import JSZip from 'jszip'
import { deployedProject } from './handoverSetup.js'
import { fixture as fixtureFile } from './helpers.js'

// M6b, real mode: generate the HLD, LLD and Solution Package documents from
// their screens → download → the PDFs open and contain their sections (text
// extraction) → print QR cable labels → the QR target needs sign-in → the
// handover checklist is green → compile (background jobs) → review → send →
// the client downloads and signs → accepted: baseline written, the design is
// read-only and the CMDB still editable.

test.describe.configure({ mode: 'serial' })
test.setTimeout(300_000)

const RUN_ID = Date.now()
let owner
let client
let s
const errors = []
const base = () => `/orgs/${s.orgId}/projects/${s.projectId}/buildings/${s.b001}`
let handoverLink

async function pdfText(path) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path)), useSystemFonts: true, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' '))
  return pages
}
const flat = (pages) => pages.join(' ').replace(/\s+/g, '')
const has = (pages, text) => expect(flat(pages)).toContain(text.replace(/\s+/g, ''))

// Picks an export from a screen's Export menu and returns the downloaded file.
async function exportFrom(page, itemName, format) {
  const menu = page.getByTestId('document-exports').first()
  if ((await menu.getByRole('menu').count()) === 0) await menu.getByRole('button', { name: 'Documents' }).click()
  const download = page.waitForEvent('download', { timeout: 90_000 })
  await menu.getByRole('menuitem', { name: new RegExp(`^${itemName}\\s*${format}$`) }).click()
  await expect(menu.getByTestId('document-ready')).toBeVisible({ timeout: 90_000 })
  const file = await download
  return { name: file.suggestedFilename(), path: await file.path() }
}
async function fitsEveryWidth(page, label) {
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await expect(page.locator('[data-page-state="ready"]')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${label} at ${width}px`).toBe(0)
    if (process.env.M6B_SHOTS) await page.screenshot({ path: `${process.env.M6B_SHOTS}/${label}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
}

test.beforeAll(async ({ browser }) => {
  owner = await browser.newPage()
})
test.afterAll(async () => {
  for (const p of [owner, client, s?.fe, s?.architect, s?.reviewer]) await p?.context().close()
})

test('set up: B001 deployed and accepted (through the API)', async ({ browser }) => {
  s = await deployedProject({ owner, browser, runId: RUN_ID, prefix: 'm6b' })
  // 400/409: deliberate refusals; 401 from the public page before unlocking.
  for (const [who, page] of [['owner', owner], ['fe', s.fe], ['architect', s.architect], ['reviewer', s.reviewer]]) page.on('console', (m) => m.type() === 'error' && !/status of (400|401|409)/.test(m.text()) && errors.push(`${who}: ${m.text()}`))
  // The handover phase is part of the project.
  await s.send(owner, 'patch', '', { activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb', 'handover'] }, 200)
})

test('HLD, LLD and Solution Package documents from their screens: PDFs with cover, contents and sections; Word too', async () => {
  const arch = s.architect
  await arch.goto(`${base()}/hld`)
  const hld = await exportFrom(arch, 'HLD document', 'PDF')
  expect(hld.name).toBe('B001-hld-document-v1.pdf')
  let pages = await pdfText(hld.path)
  expect(pages[0]).toContain('High-Level Design')
  expect(pages[1]).toMatch(/Contents/)
  for (const t of ['1 Overview', '2 Physical topology', '3 Device inventory', '4 Uplinks']) has(pages, t)
  expect(pages.every((p, i) => p.includes(`Page ${i + 1} of ${pages.length}`))).toBe(true)
  expect(pages[2]).toMatch(/M6B Org · \d{4}-\d\d-\d\d · Ada Architect/) // the watermark

  await arch.goto(`${base()}/lld`)
  const lld = await exportFrom(arch, 'LLD document', 'PDF')
  pages = await pdfText(lld.path)
  for (const t of ['Low-Level Design', '2 Rack elevations', '3 Port schedule', '4 Cable schedule', 'C-EA-1b']) has(pages, t)
  const xlsx = await exportFrom(arch, 'Cable schedule, matrix and port schedule', 'Excel')
  expect(xlsx.name).toBe('B001-cable-matrix-v1.xlsx')
  const book = await JSZip.loadAsync(fs.readFileSync(xlsx.path))
  expect(Object.keys(book.files)).toEqual(expect.arrayContaining(['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']))

  await owner.goto(`${base()}/solution-package`)
  const spPdf = await exportFrom(owner, 'Solution Package', 'PDF')
  pages = await pdfText(spPdf.path)
  for (const t of ['Solution Package', '1 Document information and scope', '9 IP, VLAN, VN and VRF design', '18 Assumptions, risks, dependencies and open items', 'Quantities only']) has(pages, t)
  const priced = await exportFrom(owner, 'Client export with prices', 'PDF')
  expect(flat(await pdfText(priced.path))).toMatch(/EUR\d+\.\d\d/)
  const word = await exportFrom(owner, 'Solution Package', 'Word')
  expect(word.name).toMatch(/\.docx$/)
  const xml = await (await JSZip.loadAsync(fs.readFileSync(word.path))).file('word/document.xml').async('string')
  expect(xml).toContain('7 Cabling and uplink schedules')
  // The Architect (no price access) is not offered the priced export.
  await arch.goto(`${base()}/solution-package`)
  await arch.getByTestId('document-exports').getByRole('button', { name: 'Documents' }).click()
  await expect(arch.getByRole('menuitem', { name: /Client export with prices/ })).toHaveCount(0)
})

test('BOM: cost prices only as an internal export for the Org Admin, PM and Reviewer, marked on every page', async () => {
  const rev = s.reviewer
  await rev.goto(`${base()}/bom`)
  const cost = await exportFrom(rev, 'INTERNAL — BOM with cost prices', 'PDF')
  const pages = await pdfText(cost.path)
  expect(pages.length).toBeGreaterThan(1)
  pages.forEach((page) => expect(page.replace(/\s+/g, '')).toContain('INTERNAL—costprices'))
  // The menu with its internal items fits a phone.
  const menu = rev.getByTestId('document-exports').first()
  if ((await menu.getByRole('menu').count()) === 0) await menu.getByRole('button', { name: 'Documents' }).click()
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await rev.setViewportSize({ width, height })
    await expect(menu.getByRole('menuitem', { name: /INTERNAL — BOM with cost prices/ }).first()).toBeVisible()
    expect(await rev.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `BOM menu at ${width}px`).toBe(0)
  }
  await rev.setViewportSize({ width: 1440, height: 900 })
  // The Architect is never offered cost prices.
  const arch = s.architect
  await arch.goto(`${base()}/bom`)
  await arch.getByTestId('document-exports').first().getByRole('button', { name: 'Documents' }).click()
  await expect(arch.getByRole('menuitem', { name: /BOM, quantities only/ }).first()).toBeVisible()
  await expect(arch.getByRole('menuitem', { name: /cost prices/ })).toHaveCount(0)
})

test('QR cable labels: a label sheet for the chosen cables; the QR target needs sign-in and opens the connection', async ({ browser }) => {
  const fe = s.fe
  await fe.goto(`${base()}/deployment`)
  await fe.getByRole('button', { name: 'Print labels' }).click()
  const dialog = fe.getByRole('dialog', { name: 'Print cable labels' })
  await dialog.getByRole('button', { name: 'None' }).click()
  const ea = s.deployment.connections.find((c) => c.segments.length === 2)
  await dialog.getByRole('checkbox').nth(s.deployment.connections.indexOf(ea)).check()
  await expect(dialog).toContainText('1 of 3 connection(s) · 4 label(s)')
  await dialog.getByLabel('Label stock').selectOption('avery-l7160')
  const download = fe.waitForEvent('download', { timeout: 90_000 })
  await dialog.getByRole('button', { name: 'Create label sheet' }).click()
  const pages = await pdfText(await (await download).path())
  expect(flat(pages).match(/C-EA-1b/g)).toHaveLength(2)
  expect(pages[0]).toContain('This end:')
  await dialog.getByRole('button', { name: 'Close' }).last().click()
  // The QR code's URL: a signed-in member lands on the connection; a stranger must sign in first.
  const qrPath = `/l/${s.orgId}/${s.projectId}/c/${ea.id}`
  await fe.goto(qrPath)
  await expect(fe).toHaveURL(new RegExp(`/buildings/${s.b001}/cmdb\\?tab=ports&record=`))
  const stranger = await (await browser.newContext()).newPage()
  await stranger.goto(qrPath)
  await expect(stranger).toHaveURL(/\/login\?next=/)
  await stranger.context().close()
})

test('branding: organisation and client logos and the SC cable headings; documents then show the logos', async () => {
  await owner.goto(`/orgs/${s.orgId}/settings`)
  await owner.getByLabel('Upload organisation logo').setInputFiles(fixtureFile('photo.jpg'))
  await expect(owner.getByTestId('logo-organisation-logo').locator('img')).toBeVisible()
  await owner.goto(`/orgs/${s.orgId}/projects/${s.projectId}/settings?tab=documents`)
  await owner.getByLabel('Upload client logo').setInputFiles(fixtureFile('photo.jpg'))
  await expect(owner.getByTestId('logo-client-logo').locator('img')).toBeVisible()
  await owner.getByLabel('Heading for cableId').fill('SC Kabel-Nr.')
  await owner.getByRole('button', { name: 'Save headings' }).click()
  await expect(owner.getByRole('status')).toContainText('Headings saved')
  await owner.goto(`${base()}/lld`)
  const lld = await exportFrom(owner, 'LLD document', 'PDF')
  expect((await pdfText(lld.path))[0]).not.toContain('Client logo') // the placeholder is gone
  has(await pdfText(lld.path), 'SC Kabel-Nr.')
})

test('a PM shares documents by a password-protected download link; the public page downloads them', async ({ browser }) => {
  const docs = (await s.send(owner, 'get', `/documents?buildingId=${s.b001}&typeKey=hld-document`, undefined, 200)).documents
  const { shareLink } = await s.send(owner, 'post', '/documents/share-links', { buildingId: s.b001, documentIds: [docs[0].id], password: 'Download-Pass-1', expiryDays: 2, label: 'Design pack' }, 201)
  const page = await (await browser.newContext()).newPage()
  page.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`download page: ${m.text()}`))
  await page.goto(shareLink.url)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Show documents' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect password')
  await page.getByLabel('Password').fill('Download-Pass-1')
  await page.getByRole('button', { name: 'Show documents' }).click()
  const list = page.getByTestId('download-list')
  await expect(list).toContainText('Design pack')
  await expect(list).toContainText('HLD document')
  const download = page.waitForEvent('download')
  await list.getByRole('button', { name: 'Download' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('B001-hld-document-v1.pdf')
  has(await pdfText(await file.path()), 'High-Level Design')
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  }
  await page.context().close()
})

test('handover: checklist green → compile in the background → review → send to the client', async () => {
  await owner.goto(`${base()}/handover`)
  await expect(owner.getByRole('heading', { name: 'Handover — B001' })).toBeVisible()
  await expect(owner.getByTestId('handover-state')).toHaveText('Ready')
  await expect(owner.getByText('Pre-compilation checklist')).toBeVisible()
  await owner.getByRole('button', { name: 'Compile package' }).click()
  await expect(owner.getByTestId('handover-state'))
    .toHaveText('Compiled', { timeout: 120_000 })
    .catch(async (err) => {
      const docs = await s.send(owner, 'get', `/documents?buildingId=${s.b001}`, undefined, 200)
      if (process.env.M6B_DEBUG) fs.writeFileSync(process.env.M6B_DEBUG, JSON.stringify(docs.documents.map((d) => [d.typeKey, d.format, d.status, d.step, d.error, d.requestedAt]), null, 1))
      throw err
    })
  await expect(owner.getByTestId('handover-doc-photo-evidence')).toContainText('Ready')
  await expect(owner.getByTestId('package-download')).toBeVisible()
  // A document of the package opens and contains its sections.
  const download = owner.waitForEvent('download')
  await owner.getByTestId('handover-doc-deployment-report').getByRole('link', { name: 'PDF' }).click()
  has(await pdfText(await (await download).path()), 'Installation records')
  await owner.getByRole('button', { name: 'Mark reviewed' }).click()
  await expect(owner.getByTestId('handover-state')).toHaveText('Under review')
  await owner.getByLabel('Password (blank: generated)').fill('Handover-Pass-26')
  await owner.getByRole('button', { name: 'Create link and send' }).click()
  const panel = owner.getByTestId('handover-link')
  await expect(panel).toContainText('shown only once')
  const values = await panel.locator('input[readonly]').evaluateAll((els) => els.map((e) => e.value))
  handoverLink = { url: new URL(values[0]).pathname, password: values[1] }
  expect(handoverLink.password).toBe('Handover-Pass-26')
  await expect(owner.getByTestId('handover-state')).toHaveText('Delivered')
  await fitsEveryWidth(owner, 'handover')
})

test('the client downloads the package and accepts on the share-link page', async ({ browser }) => {
  client = await (await browser.newContext()).newPage()
  client.on('console', (m) => m.type() === 'error' && !/status of 401/.test(m.text()) && errors.push(`client: ${m.text()}`))
  await client.goto(handoverLink.url)
  await client.getByLabel('Password').fill(handoverLink.password)
  await client.getByRole('button', { name: 'View Handover package' }).click()
  const summary = client.getByTestId('handover-summary')
  await expect(summary).toContainText('Handover package — Building B001')
  await expect(summary.getByRole('list', { name: 'Handover documents' }).getByRole('listitem')).toHaveCount(11)
  const download = client.waitForEvent('download')
  await summary.getByRole('button', { name: /Download the whole package/ }).click()
  const zip = await JSZip.loadAsync(fs.readFileSync(await (await download).path()))
  expect(Object.keys(zip.files)).toContain('manifest.csv')
  await client.getByPlaceholder('Your full name').fill('Clara Client')
  await client.getByPlaceholder('e.g. IT Director').fill('IT Director')
  await client.locator('textarea').fill('Accepted as built')
  const canvas = client.locator('canvas')
  const box = await canvas.boundingBox()
  await client.mouse.move(box.x + 20, box.y + 30)
  await client.mouse.down()
  await client.mouse.move(box.x + 120, box.y + 60, { steps: 5 })
  await client.mouse.up()
  await client.getByRole('checkbox').check()
  await client.getByRole('button', { name: 'Approve' }).click()
  await expect(client.getByTestId('decision-recorded')).toContainText('You approved this Handover package.')
})

test('accepted: baseline written, design read-only, CMDB editable, Handover Approved', async () => {
  await owner.goto(`${base()}/handover`)
  await expect(owner.getByTestId('handover-state')).toHaveText('Accepted')
  await expect(owner.getByTestId('baseline')).toContainText('baseline v1.0')
  await expect(owner.getByTestId('baseline')).toContainText('Clara Client (IT Director)')
  // The design is read-only: a change request, the LLD and procurement refuse.
  const cr = await s.architect.request.post(`${s.api}/change-requests`, { data: { buildingId: s.b001, title: 'Too late' } })
  expect(cr.status()).toBe(409)
  expect((await cr.json()).error.code).toBe('handed_over')
  const survey = await s.fe.request.post(`${s.api}/survey/floors`, { data: { buildingId: s.b001, token: 'OG', name: 'Upper', order: 1 } })
  expect(survey.status()).toBe(409)
  // The CMDB stays editable for operational changes.
  const edge = s.deployment.devices.find((d) => d.role === 'edge')
  await s.architect.goto(`${base()}/cmdb?record=${edge.id}`)
  const detail = s.architect.getByTestId('record-detail')
  await detail.getByRole('button', { name: 'Operational edit' }).click()
  await detail.getByLabel('Asset tag').fill('INV-AFTER-HANDOVER')
  await detail.getByRole('button', { name: 'Save change' }).click()
  await expect(s.architect.getByTestId('record-detail')).toContainText('INV-AFTER-HANDOVER')
  // The dashboard shows Handover Approved; the package stays downloadable.
  await owner.goto(base())
  await expect(owner.locator('a', { hasText: 'Handover' }).filter({ hasText: 'Approved' }).first()).toBeVisible()
  await owner.goto(`${base()}/handover`)
  const download = owner.waitForEvent('download')
  await owner.getByTestId('package-download').click()
  expect((await download).suggestedFilename()).toMatch(/^B001-handover-package-v1\.zip$/)
})

test('no console errors on any page', async () => {
  expect(errors).toEqual([])
})
