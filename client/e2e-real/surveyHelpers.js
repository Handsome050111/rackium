import crypto from 'node:crypto'
import fs from 'node:fs'
import { expect } from '@playwright/test'
import { SURVEY_TABS, isCalculatedKey } from '@rackium/shared/surveyForm.js'
import { PASSWORD, fixture, lastEmailTo } from './helpers.js'

// Survey e2e helpers (M3b). The browser drives one tab's full workflow; the
// rest of the 18 tabs are filled and moved through the same API calls the
// screens make, with each role's own signed-in session (page.request
// carries that browser context's cookies).

const api = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}`

// Invites a project member (as the signed-in owner) and accepts in a new
// browser context through the real invitation page. Returns that page.
export async function inviteAndAccept(ownerPage, browser, { orgId, projectId, email, role, name }) {
  const res = await ownerPage.request.post(`/api/v1/orgs/${orgId}/invitations`, { data: { email, role, projectId } })
  expect(res.status(), await res.text()).toBe(201)
  const link = new URL((await lastEmailTo(email)).text.match(/https?:\/\/\S+/)[0])
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`/invite${link.search}`)
  await page.getByLabel('Your name (new accounts only)').fill(name)
  await page.getByLabel('Password (new account, or your existing password)').fill(PASSWORD)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/orgs\/[a-f0-9]+\/projects$/)
  return page
}

const newId = () => crypto.randomBytes(12).toString('hex')

async function uploadPhoto(page, base, attachedTo) {
  const bytes = fs.readFileSync(fixture('photo.jpg'))
  const fileId = newId()
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const start = await page.request.post(`${base}/files/uploads`, { data: { fileId, fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: bytes.length, sha256, category: 'photo_reference', attachedTo } })
  expect(start.status(), await start.text()).toBe(201)
  const chunk = await page.request.patch(`${base}/files/uploads/${fileId}?offset=0`, { headers: { 'Content-Type': 'application/octet-stream' }, data: bytes })
  expect(chunk.status(), await chunk.text()).toBe(200)
  const done = await page.request.post(`${base}/files/uploads/${fileId}/complete`)
  expect(done.status(), await done.text()).toBe(201)
  return fileId
}

const valueFor = (field, photoId) => {
  if (['photo', 'photo_multi', 'file'].includes(field.type)) return { fileIds: [photoId] }
  if (field.type === 'number' || field.type === 'number_m') return 1
  if (field.type === 'yes_no') return 'Yes'
  if (field.type === 'email') return 'site@example.com'
  if (field.type === 'ip') return '10.0.0.1'
  if (field.type === 'mac') return '00:11:22:33:44:55'
  return 'Filled'
}

// Fills every "Must" field of a tab as the Field Engineer (sync endpoint).
export async function fillTabViaApi(fePage, { orgId, projectId, buildingId, roomId = null, tab }) {
  const base = api(orgId, projectId)
  const tabDef = SURVEY_TABS.find((t) => t.tab === tab)
  const target = { buildingId, roomId, tab }
  const isMust = (f) => ['must', 'must_if_allowed'].includes(f.requirement)
  const needsPhoto = tabDef.sections.some((s) => s.fields.some((f) => isMust(f) && ['photo', 'photo_multi', 'file'].includes(f.type)) || s.item_columns?.includes('photograph'))
  const photoId = needsPhoto ? await uploadPhoto(fePage, base, { type: 'surveyTab', ...target }) : null
  let record = null
  if (tabDef.sections.some((s) => s.repeatable_per === 'rack')) {
    const res = await fePage.request.get(`${base}/survey/records?${new URLSearchParams(Object.entries({ buildingId, roomId, tab }).filter(([, v]) => v))}`)
    record = (await res.json()).record
  }
  const edits = []
  const push = (op) => edits.push({ opId: `e2e-${newId()}`, queuedAt: new Date(Date.now() + edits.length).toISOString(), ...target, op, baseLastModifiedAt: null })
  tabDef.sections.forEach((section, sectionIndex) => {
    const must = section.fields.filter(isMust)
    if (section.repeatable_per === 'rack') {
      for (const instance of record.sections[sectionIndex]) {
        for (const f of must) if (f.type !== 'rack_elevation' && !isCalculatedKey(tabDef, section, f.key)) push({ kind: 'setField', sectionIndex, rackId: instance.rackId, key: f.key, value: valueFor(f, photoId) })
      }
    } else if (section.layout === 'key_value') {
      for (const f of must) {
        if (f.type === 'rack_elevation' || isCalculatedKey(tabDef, section, f.key)) continue
        push({ kind: 'setField', sectionIndex, key: f.key, value: valueFor(f, photoId) })
        if (f.prefill === 'prefilled_validated') push({ kind: 'confirmField', sectionIndex, key: f.key, confirmed: true })
      }
    } else if (section.layout === 'item_list') {
      for (const f of must) for (const col of section.item_columns) push({ kind: 'setField', sectionIndex, rowKey: f.key, key: col, value: col === 'photograph' ? { fileIds: [photoId] } : 'Filled' })
    }
  })
  if (edits.length) {
    const res = await fePage.request.post(`${base}/survey/sync`, { data: { edits } })
    expect(res.status(), await res.text()).toBe(200)
    const { results } = await res.json()
    expect(results.filter((r) => r.outcome !== 'applied' && r.outcome !== 'conflict')).toEqual([])
  }
}

export async function transitionViaApi(page, { orgId, projectId, buildingId, roomId = null, tab }, action, reason = '') {
  const res = await page.request.post(`${api(orgId, projectId)}/survey/records/transitions`, { data: { buildingId, roomId, tab, action, reason } })
  expect(res.status(), `${tab} ${action}: ${await res.text()}`).toBe(200)
}
