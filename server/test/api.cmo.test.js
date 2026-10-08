import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { Blocker } from '../src/models/blocker.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

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

const t = () => createTestApp()
const api = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}`

const HIERARCHY = [
  { countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B001', buildingName: 'Building B001', wingCode: '', wingName: '' },
  { countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B002', buildingName: 'Building B002', wingCode: '', wingName: '' },
  { countryCode: 'DE', countryName: 'Germany', salCode: 'MUC', campusCode: 'C02', buildingCode: 'B101', buildingName: 'Building B101', wingCode: '', wingName: '' },
]

// A project with SALs ERL (B001, B002) and MUC (B101); B001 has room TR-EG-01 with rack R01.
async function newProject(agent, orgId, { name = 'LANspire', code = 'LAN' } = {}) {
  const res = await agent.post(`/api/v1/orgs/${orgId}/projects`).send({ name, code }).expect(201)
  const projectId = res.body.project.id
  await agent.post(`${api(orgId, projectId)}/hierarchy/import`).send({ rows: HIERARCHY }).expect(201)
  const ctx = (await agent.get(`${api(orgId, projectId)}/cmo`).expect(200)).body
  const building = (code) => ctx.buildings.find((b) => b.code === code)
  const sal = (code) => ctx.sals.find((s) => s.code === code)
  const floor = await agent.post(`${api(orgId, projectId)}/hierarchy/floors`).send({ buildingId: building('B001').id, token: 'EG', name: 'Ground floor', order: 0 }).expect(201)
  const room = await agent.post(`${api(orgId, projectId)}/hierarchy/rooms`).send({ floorId: floor.body.floors.id, code: 'TR-EG-01' }).expect(201)
  await agent.post(`${api(orgId, projectId)}/hierarchy/racks`).send({ roomId: room.body.rooms.id, code: 'R01', heightU: 42 }).expect(201)
  return { projectId, building, sal, roomId: room.body.rooms.id }
}

let rowIndex = 0
const row = (fields) => ({ rowIndex: rowIndex++, hostname: null, model: null, serial: null, mac: null, building: null, floor: null, room: null, rack: null, ru: null, ...fields })

async function setup() {
  const ctx = t()
  const admin = await signedInOrgAdmin(ctx)
  const project = await newProject(admin.agent, admin.orgId)
  return { ctx, admin, ...project, base: api(admin.orgId, project.projectId) }
}

describe('CMO import → Unassigned → PM assigns → phase Completed', () => {
  it('runs end to end, with blockers raised and resolved as rows and the CMO phase computed', async () => {
    const { admin, base, building, sal, projectId } = await setup()
    const rows = [
      row({ hostname: 'SW-EG-01', model: 'C9300-48UX', serial: 'FCW001', mac: '00-1A-2B-3C-4D-01', building: 'b001', room: 'tr-eg-01', rack: 'r01', ru: '40' }),
      row({ hostname: 'SW-EG-02', model: 'Unknown Model 9', serial: 'FCW002', building: 'B001' }),
      row({ hostname: 'SW-UNK-01', serial: 'FCW003' }),
    ]

    const preview = (await admin.agent.post(`${base}/cmo/preview`).send({ salId: sal('ERL').id, rows }).expect(200)).body
    expect(preview.summary).toMatchObject({ rows: 3, valid: 3, blocked: 0, unassigned: 1 })

    const committed = (await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows, fileName: 'cmo.xlsx' }).expect(201)).body
    expect(committed.summary).toEqual({ imported: 3, assigned: 2, unassigned: 1, skipped: 0 })

    const context = (await admin.agent.get(`${base}/cmo`).expect(200)).body
    expect(context.kpis).toEqual({ total: 3, assigned: 2, unassigned: 1 })
    const placed = context.devices.find((d) => d.serial === 'FCW001')
    expect(placed).toMatchObject({ origin: 'existing', status: 'in_service', buildingCode: 'B001', roomCode: 'TR-EG-01', rackCode: 'R01', ru: 40, mac: '00:1a:2b:3c:4d:01', catalogueKey: 'Cisco C9300-48UX' })
    expect(context.devices.find((d) => d.serial === 'FCW002').catalogueKey).toBeNull()
    expect(context.buildings.find((b) => b.code === 'B001').cmoStatus).toBe('blocked')
    expect(context.buildings.find((b) => b.code === 'B101').cmoStatus).toBe('not_started')

    // The Unassigned device is a real open blocker at SAL level — visible on every building in that SAL.
    const dash = (await admin.agent.get(`${base}/dashboard/buildings/${building('B002').id}`).expect(200)).body
    const blocker = dash.blockers.find((b) => b.relatedObjectType === 'device')
    expect(blocker).toMatchObject({ status: 'open', source: 'system', buildingId: null, salId: sal('ERL').id })
    expect(dash.kpis.openIssues).toBe(1)
    const otherSal = (await admin.agent.get(`${base}/dashboard/buildings/${building('B101').id}`).expect(200)).body
    expect(otherSal.blockers).toHaveLength(0)

    const b001 = (await admin.agent.get(`${base}/dashboard/buildings/${building('B001').id}`).expect(200)).body
    expect(b001.kpis.devices).toBe(2)

    // It cannot be resolved by hand — only by assigning the device.
    const manual = await admin.agent.patch(`${base}/blockers/${blocker.id}`).send({ status: 'resolved' }).expect(409)
    expect(manual.body.error.code).toBe('system_blocker')

    const unassigned = context.devices.find((d) => !d.buildingId)
    await admin.agent.patch(`${base}/cmo/devices/${unassigned.id}/assignment`).send({ buildingId: building('B002').id }).expect(200)

    const b002 = (await admin.agent.get(`${base}/dashboard/buildings/${building('B002').id}`).expect(200)).body
    expect(b002.blockers.find((b) => b.id === blocker.id).status).toBe('resolved')
    expect(b002.kpis.openIssues).toBe(0)
    expect(b002.recentActivity.map((a) => a.action)).toContain('cmo.device.assigned')
    expect(b001.recentActivity.map((a) => a.action)).toContain('cmo.import.committed')

    const finalCtx = (await admin.agent.get(`${base}/cmo`).expect(200)).body
    expect(finalCtx.buildings.find((b) => b.code === 'B001').cmoStatus).toBe('completed')
    expect(finalCtx.buildings.find((b) => b.code === 'B002').cmoStatus).toBe('completed')
    expect(finalCtx.kpis.unassigned).toBe(0)
    expect(projectId).toBeTruthy()
  })

  it('shows the computed CMO status on the dashboard when CMO is an active phase', async () => {
    const { admin, base, building, sal } = await setup()
    await admin.agent.patch(base).send({ activePhaseKeys: ['cmo', 'survey'] }).expect(200)
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'A1', building: 'B001' })] }).expect(201)
    const dash = (await admin.agent.get(`${base}/dashboard/buildings/${building('B001').id}`).expect(200)).body
    expect(dash.phases.find((p) => p.phaseKey === 'cmo').status).toBe('completed')

    // ...and the CMO phase now has data, so it can no longer be removed (D3).
    const res = await admin.agent.patch(base).send({ activePhaseKeys: ['survey'] }).expect(400)
    expect(res.body.error.message).toMatch(/cmo|CMO/)
  })
})

describe('row validation is re-run on the server', () => {
  it('rejects serial (case-insensitive), MAC and hostname duplicates against the project, and missing serials', async () => {
    const { admin, base, sal } = await setup()
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ hostname: 'SW-1', serial: 'ABC123', mac: '00:00:00:00:00:01', building: 'B001' })] }).expect(201)

    const preview = (
      await admin.agent
        .post(`${base}/cmo/preview`)
        .send({
          salId: sal('ERL').id,
          rows: [
            row({ serial: 'abc123', building: 'B001' }),
            row({ serial: 'NEW-1', mac: '00-00-00-00-00-01' }),
            row({ serial: 'NEW-2', hostname: 'sw-1' }),
            row({ serial: null }),
            row({ serial: 'NEW-3', mac: 'not-a-mac' }),
            row({ serial: 'NEW-4', building: 'B999' }),
          ],
        })
        .expect(200)
    ).body
    expect(preview.rows.map((r) => r.errors)).toEqual([
      ['duplicate_in_project'],
      ['duplicate_mac_in_project'],
      ['duplicate_hostname_in_project'],
      ['missing_serial'],
      ['invalid_mac'],
      ['unknown_building'],
    ])
    expect(preview.summary).toMatchObject({ valid: 1, blocked: 5, unassigned: 1 })

    // Commit applies the same checks: a batch with nothing importable is refused, nothing written.
    const res = await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'ABC123' })] }).expect(400)
    expect(res.body.error.message).toMatch(/No row can be imported/)
    expect((await admin.agent.get(`${base}/cmo`)).body.kpis.total).toBe(1)
  })

  it('places devices only where room and rack resolve; unknown room, rack or RU are warnings', async () => {
    const { admin, base, sal } = await setup()
    const preview = (
      await admin.agent
        .post(`${base}/cmo/preview`)
        .send({ salId: sal('ERL').id, rows: [row({ serial: 'P1', building: 'B001', room: 'TR-XX', ru: 'top' }), row({ serial: 'P2', building: 'B001', room: 'TR-EG-01', rack: 'R99' })] })
        .expect(200)
    ).body
    expect(preview.rows[0].warnings).toEqual(['unknown_room', 'invalid_ru'])
    expect(preview.rows[1].warnings).toEqual(['unknown_rack'])
    expect(preview.rows.every((r) => r.valid)).toBe(true)
  })

  it('needs a SAL for Unassigned rows when the project has more than one', async () => {
    const { admin, base } = await setup()
    const res = await admin.agent.post(`${base}/cmo/preview`).send({ rows: [row({ serial: 'X1' })] }).expect(400)
    expect(res.body.error.message).toMatch(/Choose the SAL/)
  })
})

describe('serial registry', () => {
  it('is unique per project, not across projects', async () => {
    const { admin, base, sal } = await setup()
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'SHARED-1', building: 'B001' })] }).expect(201)
    const other = await newProject(admin.agent, admin.orgId, { name: 'Second', code: 'SEC' })
    const otherBase = api(admin.orgId, other.projectId)
    await admin.agent.post(`${otherBase}/cmo/import`).send({ salId: other.sal('ERL').id, rows: [row({ serial: 'shared-1', building: 'B001' })] }).expect(201)
    expect((await admin.agent.get(`${otherBase}/cmo`)).body.kpis.total).toBe(1)
  })

  it('a duplicate inside one file blocks both rows', async () => {
    const { admin, base, sal } = await setup()
    const preview = (await admin.agent.post(`${base}/cmo/preview`).send({ salId: sal('ERL').id, rows: [row({ serial: 'D1' }), row({ serial: 'd1' })] }).expect(200)).body
    expect(preview.rows.map((r) => r.errors)).toEqual([['duplicate_in_file'], ['duplicate_in_file']])
  })
})

describe('import transaction', () => {
  it('rolls back everything when any write in the commit fails', async () => {
    const { admin, base, sal } = await setup()
    const rows = [row({ serial: 'RB-1', building: 'B001' }), row({ serial: 'RB-2' })]
    const spy = vi.spyOn(Blocker, 'insertMany').mockRejectedValueOnce(new Error('simulated failure after devices and registry were written'))
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows }).expect(500)
    spy.mockRestore()

    const ctx = (await admin.agent.get(`${base}/cmo`).expect(200)).body
    expect(ctx.devices).toHaveLength(0)
    expect(ctx.lastImportAt).toBeNull()
    // The serials were not left in the registry: the same rows import cleanly now.
    const retry = (await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows }).expect(201)).body
    expect(retry.summary.imported).toBe(2)
  })
})

describe('assignment rules', () => {
  it('only to a building in the device’s own SAL, and only once', async () => {
    const { admin, base, building, sal } = await setup()
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'U1' })] }).expect(201)
    const device = (await admin.agent.get(`${base}/cmo`)).body.devices[0]
    const wrongSal = await admin.agent.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B101').id }).expect(400)
    expect(wrongSal.body.error.message).toMatch(/its own SAL/)
    await admin.agent.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B001').id }).expect(200)
    await admin.agent.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B002').id }).expect(409)
  })

  it('a building, room or rack with devices cannot be deleted', async () => {
    const { admin, base, building, sal, roomId } = await setup()
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'G1', building: 'B001', room: 'TR-EG-01' })] }).expect(201)
    await admin.agent.delete(`${base}/hierarchy/rooms/${roomId}`).expect(409)
    await admin.agent.delete(`${base}/hierarchy/buildings/${building('B001').id}`).expect(409)
  })
})

describe('permissions', () => {
  it('Org Admin and PM import; Architect, Reviewer, Field Engineer and Viewer cannot; all of them can read', async () => {
    const { ctx, admin, base, sal, projectId } = await setup()
    const body = { salId: sal('ERL').id, rows: [row({ serial: 'P-1' })] }
    for (const role of ['architect', 'reviewer', 'field_engineer', 'viewer']) {
      const member = await projectMember(ctx, admin, { email: `${role}@example.com`, role, projectId })
      await member.post(`${base}/cmo/preview`).send(body).expect(403)
      await member.post(`${base}/cmo/import`).send(body).expect(403)
      await member.get(`${base}/cmo`).expect(200)
    }
    const pm = await projectMember(ctx, admin, { email: 'pm2@example.com', role: 'pm', projectId })
    await pm.post(`${base}/cmo/import`).send(body).expect(201)
  })

  it('only a PM assigns — an Org Admin without the PM role in that project cannot', async () => {
    const { ctx, admin, base, projectId, sal, building } = await setup()
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId })
    await pm.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'Q1' })] }).expect(201)
    const device = (await admin.agent.get(`${base}/cmo`).expect(200)).body.devices[0]

    // The Org Admin created the project and so is also its PM; drop that
    // membership so only the organisation role remains.
    const members = (await admin.agent.get(`/api/v1/orgs/${admin.orgId}/members`).expect(200)).body.members
    const ownPm = members.find((m) => m.user?.id === admin.userId && m.projectId === projectId && m.role === 'pm')
    await admin.agent.delete(`/api/v1/orgs/${admin.orgId}/memberships/${ownPm.id}`).expect(200)
    await admin.agent.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B001').id }).expect(403)
    // ...though an Org Admin may still import (brief §4.3 / IMPORT_CMO).
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'Q2', building: 'B001' })] }).expect(201)

    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId })
    await architect.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B001').id }).expect(403)
    await pm.patch(`${base}/cmo/devices/${device.id}/assignment`).send({ buildingId: building('B001').id }).expect(200)
  })

  it('a View As session cannot import', async () => {
    const { admin, base, sal, projectId } = await setup()
    const session = (await admin.agent.post(`${base}/view-as`).send({ projectId, role: 'pm' }).expect(201)).body.session
    await admin.agent.post(`${base}/cmo/import`).set('X-View-As-Session', session.id).send({ salId: sal('ERL').id, rows: [row({ serial: 'V1' })] }).expect(403)
  })
})

describe('isolation', () => {
  it('another organisation cannot read or write this project’s CMO, and a device id from another project is not found', async () => {
    const { ctx, admin, base, sal, building } = await setup()
    await admin.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'ISO-1' })] }).expect(201)
    const device = (await admin.agent.get(`${base}/cmo`)).body.devices[0]

    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    await outsider.agent.get(`${base}/cmo`).expect(404)
    await outsider.agent.post(`${base}/cmo/import`).send({ salId: sal('ERL').id, rows: [row({ serial: 'X' })] }).expect(404)

    const second = await newProject(admin.agent, admin.orgId, { name: 'Second', code: 'SEC' })
    await admin.agent.patch(`${api(admin.orgId, second.projectId)}/cmo/devices/${device.id}/assignment`).send({ buildingId: second.building('B001').id }).expect(404)
    expect(building('B001').id).not.toBe(second.building('B001').id)
  })
})
