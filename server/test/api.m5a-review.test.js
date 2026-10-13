import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp } from './helpers/app.js'
import { approvedLld, lldProject, withDesign, complete } from './helpers/lld.js'
import { bomView, readyPackage, submitPackage, clientDecides } from './helpers/m5a.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

// M5a review: change requests cover the HLD and the LLD together; every route
// segment is its own cable with its own lengths; cage nuts per RU and face.
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
const col = (name) => mongoose.connection.db.collection(name)
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}

// The package approved by the client: HLD and LLD frozen.
async function frozenDesign() {
  const ctx = t()
  const d = await approvedLld(ctx)
  await readyPackage(d.p)
  expectStatus(await clientDecides(ctx, await submitPackage(d.p)), 200)
  return { ctx, d, p: d.p }
}

const hldOf = async (p, branchId = null) => (await p.architect.get(`${p.hld}/buildings/${p.b001}${branchId ? `?branchId=${branchId}` : ''}`).expect(200)).body
const crOf = async (p, id) => (await p.admin.agent.get(`${p.base}/change-requests/${id}`).expect(200)).body.changeRequest

// On a CR's branch: a new Edge in the second room of the HLD, uplinked to the
// Border — then, optionally, mapped into the branch's LLD through the
// reconciliation. Returns the new HLD ids.
async function addEdgeOnBranch(p, d, cr, { map = true } = {}) {
  let hld = await hldOf(p, cr.branchId)
  const device = expectStatus(await p.architect.post(`${p.hld}/devices`).send({ buildingId: p.b001, branchId: cr.branchId, role: 'edge', roomId: p.rooms.second.id, baseRevision: hld.design.revision }), 201).body.device
  hld = await hldOf(p, cr.branchId)
  const border = hld.devices.find((x) => x.role === 'border')
  const uplink = expectStatus(await p.architect.post(`${p.hld}/uplinks`).send({ buildingId: p.b001, branchId: cr.branchId, source: { deviceId: border.id }, dest: { deviceId: device.id }, media: 'os2', speed: '10G', baseRevision: hld.design.revision }), 201).body.uplink
  if (map) {
    const rec = (await p.architect.get(`${p.lld}/buildings/${p.b001}/reconciliation?branchId=${cr.branchId}`).expect(200)).body
    expect(rec.devices.inHldOnly.map((x) => x.id)).toEqual([device.id])
    expect(rec.connections.inHldOnly.map((x) => x.id)).toEqual([uplink.id])
    expectStatus(await d.save('post', `${p.lld}/copy-from-hld`, { buildingId: p.b001, branchId: cr.branchId, hldDeviceIds: [device.id], hldConnectionIds: [uplink.id] }, { branchId: cr.branchId }), 200)
  }
  return { device, uplink }
}

describe('Change requests cover the HLD and the LLD together', () => {
  it('a CR adds a device in the HLD and maps it in the LLD; the client approves; both get new frozen versions', async () => {
    const { ctx, d, p } = await frozenDesign()
    const hldBefore = await hldOf(p)
    expect(hldBefore.frozen).toBe(true)
    // The frozen main HLD refuses a direct change.
    expect((await p.architect.post(`${p.hld}/devices`).send({ buildingId: p.b001, role: 'edge', roomId: p.rooms.second.id, baseRevision: hldBefore.design.revision }).expect(409)).body.error.code).toBe('change_request_required')
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Second edge in TR-EG-02' }), 201).body.changeRequest
    // The branch starts as a copy of the HLD (its own ids, the same design).
    const branchHld = await hldOf(p, cr.branchId)
    expect(branchHld.branch).toMatchObject({ id: cr.branchId, editable: true })
    expect(branchHld.devices.map((x) => x.hostname).sort()).toEqual(hldBefore.devices.map((x) => x.hostname).sort())

    const { device, uplink } = await addEdgeOnBranch(p, d, cr, { map: false })
    // The main HLD is unchanged.
    expect((await hldOf(p)).devices).toHaveLength(hldBefore.devices.length)
    // In the HLD but not yet in the LLD: submitting is refused.
    const refused = (await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`).expect(409)).body.error
    expect(refused.code).toBe('hld_lld_inconsistent')
    expect(refused.details.problems.map((x) => [x.kind, x.state, x.id]).sort()).toEqual([
      ['connection', 'inHldOnly', uplink.id],
      ['device', 'inHldOnly', device.id],
    ])
    expect((await crOf(p, cr.id)).consistency.consistent).toBe(false)
    // Mapped into the branch's LLD through the reconciliation.
    const rec = (await p.architect.get(`${p.lld}/buildings/${p.b001}/reconciliation?branchId=${cr.branchId}`).expect(200)).body
    expect(rec.devices.inHldOnly.map((x) => x.id)).toEqual([device.id])
    expectStatus(await d.save('post', `${p.lld}/copy-from-hld`, { buildingId: p.b001, branchId: cr.branchId, hldDeviceIds: [device.id], hldConnectionIds: [uplink.id] }, { branchId: cr.branchId }), 200)
    const detail = await crOf(p, cr.id)
    expect(detail.consistency).toEqual({ consistent: true, problems: [] })
    expect(detail.impact.design.hld.devices.added.map((x) => x.id)).toEqual([device.id])
    expect(detail.impact.design.hld.connections.added.map((x) => x.id)).toEqual([uplink.id])
    expect(detail.impact.design.devices.added).toHaveLength(1)
    expect(detail.impact.design.total).toBe(4)
    expect(detail.impact.bom.lines.some((l) => l.change === 'added' && l.key.startsWith('device:'))).toBe(true)

    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    // Submitted: the HLD branch is locked too.
    const locked = await hldOf(p, cr.branchId)
    expect(locked.branch.editable).toBe(false)
    expect((await p.architect.post(`${p.hld}/devices`).send({ buildingId: p.b001, branchId: cr.branchId, role: 'ap', roomId: p.rooms.second.id, baseRevision: locked.design.revision }).expect(409)).body.error.code).toBe('change_request_locked')
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    expectStatus(await clientDecides(ctx, link), 200)

    // The HLD: the new device under its own id, a new approved, frozen version; still frozen.
    const hldAfter = await hldOf(p)
    expect(hldAfter.devices.map((x) => x.id)).toContain(device.id)
    expect(hldAfter.devices).toHaveLength(hldBefore.devices.length + 1)
    expect(hldAfter.connections.map((c) => c.id)).toContain(uplink.id)
    // Copied records came back under their original ids.
    expect(hldBefore.devices.every((x) => hldAfter.devices.some((y) => y.id === x.id))).toBe(true)
    expect(hldAfter.frozen).toBe(true)
    expect(hldAfter.versions[0]).toMatchObject({ number: hldBefore.versions[0].number + 1, frozen: true, counts: { devices: hldBefore.devices.length + 1 } })
    const hldDoc = await col('hlddesigns').findOne({ buildingId: new mongoose.Types.ObjectId(p.b001) })
    expect(String(hldDoc.latestApprovedVersionId)).toBe(hldAfter.versions[0].id)
    // The LLD: the device mapped to it, a new frozen version based on the new HLD version.
    const lldAfter = await d.view()
    const mapped = lldAfter.devices.find((x) => x.inDesign && x.hldRef === device.id)
    expect(mapped).toBeTruthy()
    expect(lldAfter.connections.some((c) => c.hldRef === uplink.id)).toBe(true)
    expect(lldAfter).toMatchObject({ frozen: true, status: 'approved', hld: { basedOnNumber: hldAfter.versions[0].number, latestApprovedNumber: hldAfter.versions[0].number, changed: false } })
    expect(lldAfter.versions[0]).toMatchObject({ label: 'CR-1 Second edge in TR-EG-02', frozen: true })
    expect((await crOf(p, cr.id)).resultingHldVersionId).toBe(hldAfter.versions[0].id)
    // Nothing left on the branch layers.
    expect(await col('devices').countDocuments({ layer: { $in: [`hld:${cr.branchId}`, `lld:${cr.branchId}`] } })).toBe(0)
    expect(await col('connections').countDocuments({ layer: { $in: [`hld:${cr.branchId}`, `lld:${cr.branchId}`] } })).toBe(0)
    expect(await col('portoccupancies').countDocuments({ layer: `hld:${cr.branchId}` })).toBe(0)
  })

  it('reject discards the HLD and LLD changes; the frozen design and its versions stay as they were', async () => {
    const { ctx, d, p } = await frozenDesign()
    const hldBefore = await hldOf(p)
    const lldBefore = await d.view()
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Not wanted' }), 201).body.changeRequest
    await addEdgeOnBranch(p, d, cr)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    expectStatus(await clientDecides(ctx, link, { decision: 'rejected', comments: 'Not needed' }), 200)
    expect(await col('designbranches').findOne({ _id: new mongoose.Types.ObjectId(cr.branchId) })).toMatchObject({ status: 'discarded' })
    for (const layer of [`hld:${cr.branchId}`, `lld:${cr.branchId}`]) {
      expect(await col('devices').countDocuments({ layer })).toBe(0)
      expect(await col('connections').countDocuments({ layer })).toBe(0)
      expect(await col('portoccupancies').countDocuments({ layer })).toBe(0)
    }
    const hldAfter = await hldOf(p)
    expect(hldAfter.devices.map((x) => x.id).sort()).toEqual(hldBefore.devices.map((x) => x.id).sort())
    expect(hldAfter.versions.map((v) => v.id)).toEqual(hldBefore.versions.map((v) => v.id))
    const lldAfter = await d.view()
    expect(lldAfter.devices.filter((x) => x.inDesign).map((x) => x.id).sort()).toEqual(lldBefore.devices.filter((x) => x.inDesign).map((x) => x.id).sort())
    expect(lldAfter.versions.map((v) => v.id)).toEqual(lldBefore.versions.map((v) => v.id))
    // Canvas positions of the branch's copies are gone too.
    const ids = (await col('devices').find({ buildingId: new mongoose.Types.ObjectId(p.b001) }, { projection: { _id: 1 } }).toArray()).map((x) => x._id)
    expect(await col('canvaspositions').countDocuments({ objectId: { $nin: ids } })).toBe(0)
  })

  // Regression: the survey's rack statistics counted the planned devices of
  // every design layer sharing the rack (HLD, LLD, branches — and now a CR's
  // HLD copy), so a design change moved the surveyed "used RU".
  it('the survey’s rack statistics count the surveyed gear only, whatever the design layers hold', async () => {
    const { d, p } = await frozenDesign()
    const stats = async () => (await p.fe.get(`${p.base}/survey/records`).query({ buildingId: p.b001, roomId: p.rooms.main.id, tab: 'Comms Rooms Summary' }).expect(200)).body.record.rackStatsByCode
    const code = p.racks[0].code.toUpperCase()
    // Border and Fusion are placed in the main rack by the LLD; the survey found only a 0U PDU there.
    expect((await d.device('border')).rackId).toBe(p.racks[0].id)
    const main = (await stats())[code]
    expect(main).toMatchObject({ usedRU: 0, freeRU: main.totalRU })
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Copies everything' }), 201).body.changeRequest
    await addEdgeOnBranch(p, d, cr, { map: false })
    expect((await stats())[code].usedRU).toBe(0)
  })

  it('withdrawing a CR discards its HLD layer too; HLD branch reads need a change request’s branch', async () => {
    const { d, p } = await frozenDesign()
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Draft only' }), 201).body.changeRequest
    await addEdgeOnBranch(p, d, cr, { map: false })
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/withdraw`), 200)
    expect(await col('devices').countDocuments({ layer: `hld:${cr.branchId}` })).toBe(0)
    expect((await p.architect.get(`${p.hld}/buildings/${p.b001}?branchId=${cr.branchId}`).expect(409)).body.error.code).toBe('branch_closed')
    expect((await p.architect.get(`${p.hld}/buildings/${p.b001}?branchId=${new mongoose.Types.ObjectId()}`).expect(404)).body.error.code).toBe('not_found')
  })
})

describe('Every route segment is its own cable', () => {
  // The Edge at RU10 and its patch panel at RU40 of the same rack.
  async function patchCordDesign() {
    const p = await lldProject(t())
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom'] }).expect(200)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    const panel = await complete(d)
    const edge = await d.device('edge')
    expectStatus(await d.save('put', `${p.lld}/devices/${edge.id}/placement`, { rackId: p.racks[1].id, ru: 10, face: 'front' }), 200)
    expectStatus(await d.save('put', `${p.lld}/devices/${panel.id}/placement`, { rackId: p.racks[1].id, ru: 40, face: 'front' }), 200)
    return { p, d, panel }
  }

  it('Suggested per segment from the shared formulas: an RU10→RU40 patch cord is 2 m; Engineer Selected per cable; the BOM counts each cable at its own length', async () => {
    const { p, d, panel } = await patchCordDesign()
    const ea = await d.link('edge', 'ap')
    expect(ea.segments).toHaveLength(2)
    expect(ea.segments[0]).toMatchObject({ index: 0, kind: 'patch_cord', cableId: 'C-EA-1', situation: 'same-rack', suggestedM: 2, engineerSelectedM: null, effectiveM: 2, installedM: null })
    expect(ea.segments[0].lengthM).toBeCloseTo(30 * 0.045 + 0.5)
    // The cable after the panel runs to a ceiling AP (no rack): pending until placed.
    expect(ea.segments[1]).toMatchObject({ index: 1, kind: 'patch_cord', cableId: 'C-EA-1b', placementPending: true, suggestedM: null })
    expect(ea.lengths).toMatchObject({ suggestedM: 2, effectiveM: 2 })
    // Engineer Selected for one cable (the cable schedule).
    expectStatus(await d.save('patch', `${p.lld}/connections/${ea.id}`, { segmentLengths: [{ segment: 1, engineerSelectedM: 15 }] }), 200)
    expect((await d.save('patch', `${p.lld}/connections/${ea.id}`, { segmentLengths: [{ segment: 2, engineerSelectedM: 3 }] })).status).toBe(400)
    let link = await d.link('edge', 'ap')
    expect(link.segments.map((s) => [s.engineerSelectedM, s.effectiveM])).toEqual([
      [null, 2],
      [15, 15],
    ])
    // The Editor re-sends the route without lengths: the cable keeps its own.
    expectStatus(await d.save('patch', `${p.lld}/connections/${ea.id}`, { hops: [{ patchPanelId: panel.id, inPort: '01', outPort: '02', segmentCableId: 'C-EA-1b' }] }), 200)
    expect((await d.link('edge', 'ap')).segments[1].engineerSelectedM).toBe(15)
    // …or with a new one on the hop (the Editor's per-cable field).
    expectStatus(await d.save('patch', `${p.lld}/connections/${ea.id}`, { hops: [{ patchPanelId: panel.id, inPort: '01', outPort: '02', segmentCableId: 'C-EA-1b', engineerSelectedM: 20 }], engineerSelectedM: 3 }), 200)
    link = await d.link('edge', 'ap')
    expect(link.segments.map((s) => s.effectiveM)).toEqual([3, 20])
    // Audited per cable.
    const audit = await col('auditentries').find({ action: 'lld.connection.updated', objectId: ea.id }).sort({ occurredAt: -1 }).limit(1).next()
    expect(audit.changes.map((c) => c.field).sort()).toEqual(['cable 2 engineerSelectedM', 'engineerSelectedM'])
    // The BOM: each cable at its own stock length.
    const bom = await bomView(p.admin.agent, p)
    const cat6a = bom.lines.filter((l) => l.key.startsWith('cable:cat6a:'))
    expect(cat6a.map((l) => [l.key, l.qty])).toEqual(expect.arrayContaining([['cable:cat6a:3', 1], ['cable:cat6a:20', 1]]))
    expect(bom.reconciliation.checks.find((c) => c.key === 'cables')).toMatchObject({ ok: true })
  })

  it('segment lengths survive versions, branches and their promotion', async () => {
    const { p, d } = await patchCordDesign()
    const ea = await d.link('edge', 'ap')
    expectStatus(await d.save('patch', `${p.lld}/connections/${ea.id}`, { segmentLengths: [{ segment: 1, engineerSelectedM: 15 }] }), 200)
    const branch = expectStatus(await p.architect.post(`${p.lld}/branches`).send({ buildingId: p.b001, name: 'Alt' }), 201).body.branch
    const onBranch = await d.link('edge', 'ap', branch.id)
    expect(onBranch.segments[1].engineerSelectedM).toBe(15)
    expectStatus(await d.save('patch', `${p.lld}/connections/${onBranch.id}`, { segmentLengths: [{ segment: 1, engineerSelectedM: 25 }] }, { branchId: branch.id }), 200)
    const diff = (await p.architect.get(`${p.lld}/versions/diff?buildingId=${p.b001}&from=current&to=current:${branch.id}`).expect(200)).body
    expect(diff.connections.changed.map((c) => c.fields.map((f) => f.field))).toEqual([['segmentLengths']])
    expectStatus(await d.save('post', `${p.lld}/branches/${branch.id}/promote`, {}), 200)
    expect((await d.link('edge', 'ap')).segments[1].engineerSelectedM).toBe(25)
  })
})

describe('Cage nuts per RU and face (organisation setting)', () => {
  it('defaults to 4 per RU; the Org Admin changes it; the BOM follows', async () => {
    const d = await approvedLld(t())
    const { p } = d
    const settings = `/api/v1/orgs/${p.admin.orgId}/settings`
    expect((await p.admin.agent.get(settings).expect(200)).body.settings).toMatchObject({ cageNutsPerRu: { front: 4, rear: 4 }, defaultCageNutsPerRu: { front: 4, rear: 4 } })
    const nuts = async () => (await bomView(p.admin.agent, p)).lines.filter((l) => l.key.startsWith('cage:')).reduce((n, l) => n + l.qty, 0)
    const before = await nuts()
    // Border, Fusion and Edge (1 RU each, front) and the 1 RU panel: 4 RU × 4.
    expect(before).toBe(16)
    await p.architect.patch(settings).send({ cageNutsPerRu: { front: 2, rear: 0 } }).expect(403)
    await p.admin.agent.patch(settings).send({ cageNutsPerRu: { front: 2, rear: 0 } }).expect(200)
    await p.admin.agent.patch(settings).send({ cageNutsPerRu: { front: -1, rear: 0 } }).expect(400)
    expect(await nuts()).toBe(8)
    const audit = await col('auditentries').find({ action: 'organisation.settings.updated' }).sort({ occurredAt: -1 }).limit(1).next()
    expect(audit.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['cageNutsPerRu.front', 4, 2],
      ['cageNutsPerRu.rear', 4, 0],
    ])
  })
})
