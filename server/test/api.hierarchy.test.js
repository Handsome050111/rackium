import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
})

const t = () => createTestApp()

async function newProject(admin) {
  const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)
  return res.body.project.id
}

const base = (orgId, projectId) => `/api/v1/orgs/${orgId}/projects/${projectId}/hierarchy`

async function buildChain(agent, orgId, projectId) {
  const country = await agent.post(`${base(orgId, projectId)}/countries`).send({ code: 'DE', name: 'Germany' }).expect(201)
  const sal = await agent.post(`${base(orgId, projectId)}/sals`).send({ countryId: country.body.countries.id, code: 'ERL' }).expect(201)
  const campus = await agent.post(`${base(orgId, projectId)}/campuses`).send({ salId: sal.body.sals.id, code: 'C01' }).expect(201)
  const building = await agent.post(`${base(orgId, projectId)}/buildings`).send({ campusId: campus.body.campuses.id, code: 'B001', name: 'Building B001' }).expect(201)
  const floor = await agent.post(`${base(orgId, projectId)}/floors`).send({ buildingId: building.body.buildings.id, token: 'EG', name: 'Ground floor', order: 0 }).expect(201)
  const room = await agent.post(`${base(orgId, projectId)}/rooms`).send({ floorId: floor.body.floors.id, code: 'TR-EG-01' }).expect(201)
  const rack = await agent.post(`${base(orgId, projectId)}/racks`).send({ roomId: room.body.rooms.id, code: 'R01', heightU: 42 }).expect(201)
  return { country: country.body.countries, sal: sal.body.sals, campus: campus.body.campuses, building: building.body.buildings, floor: floor.body.floors, room: room.body.rooms, rack: rack.body.racks }
}

describe('hierarchy CRUD', () => {
  it('an Org Admin creates the full chain country -> rack', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const chain = await buildChain(admin.agent, admin.orgId, projectId)
    expect(chain.rack.heightU).toBe(42)

    const tree = await admin.agent.get(`${base(admin.orgId, projectId)}`).expect(200)
    expect(tree.body.tree.countries).toHaveLength(1)
    expect(tree.body.tree.racks).toHaveLength(1)
  })

  it('a PM may also manage the full hierarchy', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId })
    await buildChain(pm, admin.orgId, projectId)
  })

  it('an Architect may create floor/room/rack but not country/SAL/campus/building', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const chain = await buildChain(admin.agent, admin.orgId, projectId)
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId })

    await architect.post(`${base(admin.orgId, projectId)}/countries`).send({ code: 'FR', name: 'France' }).expect(403)
    await architect.post(`${base(admin.orgId, projectId)}/floors`).send({ buildingId: chain.building.id, token: '1OG', name: 'First floor', order: 1 }).expect(201)
  })

  it('a Reviewer, Field Engineer or Viewer cannot write to the hierarchy', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    for (const role of ['reviewer', 'field_engineer', 'viewer']) {
      const member = await projectMember(ctx, admin, { email: `${role}@example.com`, role, projectId })
      await member.post(`${base(admin.orgId, projectId)}/countries`).send({ code: 'DE', name: 'Germany' }).expect(403)
    }
  })

  it('a create with a parent that does not exist is refused', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    await admin.agent.post(`${base(admin.orgId, projectId)}/sals`).send({ countryId: '65f0c0ffee0000000000c001', code: 'ERL' }).expect(400)
  })

  it('a rack height must be one the organisation allows', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const chain = await buildChain(admin.agent, admin.orgId, projectId)
    await admin.agent.post(`${base(admin.orgId, projectId)}/racks`).send({ roomId: chain.room.id, code: 'R02', heightU: 10 }).expect(400)
  })

  it('deleting a node with children is refused; deleting the children first allows it', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const chain = await buildChain(admin.agent, admin.orgId, projectId)

    await admin.agent.delete(`${base(admin.orgId, projectId)}/countries/${chain.country.id}`).expect(409)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/racks/${chain.rack.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/rooms/${chain.room.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/floors/${chain.floor.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/buildings/${chain.building.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/campuses/${chain.campus.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/sals/${chain.sal.id}`).expect(200)
    await admin.agent.delete(`${base(admin.orgId, projectId)}/countries/${chain.country.id}`).expect(200)
  })

  it('a hierarchy node belongs to its own project: another project in the same org gets 404', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = await newProject(admin)
    const resB = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'Other', code: 'OTH' }).expect(201)
    const projectB = resB.body.project.id
    const chainA = await buildChain(admin.agent, admin.orgId, projectA)

    const treeB = await admin.agent.get(`${base(admin.orgId, projectB)}`).expect(200)
    expect(treeB.body.tree.countries).toHaveLength(0)
    await admin.agent.delete(`${base(admin.orgId, projectB)}/countries/${chainA.country.id}`).expect(404)
  })

  it('a user with no role on this project cannot even reach it, though they are in the organisation', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectA = await newProject(admin)
    const resB = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'Other', code: 'OTH' }).expect(201)
    const projectB = resB.body.project.id
    const pmOfA = await projectMember(ctx, admin, { email: 'pma@example.com', role: 'pm', projectId: projectA })

    await pmOfA.get(`${base(admin.orgId, projectB)}`).expect(404)
  })
})

describe('hierarchy CSV/Excel import', () => {
  const ROW = { countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B001', buildingName: 'Building B001' }

  it('imports a full chain from flat rows, deduplicating repeated codes', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const res = await admin.agent
      .post(`${base(admin.orgId, projectId)}/import`)
      .send({ rows: [ROW, { ...ROW, buildingCode: 'B002', buildingName: 'Building B002' }] })
      .expect(201)
    expect(res.body.imported).toEqual({ countries: 1, sals: 1, campuses: 1, buildings: 2, wings: 0 })

    const tree = await admin.agent.get(`${base(admin.orgId, projectId)}`).expect(200)
    expect(tree.body.tree.buildings).toHaveLength(2)
  })

  it('refuses the whole import when a row is invalid, naming the row', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const res = await admin.agent
      .post(`${base(admin.orgId, projectId)}/import`)
      .send({ rows: [ROW, { ...ROW, buildingCode: '' }] })
      .expect(400)
    expect(res.body.error.details.rowErrors[0].index).toBe(1)
  })

  it('importing twice does not duplicate the country, SAL or campus', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    await admin.agent.post(`${base(admin.orgId, projectId)}/import`).send({ rows: [ROW] }).expect(201)
    await admin.agent.post(`${base(admin.orgId, projectId)}/import`).send({ rows: [{ ...ROW, buildingCode: 'B002', buildingName: 'Building B002' }] }).expect(201)
    const tree = await admin.agent.get(`${base(admin.orgId, projectId)}`).expect(200)
    expect(tree.body.tree.countries).toHaveLength(1)
    expect(tree.body.tree.sals).toHaveLength(1)
    expect(tree.body.tree.buildings).toHaveLength(2)
  })
})
