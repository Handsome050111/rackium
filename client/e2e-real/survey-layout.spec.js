import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'

// M3b: the real-mode survey screens at the four supported widths — no
// horizontal overflow and no console errors. Set SURVEY_SHOTS to a folder to
// also save screenshots for a visual check.

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ipad-landscape', width: 1024, height: 768 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
]
const SHOTS = process.env.SURVEY_SHOTS

test('survey screens fit every width without console errors', async ({ page }) => {
  const orgId = await signUpAndSignIn(page, { email: `survey-layout-${Date.now()}@example.com`, organisationName: 'Layout Org' })
  // From here on (the signed-out session check before sign-in is an expected 401).
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const projectId = await createProjectWithHierarchy(page, orgId, { name: 'Layout Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  const cmo = await (await page.request.get(`/api/v1/orgs/${orgId}/projects/${projectId}/cmo`)).json()
  const buildingId = cmo.buildings.find((b) => b.code === 'B001').id
  const base = `/api/v1/orgs/${orgId}/projects/${projectId}/survey`
  // The owner (Org Admin + PM) may build the structure.
  const floor = (await (await page.request.post(`${base}/floors`, { data: { buildingId, token: 'EG', name: 'Ground floor', order: 0 } })).json()).floor
  const room = (await (await page.request.post(`${base}/rooms`, { data: { floorId: floor.id } })).json()).room
  await page.request.post(`${base}/rooms`, { data: { floorId: floor.id } })
  const rack = (await (await page.request.post(`${base}/racks`, { data: { roomId: room.id } })).json()).rack
  const survey = `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/survey`
  const screens = [
    { name: 'structure', url: survey, ready: /Building & Room Structure/ },
    { name: 'campus', url: `${survey}/campus`, ready: /Multi-Building Structure/ },
    { name: 'rack', url: `${survey}/rack?rack=${rack.id}`, ready: /Rack Layout & Installation Readiness/ },
    { name: 'room-building', url: `${survey}/room`, ready: null },
    { name: 'room-firewall', url: `${survey}/room?room=${room.id}&tab=firewall`, ready: null },
  ]

  for (const size of WIDTHS) {
    await page.setViewportSize({ width: size.width, height: size.height })
    for (const screen of screens) {
      await page.goto(screen.url)
      if (screen.ready) await expect(page.getByRole('heading', { name: screen.ready })).toBeVisible()
      else await expect(page.getByTestId('tab-status')).toBeVisible()
      // The app scrolls inside <main>; nothing may be wider than the viewport.
      const overflow = await page.evaluate(() => {
        const main = document.querySelector('main')
        return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0 }
      })
      expect(overflow, `${screen.name} at ${size.width}px`).toEqual({ doc: 0, main: 0 })
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${screen.name}-${size.width}.png`), fullPage: false })
    }
  }
  expect(errors, errors.join('\n')).toEqual([])
})
