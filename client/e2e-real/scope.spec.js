import { test, expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept } from './surveyHelpers.js'

// Membership scope in real mode (DATA-MODEL §1.6): a Field Engineer scoped
// to building B001 sees only B001 on the project home, the sidebar, the
// dashboard, CMO and survey — and B002 is not found even by URL.

test.setTimeout(120_000)

test('a building-scoped Field Engineer sees and works only within their building', async ({ page: owner, browser }) => {
  const runId = Date.now()
  const orgId = await signUpAndSignIn(owner, { email: `scope-${runId}@example.com`, organisationName: 'Scope Org' })
  const projectId = await createProjectWithHierarchy(owner, orgId, { name: 'Scope Project', hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  const api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  const cmo = await (await owner.request.get(`${api}/cmo`)).json()
  const b001 = cmo.buildings.find((b) => b.code === 'B001')
  const b002 = cmo.buildings.find((b) => b.code === 'B002')
  const row = (rowIndex, building, serial) => ({ rowIndex, hostname: `SW-${serial}`, model: 'C9300-48UX', serial, mac: null, building, floor: null, room: null, rack: null, ru: null })
  const imported = await owner.request.post(`${api}/cmo/import`, { data: { rows: [row(0, 'B001', 'IN-SCOPE-1'), row(1, 'B002', 'OUT-SCOPE-1'), row(2, null, 'SAL-LEVEL-1')] } })
  expect(imported.status(), await imported.text()).toBe(201)

  // The unscoped owner sees the SAL-level blocker on B001's dashboard.
  await owner.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001.id}`)
  await expect(owner.getByText(/SAL-LEVEL-1/).first()).toBeVisible()

  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `fe-scoped-${runId}@example.com`, role: 'field_engineer', name: 'Scoped Field', scopes: [{ type: 'building', refId: b001.id }] })
  const errors = []
  fe.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // Project home and sidebar list only B001.
  await fe.goto(`/orgs/${orgId}/projects/${projectId}`)
  await expect(fe.getByRole('heading', { name: 'Scope Project' })).toBeVisible()
  await expect(fe.getByText('Building B001')).toBeVisible()
  await expect(fe.getByText('Building B002')).toHaveCount(0)
  const sidebarBuildings = fe.getByRole('navigation', { name: 'Buildings' }).first()
  await expect(sidebarBuildings.getByRole('link', { name: 'B001' })).toBeVisible()
  await expect(sidebarBuildings.getByRole('link', { name: 'B002' })).toHaveCount(0)

  // The B001 dashboard works; its SAL-level blocker (Unassigned device) is outside a building scope.
  await fe.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001.id}`)
  await expect(fe.getByRole('heading', { name: 'Building B001' })).toBeVisible()
  await expect(fe.getByText(/SAL-LEVEL-1/)).toHaveCount(0)

  // CMO shows only B001's device.
  await fe.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b001.id}/cmo`)
  await expect(fe.getByRole('heading', { name: 'CMO Inventory Validation' })).toBeVisible()
  await expect(fe.getByRole('cell', { name: 'IN-SCOPE-1', exact: true })).toBeVisible()
  await expect(fe.getByText('OUT-SCOPE-1')).toHaveCount(0)
  await expect(fe.getByText('SAL-LEVEL-1')).toHaveCount(0)

  // B002 is not found by URL: dashboard, CMO and survey.
  await fe.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b002.id}`)
  await expect(fe.getByRole('alert')).toContainText('not in the part of the project you can see')
  await fe.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b002.id}/cmo`)
  await expect(fe.getByText('This building is not in the project.')).toBeVisible()
  await fe.goto(`/orgs/${orgId}/projects/${projectId}/buildings/${b002.id}/survey`)
  await expect(fe.getByText('Building not found')).toBeVisible()

  // The screens a scoped user sees fit every supported width.
  for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
    await fe.setViewportSize({ width, height })
    for (const path of [`buildings/${b001.id}`, `buildings/${b001.id}/cmo`, `buildings/${b002.id}`]) {
      await fe.goto(`/orgs/${orgId}/projects/${projectId}/${path}`)
      await expect(fe.locator('main')).not.toContainText('Loading…')
      const overflow = await fe.evaluate(() => {
        const main = document.querySelector('main')
        return document.documentElement.scrollWidth - document.documentElement.clientWidth + (main.scrollWidth - main.clientWidth)
      })
      expect(overflow, `${path} at ${width}px`).toBe(0)
    }
  }

  // The only console errors are the refused out-of-scope requests themselves.
  expect(errors.filter((e) => !/status of 404/.test(e)), errors.join('\n')).toEqual([])
  await fe.context().close()
})
