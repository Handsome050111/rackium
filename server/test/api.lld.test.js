import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { DEFAULT_STOCK_LENGTHS } from '@rackium/shared/cableLength.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { lldProject, lldView, secondBuilding } from './helpers/lld.js'
import { hldView } from './helpers/hld.js'
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
const PANEL = 'Generic Cat6A Patch Panel 24-port'
const registry = (filter) => mongoose.connection.db.collection('cableidregistries').find(filter).toArray()
const occupancy = (filter) => mongoose.connection.db.collection('portoccupancies').find(filter).toArray()

function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}

// The LLD of B001 started from the approved HLD, with helpers to find its
// devices and connections and to write with the current revision.
async function started(opts) {
  const p = await lldProject(t(), opts)
  await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
  return withDesign(p)
}
function withDesign(p) {
  const d = {
    p,
    view: (branchId = null, agent = p.architect) => lldView(agent, p, p.b001, branchId),
    rev: async (branchId = null) => (await d.view(branchId)).design.revision,
    // A design write with the current revision, read before the request is built.
    save: async (method, url, body = {}, { agent = p.architect, branchId = null } = {}) => {
      const baseRevision = await d.rev(branchId)
      return agent[method](url).send({ ...body, baseRevision })
    },
    device: async (role, branchId = null) => (await d.view(branchId)).devices.find((x) => x.inDesign && x.role === role),
    link: async (a, b, branchId = null) => {
      const v = await d.view(branchId)
      const id = (role) => v.devices.find((x) => x.inDesign && x.role === role).id
      return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [id(a), id(b)].sort().join())
    },
  }
  return d
}

// Places Border, Fusion and Edge, adds a patch panel in the Edge's rack and
// fills every port and cable ID: an LLD with no Critical finding.
async function complete(d) {
  const { p, save, device, link } = d
  const [mainRack, secondRack] = p.racks.map((r) => r.id)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('border')).id}/placement`, { rackId: mainRack, ru: 40, face: 'front' }), 200)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('fusion')).id}/placement`, { rackId: mainRack, ru: 38, face: 'front' }), 200)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('edge')).id}/placement`, { rackId: secondRack, ru: 40, face: 'front' }), 200)
  const panel = (await expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: secondRack, ru: 42, face: 'front' }), 201)).body.device
  expectStatus(await save('patch', `${p.lld}/connections/${(await link('border', 'fusion')).id}`, { source: { deviceId: (await device('border')).id, portId: 'Te1/1/1' }, dest: { deviceId: (await device('fusion')).id, portId: 'Te1/1/1' }, cableId: 'C-BF-1' }), 200)
  const be = await link('border', 'edge')
  const borderEnd = be.source.deviceId === (await device('border')).id ? 'source' : 'dest'
  expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { [borderEnd]: { deviceId: (await device('border')).id, portId: 'Te1/1/2' }, [borderEnd === 'source' ? 'dest' : 'source']: { deviceId: (await device('edge')).id, portId: 'Te1/1/1' }, cableId: 'C-BE-1' }), 200)
  const ea = await link('edge', 'ap')
  const edgeEnd = ea.source.deviceId === (await device('edge')).id ? 'source' : 'dest'
  expectStatus(
    await save('patch', `${p.lld}/connections/${ea.id}`, {
      [edgeEnd]: { deviceId: (await device('edge')).id, portId: 'Gi1/0/1' },
      [edgeEnd === 'source' ? 'dest' : 'source']: { deviceId: (await device('ap')).id, portId: 'Eth0' },
      hops: [{ patchPanelId: panel.id, inPort: '01', outPort: '01', segmentCableId: 'C-EA-1b' }],
      cableId: 'C-EA-1',
    }),
    200
  )
  return panel
}

describe('LLD derives from the latest approved HLD', () => {
  it('refused before the HLD is approved; a working copy of devices and uplinks that records the HLD version', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    const b002 = p.building('B002').id
    const refused = await p.architect.post(`${p.lld}/start`).send({ buildingId: b002 }).expect(409)
    expect(refused.body.error.code).toBe('hld_not_approved')
    expect((await lldView(p.architect, p, b002)).status).toBe('not_started')

    for (const agent of [p.fe, p.viewer, p.reviewer, p.admin.agent]) await agent.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(403)
    expect((await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)).body).toEqual({ revision: 0, basedOnHldNumber: 1 })
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(409)

    const view = await lldView(p.viewer, p)
    const hld = await hldView(p.architect, p)
    expect(view.hld).toMatchObject({ basedOnNumber: 1, latestApprovedNumber: 1, changed: false })
    const own = view.devices.filter((d) => d.inDesign)
    expect(own.map((d) => d.hostname).sort()).toEqual(hld.devices.map((d) => d.hostname).sort())
    // Copies, not the HLD records: new ids, each pointing back at its HLD device.
    for (const d of own) {
      expect(hld.devices.map((h) => h.id)).not.toContain(d.id)
      expect(hld.devices.map((h) => h.id)).toContain(d.hldRef)
    }
    expect(view.connections).toHaveLength(hld.connections.length)
    expect(view.connections.every((c) => c.hldRef && c.cableId === null)).toBe(true)
    // Surveyed gear is shown alongside (not copied).
    expect(view.devices.filter((d) => d.origin === 'existing' && !d.inDesign).length).toBeGreaterThan(0)
    expect(view.status).toBe('in_progress')
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'lld').status).toBe('in_progress')
    // The HLD is untouched by the LLD (its own layer).
    expect((await hldView(p.architect, p)).devices).toHaveLength(hld.devices.length)
  })

  it('every member reads within scope; other organisations and out-of-scope buildings are 404', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    for (const agent of [p.fe, p.viewer, p.reviewer, p.feB001, p.admin.agent]) await lldView(agent, p)
    await p.feB001.get(`${p.lld}/buildings/${p.building('B002').id}`).expect(404)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.lld}/buildings/${p.b001}`).expect(404)
    const view = await lldView(p.architect, p)
    const device = view.devices.find((d) => d.role === 'edge')
    await outsider.agent.put(`${p.lld}/devices/${device.id}/placement`).send({ rackId: p.racks[1].id, ru: 10, face: 'front', baseRevision: 0 }).expect(404)
    // Only the Architect edits.
    for (const agent of [p.fe, p.viewer, p.reviewer, p.admin.agent]) {
      await agent.put(`${p.lld}/devices/${device.id}/placement`).send({ rackId: p.racks[1].id, ru: 10, face: 'front', baseRevision: 0 }).expect(403)
    }
    // An HLD device id is not an LLD device.
    const hldEdge = (await hldView(p.architect, p)).devices.find((d) => d.role === 'edge')
    await p.architect.put(`${p.lld}/devices/${hldEdge.id}/placement`).send({ rackId: p.racks[1].id, ru: 10, face: 'front', baseRevision: 0 }).expect(404)
  })
})

describe('Rack elevations: shared rack rules against surveyed gear and the design', () => {
  it('places by RU and face; refuses overlap per face, the rack boundary and surveyed devices; 0U and full depth respected', async () => {
    const d = await started()
    const { p, save, device } = d
    const [mainRack] = p.racks.map((r) => r.id)
    // A surveyed switch at RU 20 (front) in the main rack.
    await p.fe
      .patch(`${p.base}/survey/racks/${mainRack}/placements`)
      .send({ placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }, { ru: 20, heightU: 2, face: 'front', mounting: 'rack', label: 'Old switch', category: 'Network' }] })
      .expect(200)
    const border = await device('border')
    const fusion = await device('fusion')
    expectStatus(await save('put', `${p.lld}/devices/${border.id}/placement`, { rackId: mainRack, ru: 10, face: 'front' }), 200)
    const overlap = expectStatus(await save('put', `${p.lld}/devices/${fusion.id}/placement`, { rackId: mainRack, ru: 10, face: 'front' }), 400)
    expect(overlap.body.error.message).toMatch(/F-DE-ERL/)
    // The rear face of the same RU is free (not full depth).
    expectStatus(await save('put', `${p.lld}/devices/${fusion.id}/placement`, { rackId: mainRack, ru: 10, face: 'rear' }), 200)
    // Surveyed gear is respected; so is the rack boundary.
    expectStatus(await save('put', `${p.lld}/devices/${fusion.id}/placement`, { rackId: mainRack, ru: 21, face: 'front' }), 400)
    expectStatus(await save('put', `${p.lld}/devices/${fusion.id}/placement`, { rackId: mainRack, ru: 43, face: 'front' }), 400)
    // A rack-mounted device without an RU is a Critical finding, an AP is not.
    const val = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    const placement = val.findings.filter((f) => f.rule === 'L-PLACEMENT')
    expect(placement.map((f) => f.message)).toEqual([expect.stringMatching(/^E-DE-ERL.*has a rack but no RU$/)])
    // The elevation shows surveyed and planned items with free RU per face.
    const rack = (await d.view()).racks.find((r) => r.id === mainRack)
    expect(rack.placements.filter((x) => x.planned).map((x) => [x.ru, x.face])).toEqual(expect.arrayContaining([[10, 'front'], [10, 'rear']]))
    expect(rack.placements.some((x) => x.label === 'Old switch' && !x.planned)).toBe(true)
    // Regression: surveyed 0U gear keeps its rail, or the elevation cannot draw it.
    expect(rack.placements.find((x) => x.label === 'PDU-A')).toMatchObject({ mounting: '0U', railSide: 'left', face: 'rear' })
    // Front: the Border (1U) and the surveyed switch (2U); rear: the Fusion.
    expect(rack.freeRuByFace).toMatchObject({ front: { availableRU: 39 }, rear: { availableRU: 41 } })
    // Unplace.
    expectStatus(await save('put', `${p.lld}/devices/${fusion.id}/placement`, { rackId: null, ru: null }), 200)
    expect((await device('fusion')).rackId).toBeNull()
    // Patch panels and cable managers come from the catalogue; switches do not.
    expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: 'Cisco C9300-48UX', rackId: mainRack, ru: 30, face: 'front' }), 400)
    const cm = (await expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: 'Generic Cable Manager 1U', rackId: mainRack, ru: 30, face: 'front' }), 201)).body.device
    expect(cm).toMatchObject({ label: 'CM-R01-01', ru: 30, category: 'cable_management' })
    expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: mainRack, ru: 30, face: 'front' }), 400)
  })
})

describe('Rackium Editor: ports, patch-panel hops and the occupancy registry', () => {
  it('exact catalogue ports; a hop takes the panel rear in and front out; double booking is impossible', async () => {
    const d = await started()
    const { p, save, device, link } = d
    const panel = await complete(d)
    const view = await d.view()
    const ea = view.connections.find((c) => c.hops.length)
    expect(ea).toMatchObject({ cableId: 'C-EA-1', hops: [{ seq: 1, patchPanelId: panel.id, inPort: '01', outPort: '01', segmentCableId: 'C-EA-1b', rackId: p.racks[1].id }] })
    const panelView = view.devices.find((x) => x.id === panel.id)
    expect(panelView.ports).toHaveLength(24)
    expect(panelView.occupied.map((o) => o.portKey).sort()).toEqual(['01#front', '01#rear'])
    expect(view.devices.find((x) => x.role === 'edge').occupied.map((o) => o.portKey).sort()).toEqual(['gi1/0/1', 'te1/1/1'])

    // A port that does not exist on the model is refused.
    const bf = await link('border', 'fusion')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { source: { deviceId: bf.source.deviceId, portId: 'Gi9/9/9' } }), 400)
    // The same Edge port on a new connection is refused and nothing is written.
    const before = await occupancy({})
    const clash = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'GI1/0/1' }, dest: { deviceId: (await device('ap')).id, portId: null }, media: 'cat6a', speed: '1G' }), 409)
    expect(clash.body.error.code).toBe('port_in_use')
    expect(await occupancy({})).toHaveLength(before.length)
    // The panel's front 01 is taken; its rear 02 and front 02 are free.
    expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'Gi1/0/2' }, dest: { deviceId: (await device('ap')).id, portId: null }, media: 'cat6a', speed: '1G', hops: [{ patchPanelId: panel.id, inPort: '02', outPort: '01' }] }), 409)
    const second = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'Gi1/0/2' }, dest: { deviceId: panel.id, portId: '02' }, media: 'cat6a', speed: '1G' }), 201)
    // A cable ending on a panel lands on its front.
    expect((await occupancy({ connectionId: new mongoose.Types.ObjectId(second.body.connection.id) })).map((o) => o.portKey).sort()).toEqual(['02#front', 'gi1/0/2'])
    // A hop must be on a patch panel.
    expectStatus(await save('patch', `${p.lld}/connections/${second.body.connection.id}`, { hops: [{ patchPanelId: (await device('edge')).id, inPort: 'Gi1/0/3', outPort: 'Gi1/0/4' }] }), 400)
    // Deleting a connection frees its ports.
    expectStatus(await p.architect.delete(`${p.lld}/connections/${second.body.connection.id}?baseRevision=${await d.rev()}`), 200)
    expect(await occupancy({ portKey: '02#front' })).toHaveLength(0)
    // A panel carrying hops cannot be deleted.
    const blocked = expectStatus(await p.architect.delete(`${p.lld}/devices/${panel.id}?baseRevision=${await d.rev()}`), 409)
    expect(blocked.body.error.code).toBe('panel_in_use')
  })

  it('ports in the HLD and the LLD are separate registries', async () => {
    const d = await started()
    const { p, save, link } = d
    const bf = await link('border', 'fusion')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { source: { deviceId: bf.source.deviceId, portId: 'Te1/1/5' } }), 200)
    // The same port in the HLD is still free there.
    const hld = await hldView(p.architect, p)
    const hldBf = hld.connections.find((c) => c.id === bf.hldRef)
    await p.architect.patch(`${p.hld}/uplinks/${hldBf.id}`).send({ source: { deviceId: hldBf.source.deviceId, portId: 'Te1/1/5' }, baseRevision: hld.design.revision }).expect(200)
    expect(await occupancy({ portKey: 'te1/1/5' })).toHaveLength(2)
  })
})

describe('Cable IDs: unique per project, case-insensitive, never reused', () => {
  it('suggests the next free 8-digit ID; free text up to 32; connection and hop segment IDs share the namespace', async () => {
    const d = await started()
    const { p, save, link } = d
    expect((await d.view()).cableIdSuggestion).toBe('26184735')
    const bf = await link('border', 'fusion')
    const be = await link('border', 'edge')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: '26184735' }), 200)
    expect((await d.view()).cableIdSuggestion).toBe('26184736')
    expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { cableId: 'x'.repeat(33) }), 400)
    expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { cableId: 'Trunk A/B #7' }), 200)
    // Case-insensitive.
    const dup = expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'TRUNK a/b #7' }), 409)
    expect(dup.body.error.code).toBe('cable_id_in_use')
    // Retired IDs are never reused: bf drops 26184735 for a new ID …
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'BF-NEW' }), 200)
    const retired = expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { cableId: '26184735' }), 409)
    expect(retired.body.error.message).toMatch(/never reused/)
    // … the suggestion skips it too; bf may take its own ID back.
    expect((await d.view()).cableIdSuggestion).toBe('26184736')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: '26184735' }), 200)
    // VAL-013 cannot arise: the registry refuses the duplicate up front.
    const val = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    expect(val.findings.filter((f) => f.rule === 'VAL-013')).toEqual([])
  })

  it('concurrent requests: exactly one wins a cable ID across buildings, and a revision across writers', async () => {
    const d = await started()
    const { p, link } = d
    const b002 = await secondBuilding(p)
    const d2 = withDesign({ ...p, b001: b002 })
    // Two buildings' LLDs (independent revisions) race for the same new ID, several rounds.
    for (let round = 0; round < 4; round++) {
      const [c1, c2] = [await link('border', 'fusion'), await d2.link('border', 'fusion')]
      const [r1, r2] = [await d.rev(), await d2.rev()]
      const id = `RACE-${round}`
      const results = await Promise.all([
        p.architect.patch(`${p.lld}/connections/${c1.id}`).send({ cableId: id, baseRevision: r1 }),
        p.architect.patch(`${p.lld}/connections/${c2.id}`).send({ cableId: id, baseRevision: r2 }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
      expect(results.find((r) => r.status === 409).body.error.code).toBe('cable_id_in_use')
      expect(await registry({ layer: 'lld', cableKey: id.toLowerCase() })).toHaveLength(1)
    }
    // Five writers on one design with the same revision: one wins, four are stale; one port row.
    const be = await link('border', 'edge')
    const rev = await d.rev()
    const ports = ['Te1/1/10', 'Te1/1/11', 'Te1/1/12', 'Te1/1/13', 'Te1/1/14']
    const results = await Promise.all(ports.map((portId) => p.architect.patch(`${p.lld}/connections/${be.id}`).send({ cableId: `W-${portId}`, source: { deviceId: be.source.deviceId, portId }, baseRevision: rev })))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'stale_revision')).toBe(true)
    expect(await occupancy({ layer: 'lld', connectionId: new mongoose.Types.ObjectId(be.id) })).toHaveLength(1)
    expect((await registry({ layer: 'lld', connectionId: new mongoose.Types.ObjectId(be.id), status: 'reserved' })).map((r) => r.cableId)).toHaveLength(1)

    // Regression: the 'lld' layer spans the project — restoring or promoting
    // in B001 must leave B002's ports and cable IDs alone.
    const c2 = await d2.link('border', 'fusion')
    expectStatus(await d2.save('patch', `${p.lld}/connections/${c2.id}`, { source: { deviceId: c2.source.deviceId, portId: 'Te1/1/3' } }), 200)
    const b002Ids = (await d2.view()).connections.map((c) => new mongoose.Types.ObjectId(c.id))
    const b002State = async () => ({
      ports: (await occupancy({ connectionId: { $in: b002Ids } })).length,
      reserved: (await registry({ connectionId: { $in: b002Ids }, status: 'reserved' })).map((r) => r.cableKey).sort(),
    })
    const before = await b002State()
    expect(before.ports).toBeGreaterThan(0)
    expect(before.reserved.length).toBeGreaterThan(0)
    const v1 = (await p.architect.post(`${p.lld}/versions`).send({ buildingId: p.b001, label: 'B001 snapshot' }).expect(201)).body
    expectStatus(await d.save('post', `${p.lld}/versions/${v1.versionId}/restore`, {}), 200)
    expect(await b002State()).toEqual(before)
    const branch = (await p.architect.post(`${p.lld}/branches`).send({ buildingId: p.b001, name: 'B001 option' }).expect(201)).body.branch
    expectStatus(await d.save('post', `${p.lld}/branches/${branch.id}/promote`, {}), 200)
    expect(await b002State()).toEqual(before)
  })

  it('a branch and the main LLD writing at the same time cannot both take a new ID', async () => {
    const d = await started()
    const { p, link } = d
    const branch = (await p.architect.post(`${p.lld}/branches`).send({ buildingId: p.b001, name: 'Option B' }).expect(201)).body.branch
    // A branch copy keeps its own cable's IDs only, never another cable's.
    const onBranch = { save: (url, body) => d.save('patch', url, body, { branchId: branch.id }) }
    expectStatus(await d.save('patch', `${p.lld}/connections/${(await link('border', 'edge')).id}`, { cableId: 'MAIN-BE' }), 200)
    const stolen = expectStatus(await onBranch.save(`${p.lld}/connections/${(await link('border', 'fusion', branch.id)).id}`, { cableId: 'MAIN-BE' }), 409)
    expect(stolen.body.error.code).toBe('cable_id_in_use')
    expectStatus(await onBranch.save(`${p.lld}/connections/${(await link('border', 'edge', branch.id)).id}`, { cableId: 'MAIN-BE' }), 200)
    // Two different cables race for a new ID: one on the main LLD, one on the branch.
    for (let round = 0; round < 3; round++) {
      const main = await link('border', 'fusion')
      const onBranch = await link('edge', 'ap', branch.id)
      const id = `BR-${round}`
      const [mainRev, branchRev] = [await d.rev(), await d.rev(branch.id)]
      const results = await Promise.all([
        p.architect.patch(`${p.lld}/connections/${main.id}`).send({ cableId: id, baseRevision: mainRev }),
        p.architect.patch(`${p.lld}/connections/${onBranch.id}`).send({ cableId: id, baseRevision: branchRev }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    }
  })
})

describe('Cable lengths: Suggested, Engineer Selected, Estimated', () => {
  it('suggested from the shared formulas rounded up to the organisation stock table; engineer value editable; estimated when the pathway is', async () => {
    const d = await started()
    const { p, save, link } = d
    let be = await link('border', 'edge')
    expect(be.length).toMatchObject({ lengthM: 44, suggestedM: 50, lengthEstimated: false, situation: 'cross-room' })
    expect(be.lengths).toMatchObject({ suggestedM: 50, engineerSelectedM: null, effectiveM: 50, installedM: null })
    // The organisation's stock table changes the rounding (VAL-012 when nothing is long enough).
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ stockLengths: { ...DEFAULT_STOCK_LENGTHS, os2: [45, 100] } }).expect(200)
    expect((await link('border', 'edge')).length.suggestedM).toBe(45)
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ stockLengths: { ...DEFAULT_STOCK_LENGTHS, os2: [5, 10] } }).expect(200)
    expect((await link('border', 'edge')).length).toMatchObject({ suggestedM: null, customLengthRequired: true })
    let val = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    expect(val.findings.find((f) => f.rule === 'VAL-012')).toMatchObject({ severity: 'warning' })
    // Engineer Selected overrides; it is recorded as such.
    expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 47 }), 200)
    be = await link('border', 'edge')
    expect(be.lengths).toMatchObject({ engineerSelectedM: 47, effectiveM: 47 })
    // An estimated pathway makes the length Estimated.
    const pathway = (await p.architect.get(`${p.base}/survey/pathways`).expect(200)).body.pathways[0]
    await p.architect.patch(`${p.base}/survey/pathways/${pathway.id}`).send({ routeStatus: 'estimated' }).expect(200)
    expect((await link('border', 'edge')).length).toMatchObject({ lengthEstimated: true, estimateReason: 'Pathway route is marked Estimated' })
    // VAL-011: beyond the medium's limit.
    await p.architect.patch(`${p.base}/survey/pathways/${pathway.id}`).send({ routeStatus: 'surveyed', distanceM: 12000 }).expect(200)
    val = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    expect(val.findings.find((f) => f.rule === 'VAL-011')).toMatchObject({ severity: 'critical' })
  })
})

describe('Design versions and branches (brief §6.10)', () => {
  it('save with a label, history, diff between versions, restore keeps ids and cable IDs', async () => {
    const d = await started()
    const { p, save, device, link } = d
    const bf = await link('border', 'fusion')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'V1-ID' }), 200)
    await p.viewer.post(`${p.lld}/versions`).send({ buildingId: p.b001, label: 'nope' }).expect(403)
    const v1 = (await p.architect.post(`${p.lld}/versions`).send({ buildingId: p.b001, label: 'Before panels' }).expect(201)).body
    expect(v1.number).toBe(1)
    // Change: place the Border, swap the cable ID, add a panel.
    const border = await device('border')
    expectStatus(await save('put', `${p.lld}/devices/${border.id}/placement`, { rackId: p.racks[0].id, ru: 12, face: 'front' }), 200)
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'V2-ID' }), 200)
    const panel = (await expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: p.racks[0].id, ru: 30, face: 'front' }), 201)).body.device
    const v2 = (await p.architect.post(`${p.lld}/versions`).send({ buildingId: p.b001, label: 'With panel' }).expect(201)).body
    const view = await d.view()
    expect(view.versions.map((v) => [v.number, v.label, v.frozen])).toEqual([
      [2, 'With panel', false],
      [1, 'Before panels', false],
    ])

    const diff = (await p.viewer.get(`${p.lld}/versions/diff?buildingId=${p.b001}&from=${v1.versionId}&to=${v2.versionId}`).expect(200)).body
    expect(diff).toMatchObject({ from: 'v1 Before panels', to: 'v2 With panel' })
    expect(diff.devices.added.map((x) => x.label)).toEqual([panel.label])
    expect(diff.devices.changed).toEqual([{ id: border.id, label: border.hostname, fields: [{ field: 'ru', before: null, after: 12 }] }])
    expect(diff.connections.changed[0].fields).toEqual([{ field: 'cableId', before: 'V1-ID', after: 'V2-ID' }])
    expect((await p.viewer.get(`${p.lld}/versions/diff?buildingId=${p.b001}&from=${v2.versionId}&to=current`).expect(200)).body.total).toBe(0)

    // Restore v1: the panel goes, the Border is unplaced, the connection gets V1-ID back (same id).
    expectStatus(await save('post', `${p.lld}/versions/${v1.versionId}/restore`, {}), 200)
    const restored = await d.view()
    expect(restored.devices.some((x) => x.id === panel.id)).toBe(false)
    expect(restored.devices.find((x) => x.id === border.id)).toMatchObject({ ru: null })
    expect(restored.connections.find((c) => c.id === bf.id)).toMatchObject({ cableId: 'V1-ID' })
    expect(restored.versions).toHaveLength(2) // versions themselves are unchanged
    // V2-ID is retired (never reused), V1-ID reserved again.
    expect((await registry({ layer: 'lld', cableKey: { $in: ['v1-id', 'v2-id'] } })).map((r) => [r.cableKey, r.status]).sort()).toEqual([
      ['v1-id', 'reserved'],
      ['v2-id', 'retired'],
    ])
  })

  it('branches: edits stay on the branch until promoted (no merge); discard is terminal; both are audited', async () => {
    const d = await started()
    const { p, save, device, link } = d
    const b1 = (await p.architect.post(`${p.lld}/branches`).send({ buildingId: p.b001, name: 'Option A' }).expect(201)).body.branch
    const bView = await d.view(b1.id)
    expect(bView.branch).toMatchObject({ id: b1.id, name: 'Option A', status: 'open' })
    expect(bView.devices.filter((x) => x.inDesign).map((x) => x.hostname).sort()).toEqual((await d.view()).devices.filter((x) => x.inDesign).map((x) => x.hostname).sort())
    // An edit on the branch (its own revision) leaves the main LLD alone.
    const edgeOnBranch = await device('edge', b1.id)
    expectStatus(await save('put', `${p.lld}/devices/${edgeOnBranch.id}/placement`, { rackId: p.racks[1].id, ru: 5, face: 'front' }, { branchId: b1.id }), 200)
    const bf = await link('border', 'fusion', b1.id)
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'BRANCH-1' }, { branchId: b1.id }), 200)
    expect((await device('edge')).ru).toBeNull()
    expect((await d.view()).design.revision).toBe(0)
    const diff = (await p.architect.get(`${p.lld}/versions/diff?buildingId=${p.b001}&from=current&to=current:${b1.id}`).expect(200)).body
    expect(diff.to).toBe('Branch (current)')
    // A version saved on the branch records it.
    const bv = (await p.architect.post(`${p.lld}/versions`).send({ buildingId: p.b001, branchId: b1.id, label: 'Option A draft' }).expect(201)).body
    expect((await d.view()).versions.find((v) => v.id === bv.versionId).branchId).toBe(b1.id)

    // Promote: the branch replaces the main LLD.
    expectStatus(await save('post', `${p.lld}/branches/${b1.id}/promote`, {}), 200)
    expect((await device('edge')).ru).toBe(5)
    expect((await link('border', 'fusion')).cableId).toBe('BRANCH-1')
    expect((await d.view()).branches.find((b) => b.id === b1.id).status).toBe('promoted')
    // A promoted branch is closed (its devices are now the main design's).
    expect((await device('edge')).id).toBe(edgeOnBranch.id)
    const closed = expectStatus(await save('post', `${p.lld}/versions`, { buildingId: p.b001, branchId: b1.id, label: 'late' }), 409)
    expect(closed.body.error.code).toBe('branch_closed')
    await p.architect.post(`${p.lld}/branches/${b1.id}/discard`).expect(409)

    // Discard: everything on the branch goes; its new cable IDs stay used.
    const b2 = (await p.architect.post(`${p.lld}/branches`).send({ buildingId: p.b001, name: 'Option B' }).expect(201)).body.branch
    const bf2 = await link('border', 'fusion', b2.id)
    expectStatus(await save('patch', `${p.lld}/connections/${bf2.id}`, { cableId: 'ONLY-ON-B' }, { branchId: b2.id }), 200)
    await p.architect.post(`${p.lld}/branches/${b2.id}/discard`).expect(200)
    expect(await mongoose.connection.db.collection('devices').countDocuments({ layer: `lld:${b2.id}` })).toBe(0)
    expect(await occupancy({ layer: `lld:${b2.id}` })).toHaveLength(0)
    const reuse = expectStatus(await save('patch', `${p.lld}/connections/${(await link('edge', 'ap')).id}`, { cableId: 'ONLY-ON-B' }), 409)
    expect(reuse.body.error.code).toBe('cable_id_in_use')
    const audit = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body.recentActivity.map((a) => a.action)
    expect(audit).toEqual(expect.arrayContaining(['lld.branch.created', 'lld.branch.promoted', 'lld.branch.discarded']))
  })
})

describe('Hostname rename (Architect/PM)', () => {
  it('previews, applies in one transaction with audit, refuses clashes, and is blocked after LLD approval', async () => {
    const d = await started()
    const { p, save, device } = d
    const edge = await device('edge')
    const border = await device('border')
    await p.reviewer.post(`${p.lld}/rename/preview`).send({ buildingId: p.b001, renames: [{ deviceId: edge.id, hostname: 'EDGE-NEW' }] }).expect(403)
    const preview = (await p.admin.agent.post(`${p.lld}/rename/preview`).send({ buildingId: p.b001, renames: [{ deviceId: edge.id, hostname: 'EDGE-NEW' }, { deviceId: border.id, hostname: edge.hostname }] }).expect(200)).body
    expect(preview.rows).toEqual([
      { deviceId: edge.id, from: edge.hostname, to: 'EDGE-NEW', problem: null },
      { deviceId: border.id, from: border.hostname, to: edge.hostname, problem: null },
    ])
    const clash = (await p.admin.agent.post(`${p.lld}/rename/preview`).send({ buildingId: p.b001, renames: [{ deviceId: border.id, hostname: edge.hostname }] }).expect(200)).body
    expect(clash.rows[0].problem).toMatch(/share this hostname/)
    expectStatus(await save('post', `${p.lld}/rename`, { buildingId: p.b001, renames: [{ deviceId: border.id, hostname: edge.hostname }] }, { agent: p.admin.agent }), 409)
    // A swap-style rename works (PM).
    expectStatus(await save('post', `${p.lld}/rename`, { buildingId: p.b001, renames: [{ deviceId: edge.id, hostname: 'EDGE-NEW' }, { deviceId: border.id, hostname: edge.hostname }] }, { agent: p.admin.agent }), 200)
    expect((await device('edge')).hostname).toBe('EDGE-NEW')
    expect((await device('border')).hostname).toBe(edge.hostname)
    // The HLD keeps its names (separate layer).
    expect((await hldView(p.architect, p)).devices.find((x) => x.role === 'edge').hostname).toBe(edge.hostname)
    const audit = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body.recentActivity
    expect(audit.find((a) => a.action === 'device.hostname.renamed')).toBeTruthy()
    // Regenerate restores the naming-code hostnames.
    const regen = (await p.architect.post(`${p.lld}/rename/preview`).send({ buildingId: p.b001, regenerate: true }).expect(200)).body
    expect(regen.rows.find((r) => r.deviceId === edge.id)).toMatchObject({ from: 'EDGE-NEW', to: edge.hostname })
  })
})

describe('Reconciliation when a newer HLD is approved (no automatic re-sync)', () => {
  it('banner flag, side-by-side differences, explicit copy, and mark reviewed', async () => {
    const d = await started()
    const { p, save } = d
    // HLD v2: a firewall in the main room.
    let hld = await hldView(p.architect, p)
    const fw = (await p.architect.post(`${p.hld}/devices`).send({ buildingId: p.b001, role: 'firewall', roomId: p.rooms.main.id, baseRevision: hld.design.revision }).expect(201)).body.device
    hld = await hldView(p.architect, p)
    const submitted = await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision: hld.design.revision })
    expectStatus(submitted, 201)
    await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)

    let view = await d.view()
    expect(view.hld).toMatchObject({ basedOnNumber: 1, latestApprovedNumber: 2, changed: true })
    // Nothing was copied automatically.
    expect(view.devices.some((x) => x.hldRef === fw.id)).toBe(false)
    const rec = (await p.viewer.get(`${p.lld}/buildings/${p.b001}/reconciliation`).expect(200)).body
    expect(rec).toMatchObject({ basedOnNumber: 1, hldNumber: 2, changed: true })
    expect(rec.devices.inHldOnly.map((x) => x.id)).toEqual([fw.id])

    expectStatus(await save('post', `${p.lld}/copy-from-hld`, { buildingId: p.b001, hldDeviceIds: [fw.id] }), 200)
    expectStatus(await save('post', `${p.lld}/copy-from-hld`, { buildingId: p.b001, hldDeviceIds: [fw.id] }), 409)
    view = await d.view()
    expect(view.devices.find((x) => x.hldRef === fw.id)).toMatchObject({ role: 'firewall', hostname: fw.hostname })
    expect((await p.viewer.get(`${p.lld}/buildings/${p.b001}/reconciliation`).expect(200)).body.devices.inHldOnly).toEqual([])
    expectStatus(await save('post', `${p.lld}/rebase`, { buildingId: p.b001 }), 200)
    expect((await d.view()).hld).toMatchObject({ basedOnNumber: 2, changed: false })
  })
})

describe('LLD workflow (generic Approval record)', () => {
  it('Critical findings block submit; submit locks; Architect cannot approve own work; approval freezes; rename then needs a change request', async () => {
    const d = await started()
    const { p, save } = d
    const blocked = expectStatus(await save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 409)
    expect(blocked.body.error.code).toBe('validation_blocked')
    expect(new Set(blocked.body.error.details.findings.map((f) => f.rule))).toEqual(new Set(['L-PORT', 'L-CABLE-ID', 'L-PLACEMENT']))
    await complete(d)
    const val = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    expect(val.summary.critical, JSON.stringify(val.findings.filter((f) => f.severity === 'critical'))).toBe(0)

    expectStatus(await save('post', `${p.lld}/submit`, { buildingId: p.b001 }, { agent: p.reviewer }), 403)
    const submitted = expectStatus(await save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201).body
    let view = await d.view()
    expect(view).toMatchObject({ status: 'awaiting_approval', approvals: [{ status: 'pending', submittedBy: 'architect', versionNumber: submitted.versionNumber }] })
    const locked = expectStatus(await save('patch', `${p.lld}/connections/${view.connections[0].id}`, { cableId: 'LOCKED' }), 409)
    expect(locked.body.error.code).toBe('lld_submitted')

    await p.architect.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(403)
    await p.reviewer.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested' }).expect(400)
    await p.reviewer.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested', comment: 'Label the panel' }).expect(200)
    expect((await d.view()).status).toBe('changes_requested')
    const again = expectStatus(await save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201).body
    await p.admin.agent.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
    view = await d.view()
    expect(view.status).toBe('approved')
    expect(view.versions.find((v) => v.number === again.versionNumber).frozen).toBe(true)
    expect(view.renameLocked).toBe(true)
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'lld').status).toBe('approved')
    const projects = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/projects`).expect(200)).body.projects
    expect(projects[0].buildings.find((b) => b.id === p.b001).progress).toBeGreaterThan(0)

    const edge = view.devices.find((x) => x.inDesign && x.role === 'edge')
    const rename = expectStatus(await save('post', `${p.lld}/rename`, { buildingId: p.b001, renames: [{ deviceId: edge.id, hostname: 'AFTER-APPROVAL' }] }), 409)
    expect(rename.body.error.code).toBe('change_request_required')
  })

  it('stale saves are refused and name who changed the design', async () => {
    const d = await started()
    const { p, link } = d
    const bf = await link('border', 'fusion')
    const rev = await d.rev()
    await p.architect.patch(`${p.lld}/connections/${bf.id}`).send({ cableId: 'FIRST', baseRevision: rev }).expect(200)
    const stale = await p.architect.patch(`${p.lld}/connections/${bf.id}`).send({ cableId: 'SECOND', baseRevision: rev }).expect(409)
    expect(stale.body.error).toMatchObject({ code: 'stale_revision', details: { revision: rev + 1, lastEditedBy: 'architect' } })
  })
})
