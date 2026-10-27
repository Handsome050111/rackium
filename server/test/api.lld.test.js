import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { DEFAULT_STOCK_LENGTHS } from '@rackium/shared/cableLength.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { lldProject, lldView, secondBuilding, withDesign, complete, PANEL } from './helpers/lld.js'
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
    expect(cm).toMatchObject({ label: 'CM-TR-EG-01-R01-01', ru: 30, category: 'cable_management' })
    expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: mainRack, ru: 30, face: 'front' }), 400)
  })
})

describe('Rackium Editor: ports, patch-panel hops and the occupancy registry', () => {
  it('exact catalogue ports; patch cords take the panel front; double booking is impossible', async () => {
    const d = await started()
    const { p, save, device, link } = d
    const panel = await complete(d)
    const view = await d.view()
    const ea = view.connections.find((c) => c.hops.length)
    expect(ea).toMatchObject({ cableId: 'C-EA-1', hops: [{ seq: 1, patchPanelId: panel.id, inPort: '01', inSide: 'front', outPort: '02', outSide: 'front', segmentCableId: 'C-EA-1b', rackId: p.racks[1].id }] })
    const panelView = view.devices.find((x) => x.id === panel.id)
    expect(panelView.ports).toHaveLength(24)
    // Sides taken, plus one pair row per panel port (front and rear stay in this connection).
    expect(panelView.occupied.map((o) => o.portKey).sort()).toEqual(['01#front', '01#pair', '02#front', '02#pair'])
    expect(view.devices.find((x) => x.role === 'edge').occupied.map((o) => o.portKey).sort()).toEqual(['gi1/0/1', 'te1/1/1'])

    // A port that does not exist on the model is refused.
    const bf = await link('border', 'fusion')
    expectStatus(await save('patch', `${p.lld}/connections/${bf.id}`, { source: { deviceId: bf.source.deviceId, portId: 'Gi9/9/9' } }), 400)
    // The same Edge port on a new connection is refused and nothing is written.
    const before = await occupancy({})
    const clash = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'GI1/0/1' }, dest: { deviceId: (await device('ap')).id, portId: null }, media: 'cat6a', speed: '1G' }), 409)
    expect(clash.body.error.code).toBe('port_in_use')
    expect(await occupancy({})).toHaveLength(before.length)
    // The panel's front 01 is taken (its rear 01 is still free).
    expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'Gi1/0/2' }, dest: { deviceId: (await device('ap')).id, portId: null }, media: 'cat6a', speed: '1G', hops: [{ patchPanelId: panel.id, inPort: '03', outPort: '01' }] }), 409)
    const second = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, source: { deviceId: (await device('edge')).id, portId: 'Gi1/0/2' }, dest: { deviceId: panel.id, portId: '03' }, media: 'cat6a', speed: '1G' }), 201)
    // A cable ending on a panel lands on its front.
    expect((await occupancy({ connectionId: new mongoose.Types.ObjectId(second.body.connection.id) })).map((o) => o.portKey).sort()).toEqual(['03#front', '03#pair', 'gi1/0/2'])
    // A hop must be on a patch panel.
    expectStatus(await save('patch', `${p.lld}/connections/${second.body.connection.id}`, { hops: [{ patchPanelId: (await device('edge')).id, inPort: 'Gi1/0/3', outPort: 'Gi1/0/4' }] }), 400)
    // Deleting a connection frees its ports.
    expectStatus(await p.architect.delete(`${p.lld}/connections/${second.body.connection.id}?baseRevision=${await d.rev()}`), 200)
    expect(await occupancy({ portKey: '03#front' })).toHaveLength(0)
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

describe('Patch-panel sides by cable type (M4b review)', () => {
  // A patch cord (device↔panel) lands on the panel FRONT; a trunk (panel↔panel) on the REAR.
  async function twoPanels(d) {
    const panel2 = await complete(d) // PP in the Edge's rack (second room)
    const panel1 = (await expectStatus(await d.save('post', `${d.p.lld}/devices`, { buildingId: d.p.b001, catalogueKey: PANEL, rackId: d.p.racks[0].id, ru: 30, face: 'front' }), 201)).body.device
    return { panel1, panel2 }
  }
  // Port sides booked (pair rows are covered by the one-connection-per-port tests).
  const bookedBy = async (connectionId) => (await occupancy({ connectionId: new mongoose.Types.ObjectId(connectionId), source: { $ne: 'pair' } })).map((o) => `${o.deviceId}:${o.portKey}`).sort()
  async function routeBothWays(d, forward, backward) {
    const { p, save } = d
    const one = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, media: 'cat6a', speed: '1G', ...forward }), 201).body.connection
    const there = await bookedBy(one.id)
    expectStatus(await p.architect.delete(`${p.lld}/connections/${one.id}?baseRevision=${await d.rev()}`), 200)
    const two = expectStatus(await save('post', `${p.lld}/connections`, { buildingId: p.b001, media: 'cat6a', speed: '1G', ...backward }), 201).body.connection
    return { one, two, there, back: await bookedBy(two.id) }
  }

  it('two panels: Edge → PP-02 front | rear → PP-01 rear | front → Border, identical when drawn from the Border end', async () => {
    const d = await started()
    const { panel1, panel2 } = await twoPanels(d)
    const edge = await d.device('edge')
    const border = await d.device('border')
    const { one, two, there, back } = await routeBothWays(
      d,
      { source: { deviceId: edge.id, portId: 'Gi1/0/5' }, dest: { deviceId: border.id, portId: 'Te1/1/9' }, hops: [{ patchPanelId: panel2.id, inPort: '05', outPort: '05' }, { patchPanelId: panel1.id, inPort: '07', outPort: '07' }] },
      { source: { deviceId: border.id, portId: 'Te1/1/9' }, dest: { deviceId: edge.id, portId: 'Gi1/0/5' }, hops: [{ patchPanelId: panel1.id, inPort: '07', outPort: '07' }, { patchPanelId: panel2.id, inPort: '05', outPort: '05' }] }
    )
    expect(one.hops.map((h) => [h.inSide, h.outSide])).toEqual([['front', 'rear'], ['rear', 'front']])
    expect(two.hops.map((h) => [h.inSide, h.outSide])).toEqual([['front', 'rear'], ['rear', 'front']])
    expect(there).toEqual([`${border.id}:te1/1/9`, `${edge.id}:gi1/0/5`, `${panel1.id}:07#front`, `${panel1.id}:07#rear`, `${panel2.id}:05#front`, `${panel2.id}:05#rear`].sort())
    expect(back).toEqual(there)
  })

  it('one panel between two devices: both patch cords on its front, identical from either end; a trunk between panels on both rears', async () => {
    const d = await started()
    const { panel1, panel2 } = await twoPanels(d)
    const edge = await d.device('edge')
    const fusion = await d.device('fusion')
    const { one, there, back } = await routeBothWays(
      d,
      { source: { deviceId: edge.id, portId: 'Gi1/0/6' }, dest: { deviceId: fusion.id, portId: 'Te1/1/9' }, hops: [{ patchPanelId: panel2.id, inPort: '06', outPort: '07' }] },
      { source: { deviceId: fusion.id, portId: 'Te1/1/9' }, dest: { deviceId: edge.id, portId: 'Gi1/0/6' }, hops: [{ patchPanelId: panel2.id, inPort: '07', outPort: '06' }] }
    )
    expect(one.hops[0]).toMatchObject({ inSide: 'front', outSide: 'front' })
    expect(there).toEqual([`${edge.id}:gi1/0/6`, `${fusion.id}:te1/1/9`, `${panel2.id}:06#front`, `${panel2.id}:07#front`].sort())
    expect(back).toEqual(there)
    // A trunk cable straight between two panels: both rears.
    const trunk = expectStatus(await d.save('post', `${d.p.lld}/connections`, { buildingId: d.p.b001, media: 'cat6a', speed: '1G', source: { deviceId: panel2.id, portId: '10' }, dest: { deviceId: panel1.id, portId: '10' } }), 201).body.connection
    expect(await bookedBy(trunk.id)).toEqual([`${panel1.id}:10#rear`, `${panel2.id}:10#rear`].sort())
  })

  it('refused: a side that does not match the cable type; front and rear of different ports; one port for both cords', async () => {
    const d = await started()
    const { panel1, panel2 } = await twoPanels(d)
    const edge = await d.device('edge')
    const border = await d.device('border')
    const base = { buildingId: d.p.b001, media: 'cat6a', speed: '1G', source: { deviceId: edge.id, portId: 'Gi1/0/8' }, dest: { deviceId: border.id, portId: 'Te1/1/10' } }
    const before = await occupancy({})
    const wrong = expectStatus(await d.save('post', `${d.p.lld}/connections`, { ...base, hops: [{ patchPanelId: panel2.id, inPort: '08', inSide: 'rear', outPort: '08' }, { patchPanelId: panel1.id, inPort: '08', outPort: '08' }] }), 400)
    expect(wrong.body.error.message).toMatch(/08 is on the rear, but a patch cord \(device to panel\) lands on the front/)
    const split = expectStatus(await d.save('post', `${d.p.lld}/connections`, { ...base, hops: [{ patchPanelId: panel2.id, inPort: '08', outPort: '09' }, { patchPanelId: panel1.id, inPort: '08', outPort: '08' }] }), 400)
    expect(split.body.error.message).toMatch(/front and rear must be the same port — 08 front and 09 rear are not connected/)
    const onePort = expectStatus(await d.save('post', `${d.p.lld}/connections`, { ...base, hops: [{ patchPanelId: panel2.id, inPort: '08', outPort: '08' }] }), 400)
    expect(onePort.body.error.message).toMatch(/08 front cannot take both cables/)
    expect(await occupancy({})).toHaveLength(before.length)
    // Correct sides, sent explicitly, are accepted.
    expectStatus(await d.save('post', `${d.p.lld}/connections`, { ...base, hops: [{ patchPanelId: panel2.id, inPort: '08', inSide: 'front', outPort: '08', outSide: 'rear' }, { patchPanelId: panel1.id, inPort: '08', inSide: 'rear', outPort: '08', outSide: 'front' }] }), 201)
  })
})

describe('Panel labels and one connection per panel port (M4b review)', () => {
  const addPanel = (d, rackId, ru, extra = {}) => d.save('post', `${d.p.lld}/devices`, { buildingId: d.p.b001, catalogueKey: PANEL, rackId, ru, face: 'front', ...extra })

  it('default labels are room-qualified and unique per building; a repeated or unsafe custom label is refused', async () => {
    const d = await started()
    const [mainRack, secondRack] = d.p.racks.map((r) => r.id)
    // Both rooms' first rack is R01: the labels still differ.
    const a = expectStatus(await addPanel(d, mainRack, 30), 201).body.device
    const b = expectStatus(await addPanel(d, secondRack, 30), 201).body.device
    const c = expectStatus(await addPanel(d, mainRack, 29), 201).body.device
    expect([a.label, b.label, c.label]).toEqual(['PP-TR-EG-01-R01-01', 'PP-TR-EG-02-R01-01', 'PP-TR-EG-01-R01-02'])
    const dup = expectStatus(await addPanel(d, secondRack, 28, { label: 'pp-tr-eg-01-r01-01' }), 409)
    expect(dup.body.error).toMatchObject({ code: 'label_in_use' })
    expect(dup.body.error.message).toMatch(/unique per building/)
    expectStatus(await addPanel(d, secondRack, 28, { label: 'PP 1/2' }), 400)
    expect(expectStatus(await addPanel(d, secondRack, 28, { label: 'PP-CORE-CU' }), 201).body.device.label).toBe('PP-CORE-CU')
    // A deleted panel's number is free again only if nothing else uses it.
    expectStatus(await d.p.architect.delete(`${d.p.lld}/devices/${a.id}?baseRevision=${await d.rev()}`), 200)
    expect(expectStatus(await addPanel(d, mainRack, 27), 201).body.device.label).toBe('PP-TR-EG-01-R01-01')
    const val = (await d.p.architect.get(`${d.p.lld}/buildings/${d.p.b001}/validation`).expect(200)).body
    expect(val.findings.filter((f) => f.rule === 'L-PANEL-LABEL')).toEqual([])
  })

  it("a panel port's front and rear belong to the same connection: a split is refused (400) — extend the connection with a hop instead", async () => {
    const d = await started()
    const [mainRack, secondRack] = d.p.racks.map((r) => r.id)
    const near = expectStatus(await addPanel(d, secondRack, 30), 201).body.device
    const far = expectStatus(await addPanel(d, mainRack, 30), 201).body.device
    const edge = await d.device('edge')
    const border = await d.device('border')
    // A patch cord to the panel front, saved as its own connection.
    const cord = expectStatus(await d.save('post', `${d.p.lld}/connections`, { buildingId: d.p.b001, media: 'cat6a', speed: '1G', cableId: 'CORD-11', source: { deviceId: edge.id, portId: 'Gi1/0/11' }, dest: { deviceId: near.id, portId: '11' } }), 201).body.connection
    // A second connection on the same port's rear (a trunk) would fragment the trace.
    const before = await occupancy({})
    const split = expectStatus(await d.save('post', `${d.p.lld}/connections`, { buildingId: d.p.b001, media: 'cat6a', speed: '1G', source: { deviceId: near.id, portId: '11' }, dest: { deviceId: far.id, portId: '11' } }), 400)
    expect(split.body.error.message).toBe(
      `${near.label} port 11: its front is already used by connection CORD-11 (${edge.hostname} → ${near.label}) — a panel port's front and rear belong to one connection; add this route to that connection as a hop instead`
    )
    expect(await occupancy({})).toHaveLength(before.length)
    // The fix: one end-to-end connection with the hops.
    const whole = expectStatus(await d.save('patch', `${d.p.lld}/connections/${cord.id}`, { dest: { deviceId: border.id, portId: 'Te1/1/11' }, hops: [{ patchPanelId: near.id, inPort: '11', outPort: '11' }, { patchPanelId: far.id, inPort: '11', outPort: '11' }] }), 200).body.connection
    expect(whole.hops.map((h) => [h.inSide, h.outSide])).toEqual([['front', 'rear'], ['rear', 'front']])
    expect((await occupancy({ connectionId: new mongoose.Types.ObjectId(cord.id) })).map((o) => o.portKey).sort()).toEqual(['11#front', '11#front', '11#pair', '11#pair', '11#rear', '11#rear', 'gi1/0/11', 'te1/1/11'])
    // The view marks the port as held for every other connection.
    const nearView = (await d.view()).devices.find((x) => x.id === near.id)
    expect(nearView.occupied.filter((o) => o.portKey === '11#pair')).toEqual([{ portKey: '11#pair', connectionId: cord.id, source: 'pair' }])
  })

  it('the pair row is the guarantee (a concurrent write on the other side is refused); legacy pre-occupied cabling is exempt', async () => {
    const d = await started()
    const [, secondRack] = d.p.racks.map((r) => r.id)
    const near = expectStatus(await addPanel(d, secondRack, 30), 201).body.device
    const edge = await d.device('edge')
    const template = await mongoose.connection.db.collection('devices').findOne({ layer: 'lld' })
    const rawRow = (portKey, extra) => ({ organisationId: template.organisationId, projectId: template.projectId, layer: 'lld', deviceId: new mongoose.Types.ObjectId(near.id), portId: portKey.split('#')[0], portKey, hopSeq: null, createdAt: new Date(), ...extra })
    // As if another connection had committed its other-side booking a moment ago.
    await mongoose.connection.db.collection('portoccupancies').insertOne(rawRow('12#pair', { connectionId: new mongoose.Types.ObjectId(), source: 'pair' }))
    const raced = expectStatus(await d.save('post', `${d.p.lld}/connections`, { buildingId: d.p.b001, media: 'cat6a', speed: '1G', source: { deviceId: edge.id, portId: 'Gi1/0/12' }, dest: { deviceId: near.id, portId: '12' } }), 400)
    expect(raced.body.error.message).toMatch(/port 12: its other side was just taken by another connection/)
    // Legacy cabling outside the project on the rear of 13: the front stays usable.
    await mongoose.connection.db.collection('portoccupancies').insertOne(rawRow('13#rear', { connectionId: null, source: 'pre_occupied' }))
    expectStatus(await d.save('post', `${d.p.lld}/connections`, { buildingId: d.p.b001, media: 'cat6a', speed: '1G', source: { deviceId: edge.id, portId: 'Gi1/0/13' }, dest: { deviceId: near.id, portId: '13' } }), 201)
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
    // The losers edited a link the winner changed: refused, naming the port (M7b-1 save-time check).
    expect(results.filter((r) => r.status === 409).every((r) => ['stale_revision', 'port_changed'].includes(r.body.error.code))).toBe(true)
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
    const mainEdge = await device('edge')
    const mainBf = await link('border', 'fusion')
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
    // Compared on the main design's ids (regression: every copied record showed as removed and added).
    expect(diff.devices).toMatchObject({ added: [], removed: [], changed: [{ id: mainEdge.id, fields: [{ field: 'ru', before: null, after: 5 }] }] })
    expect(diff.connections).toMatchObject({ added: [], removed: [], changed: [{ id: mainBf.id, fields: [{ field: 'cableId', before: null, after: 'BRANCH-1' }] }] })
    // A version saved on the branch records it.
    const bv = (await p.architect.post(`${p.lld}/versions`).send({ buildingId: p.b001, branchId: b1.id, label: 'Option A draft' }).expect(201)).body
    expect((await d.view()).versions.find((v) => v.id === bv.versionId).branchId).toBe(b1.id)

    // Promote: the branch replaces the main LLD.
    expectStatus(await save('post', `${p.lld}/branches/${b1.id}/promote`, {}), 200)
    expect((await device('edge')).ru).toBe(5)
    expect((await link('border', 'fusion')).cableId).toBe('BRANCH-1')
    expect((await d.view()).branches.find((b) => b.id === b1.id).status).toBe('promoted')
    // Records keep their main-design ids through the promotion (M5a).
    expect((await device('edge')).id).toBe(mainEdge.id)
    expect((await link('border', 'fusion')).id).toBe(mainBf.id)
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
    // The same link was changed since: the refusal names it (its port, or the link when its end has no port, as here) and who (M7b-1), with the revision details.
    expect(stale.body.error).toMatchObject({ code: 'port_changed', details: { revision: rev + 1, lastEditedBy: 'architect', changedBy: 'architect' } })
    expect(stale.body.error.message).toMatch(/^The link from .+ was changed by architect since you loaded it — reload/)
  })
})
