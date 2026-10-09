import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember } from './helpers/app.js'
import { surveyProject } from './helpers/survey.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

// Membership scopes (DATA-MODEL §1.6, D5) on the M2/M3a endpoints — the
// dashboard, blockers, CMO, the project list and project home — through the
// one shared rule (server/src/access/scope.js). Project: B001 and B002 in
// SAL ERL, B101 in SAL MUC. feB001 is a Field Engineer scoped to B001;
// pmMuc a PM scoped to SAL MUC; fe an unscoped Field Engineer.

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const row = (rowIndex, building, serial) => ({ rowIndex, hostname: `SW-${serial}`, model: 'C9300-48UX', serial, mac: null, building, floor: null, room: null, rack: null, ru: null })

async function setup() {
  const ctx = createTestApp()
  const p = await surveyProject(ctx)
  p.pmMuc = await projectMember(ctx, p.admin, { email: 'pm-muc@example.com', role: 'pm', projectId: p.projectId, scopes: [{ type: 'sal', refId: p.sal('MUC').id }] })
  // CMO: one device in B001, one in B101, one Unassigned at SAL ERL (with its system blocker).
  await p.admin.agent
    .post(`${p.base}/cmo/import`)
    .send({ salId: p.sal('ERL').id, rows: [row(0, 'B001', 'S-B001'), row(1, 'B101', 'S-B101'), row(2, null, 'S-ERL-UNASSIGNED')] })
    .expect(201)
  return p
}

describe('dashboard', () => {
  it('a building-scoped user opens only their building; out of scope is not found', async () => {
    const p = await setup()
    const dash = (agent, code) => agent.get(`${p.base}/dashboard/buildings/${p.building(code).id}`)
    await dash(p.feB001, 'B001').expect(200)
    await dash(p.feB001, 'B002').expect(404)
    await dash(p.feB001, 'B101').expect(404)
    await dash(p.pmMuc, 'B101').expect(200)
    await dash(p.pmMuc, 'B001').expect(404)
    // Unscoped members are unaffected.
    await dash(p.fe, 'B002').expect(200)
    await dash(p.viewer, 'B101').expect(200)
  })

  it('SAL-level blockers (Unassigned CMO devices) show only to scopes that cover the SAL', async () => {
    const p = await setup()
    const b001 = p.building('B001').id
    const unscoped = (await p.fe.get(`${p.base}/dashboard/buildings/${b001}`).expect(200)).body
    const scoped = (await p.feB001.get(`${p.base}/dashboard/buildings/${b001}`).expect(200)).body
    expect(unscoped.blockers.some((b) => b.salId && !b.buildingId)).toBe(true)
    expect(scoped.blockers.some((b) => !b.buildingId)).toBe(false)
    expect(scoped.kpis.openIssues).toBe(unscoped.kpis.openIssues - 1)
    // The building's own facts are the same for both.
    expect(scoped.phases).toEqual(unscoped.phases)
    expect(scoped.kpis.devices).toBe(unscoped.kpis.devices)
    expect(scoped.recentActivity.map((e) => e.id)).toEqual(unscoped.recentActivity.map((e) => e.id))
  })
})

describe('blockers', () => {
  it('list, raise and update only within scope', async () => {
    const p = await setup()
    const base = `${p.base}/blockers`
    const b001 = p.building('B001').id
    const b002 = p.building('B002').id
    await p.feB001.get(base).query({ buildingId: b002 }).expect(404)
    await p.feB001.post(base).send({ buildingId: b002, phaseKey: 'survey', description: 'x' }).expect(404)
    const own = (await p.feB001.post(base).send({ buildingId: b001, phaseKey: 'survey', description: 'Door locked', ownerId: undefined }).expect(201)).body.blocker

    const elsewhere = (await p.fe.post(base).send({ buildingId: b002, phaseKey: 'survey', description: 'No power' }).expect(201)).body.blocker
    await p.feB001.patch(`${base}/${elsewhere.id}`).send({ status: 'resolved' }).expect(404)

    // The SAL-level (Unassigned device) blocker is outside a building scope.
    const all = (await p.fe.get(base).query({ buildingId: b001 }).expect(200)).body.blockers
    const salLevel = all.find((b) => !b.buildingId)
    expect(salLevel).toBeTruthy()
    const scopedList = (await p.feB001.get(base).query({ buildingId: b001 }).expect(200)).body.blockers
    expect(scopedList.map((b) => b.id)).toEqual(all.filter((b) => b.buildingId).map((b) => b.id))
    expect(scopedList.map((b) => b.id)).toContain(own.id)
    await p.feB001.patch(`${base}/${salLevel.id}`).send({ status: 'resolved' }).expect(404)
    await p.feB001.patch(`${base}/${own.id}`).send({ status: 'open' }).expect(400) // in scope: reaches the transition rules
  })
})

describe('CMO', () => {
  it('the inventory shows only the caller’s buildings, SALs and devices; KPIs follow', async () => {
    const p = await setup()
    const all = (await p.fe.get(`${p.base}/cmo`).expect(200)).body
    expect(all.buildings.map((b) => b.code).sort()).toEqual(['B001', 'B002', 'B101'])
    expect(all.devices).toHaveLength(3)

    const b001Only = (await p.feB001.get(`${p.base}/cmo`).expect(200)).body
    expect(b001Only.buildings.map((b) => b.code)).toEqual(['B001'])
    expect(b001Only.sals).toEqual([])
    expect(b001Only.devices.map((d) => d.serial)).toEqual(['S-B001'])
    expect(b001Only.kpis).toMatchObject({ total: 1, assigned: 1, unassigned: 0 })

    const muc = (await p.pmMuc.get(`${p.base}/cmo`).expect(200)).body
    expect(muc.buildings.map((b) => b.code)).toEqual(['B101'])
    expect(muc.sals.map((s) => s.code)).toEqual(['MUC'])
    expect(muc.devices.map((d) => d.serial)).toEqual(['S-B101'])
  })

  it('a scoped PM imports only into their scope: other buildings are blocked rows, another SAL is refused', async () => {
    const p = await setup()
    const preview = (await p.pmMuc.post(`${p.base}/cmo/preview`).send({ rows: [row(0, 'B101', 'N-1'), row(1, 'B001', 'N-2'), row(2, null, 'N-3')] }).expect(200)).body
    expect(preview.salId).toBe(p.sal('MUC').id)
    expect(preview.rows.map((r) => r.valid)).toEqual([true, false, true])
    expect(preview.rows[1].errors).toContain('Building B001 is outside your scope')

    await p.pmMuc.post(`${p.base}/cmo/preview`).send({ salId: p.sal('ERL').id, rows: [row(0, 'B101', 'N-1')] }).expect(400)
    const committed = (await p.pmMuc.post(`${p.base}/cmo/import`).send({ rows: [row(0, 'B101', 'N-1'), row(1, 'B001', 'N-2'), row(2, null, 'N-3')] }).expect(201)).body
    expect(committed.summary).toMatchObject({ imported: 2, assigned: 1, unassigned: 1, skipped: 1 })
    const devices = (await p.fe.get(`${p.base}/cmo`).expect(200)).body.devices
    expect(devices.find((d) => d.serial === 'N-3')).toMatchObject({ salCode: 'MUC', buildingId: null })
    expect(devices.some((d) => d.serial === 'N-2')).toBe(false)
  })

  it('assigning an Unassigned device: only within the caller’s SAL and to a building in scope', async () => {
    const p = await setup()
    await p.pmMuc.post(`${p.base}/cmo/import`).send({ rows: [row(0, null, 'MUC-U')] }).expect(201)
    const devices = (await p.admin.agent.get(`${p.base}/cmo`).expect(200)).body.devices
    const erlDevice = devices.find((d) => d.serial === 'S-ERL-UNASSIGNED')
    const mucDevice = devices.find((d) => d.serial === 'MUC-U')
    const assign = (agent, device, code) => agent.patch(`${p.base}/cmo/devices/${device.id}/assignment`).send({ buildingId: p.building(code).id })

    await assign(p.pmMuc, erlDevice, 'B001').expect(404) // device outside the scope
    await assign(p.pmMuc, mucDevice, 'B001').expect(404) // building outside the scope
    await assign(p.pmMuc, mucDevice, 'B101').expect(200)
    await assign(p.admin.agent, erlDevice, 'B002').expect(200) // unscoped PM (and Org Admin)
  })
})

describe('project list and project home', () => {
  it('a scoped member sees only their buildings; unscoped members see all', async () => {
    const p = await setup()
    const listed = async (agent) => (await agent.get(`/api/v1/orgs/${p.admin.orgId}/projects`).expect(200)).body.projects[0].buildings.map((b) => b.code).sort()
    const home = async (agent) => (await agent.get(p.base).expect(200)).body.project.buildings.map((b) => b.code).sort()
    expect(await listed(p.feB001)).toEqual(['B001'])
    expect(await home(p.feB001)).toEqual(['B001'])
    expect(await listed(p.pmMuc)).toEqual(['B101'])
    expect(await home(p.pmMuc)).toEqual(['B101'])
    expect(await listed(p.fe)).toEqual(['B001', 'B002', 'B101'])
    expect(await home(p.viewer)).toEqual(['B001', 'B002', 'B101'])
  })
})

describe('Org Admin', () => {
  it('is never limited, even with a scoped project membership of their own', async () => {
    const p = await setup()
    const members = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/members`).expect(200)).body.members
    const own = members.find((m) => m.level === 'project' && m.user?.email === p.admin.email)
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/memberships/${own.id}`).send({ scopes: [{ type: 'building', refId: p.building('B001').id }] }).expect(200)

    await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.building('B101').id}`).expect(200)
    expect((await p.admin.agent.get(`${p.base}/cmo`).expect(200)).body.devices).toHaveLength(3)
    expect((await p.admin.agent.get(p.base).expect(200)).body.project.buildings).toHaveLength(3)
    await p.admin.agent.get(`${p.base}/survey/buildings/${p.building('B002').id}/structure`).expect(200)
  })
})
