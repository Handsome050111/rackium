import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import JSZip from 'jszip'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp } from './helpers/app.js'
import { hldView } from './helpers/hld.js'
import { lldProject, withDesign, complete } from './helpers/lld.js'
import { freeze, depView, cmdbView, deliverAll, install, patch, acceptEverything } from './helpers/m6a.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { closePdfBrowser } from '../src/documents/render/pdf.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await closePdfBrowser()
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()
const col = (name) => mongoose.connection.db.collection(name)
const oid = (id) => new mongoose.Types.ObjectId(String(id))
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const audit = (action) => col('auditentries').find({ action }).toArray()
const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })

// B001 frozen and delivered, with what the cutover needs (synthetic names):
// two CMO switches — OLD-SW-01 replaced by the Edge, OLD-SW-02 removed — and
// an interim (IMO) Edge with an IMO link to the Border, placed and patched in
// the LLD like the rest.
async function cutover(ctx) {
  const p = await lldProject(ctx)
  const view = () => hldView(p.architect, p)
  // The revision is read before the request is built (supertest).
  const write = async (method, url, body) => {
    const baseRevision = (await view()).design.revision
    return p.architect[method](url).send({ ...body, baseRevision })
  }
  const rows = ['OLD-SW-01', 'OLD-SW-02'].map((hostname, i) => ({ rowIndex: i, hostname, vendor: null, model: 'Legacy Switch 48', serial: `SYN-CUT-00${i + 1}`, mac: null, building: 'B001', floor: null, room: p.rooms.main.code, rack: null, ru: null }))
  expectStatus(await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: p.sal('ERL').id, rows, fileName: 'cmo.xlsx' }), 201)
  let v = await view()
  const [one, two] = ['OLD-SW-01', 'OLD-SW-02'].map((h) => v.cmoDevices.find((d) => d.hostname === h))
  const edge = v.devices.find((d) => d.role === 'edge')
  const border = v.devices.find((d) => d.role === 'border')
  expectStatus(await write('put', `${p.hld}/devices/${one.id}/cmo-decision`, { decision: 'replace', replacedById: edge.id }), 200)
  expectStatus(await write('put', `${p.hld}/devices/${two.id}/cmo-decision`, { decision: 'remove' }), 200)
  const temp = expectStatus(await write('post', `${p.hld}/devices`, { buildingId: p.b001, role: 'edge', roomId: p.rooms.second.id, modeState: 'interim' }), 201).body.device
  v = await view()
  const be = v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [border.id, edge.id].sort().join())
  expectStatus(await write('post', `${p.hld}/uplinks`, { buildingId: p.b001, source: { deviceId: border.id }, dest: { deviceId: temp.id }, media: be.media, speed: be.speed, sourceSfpCode: be.sourceSfpCode, destSfpCode: be.destSfpCode, modeState: 'interim' }), 201)
  expectStatus(await write('post', `${p.hld}/submit`, { buildingId: p.b001 }), 201)
  expectStatus(await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }), 200)
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom'] }).expect(200)
  await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
  const d = withDesign(p)
  await complete(d)
  let lld = await d.view()
  const tempLld = lld.devices.find((x) => x.hldRef === temp.id)
  expectStatus(await d.save('put', `${p.lld}/devices/${tempLld.id}/placement`, { rackId: p.racks[1].id, ru: 38, face: 'front' }), 200)
  lld = await d.view()
  const link = lld.connections.find((c) => [c.source.deviceId, c.dest.deviceId].includes(tempLld.id))
  const tempIsSource = link.source.deviceId === tempLld.id
  expectStatus(await d.save('patch', `${p.lld}/connections/${link.id}`, { source: { deviceId: link.source.deviceId, portId: tempIsSource ? 'Te1/1/1' : 'Te1/1/3' }, dest: { deviceId: link.dest.deviceId, portId: tempIsSource ? 'Te1/1/3' : 'Te1/1/1' }, cableId: 'C-BT-1' }), 200)
  expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
  await p.admin.agent.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
  p.dep = `${p.base}/deployment`
  p.cmdb = `${p.base}/cmdb`
  await freeze(ctx, d)
  return { p, d, one, two, temp: tempLld, tempLink: link }
}
const removal = (p, agent, id, body = {}) => agent.post(`${p.dep}/devices/${id}/removal`).send(body)

describe('Removed after cutover (addendum v2.3 Q5; DATA-MODEL §5.22)', () => {
  it('interim kit once installed, and CMO gear marked Replace or Remove: removed by the Field Engineer — record retired, serial released, its links retired, audited; leaves the counts', async () => {
    const ctx = t()
    const { p, one, two, temp, tempLink } = await cutover(ctx)
    let dep = await deliverAll(p)
    const listed = (id) => dep.removals.find((r) => r.id === id)
    expect(dep.removals.map((r) => [r.kind, r.label]).sort()).toEqual([['cmo', 'OLD-SW-01'], ['cmo', 'OLD-SW-02'], ['interim', temp.label]].sort())
    expect(listed(one.id)).toMatchObject({ kind: 'cmo', onSite: true, removed: false, decision: { decision: 'replace' } })
    expect(listed(temp.id)).toMatchObject({ kind: 'interim', onSite: false, removed: false })
    expect(dep.permissions.remove).toBe(false) // the admin's view
    // Not installed yet: nothing to remove.
    expect(expectStatus(await removal(p, p.fe, temp.id), 409).body.error.code).toBe('not_installed')
    // Installed and patched, then removed after cutover.
    const tempDevice = dep.devices.find((x) => x.id === temp.id)
    await install(p, tempDevice)
    const borderDevice = dep.devices.find((x) => x.role === 'border')
    await install(p, borderDevice)
    await patch(p, (await depView(p.fe, p)).connections.find((c) => c.id === tempLink.id))
    dep = await depView(p.fe, p)
    expect(listed(temp.id)).toMatchObject({ onSite: true })
    const pipelineBefore = dep.pipeline.devices.planned
    expect(await col('serialregistries').countDocuments({ ownerId: oid(temp.id) })).toBe(1)
    // Only the Field Engineer; never a device that stays.
    expectStatus(await removal(p, p.admin.agent, temp.id), 403)
    expect(expectStatus(await removal(p, p.fe, borderDevice.id), 409).body.error.code).toBe('not_for_removal')
    expectStatus(await removal(p, p.fe, temp.id, { note: 'Cutover done' }), 200)
    const rec = await col('deploymentrecords').findOne({ deviceId: oid(temp.id) })
    expect(rec).toMatchObject({ status: 'retired', retired: { cutover: true, reason: 'Removed after cutover: Cutover done', byName: 'field_engineer', previousStatus: 'installed' }, installation: { serial: null } })
    expect(await col('serialregistries').countDocuments({ ownerId: oid(temp.id) })).toBe(0)
    expect((await col('connectionrecords').findOne({ connectionId: oid(tempLink.id) })).status).toBe('retired')
    dep = await depView(p.fe, p)
    expect(listed(temp.id)).toMatchObject({ removed: true, onSite: false, removedBy: 'field_engineer', statusLabel: 'Removed' })
    expect(dep.pipeline.devices.planned).toBe(pipelineBefore - 1)
    expect(expectStatus(await removal(p, p.fe, temp.id), 409).body.error.code).toBe('already_removed')
    // CMO gear: no record of its own until removed; then retired, its serial released.
    expect(await col('serialregistries').countDocuments({ ownerId: oid(two.id) })).toBe(1)
    expectStatus(await removal(p, p.fe, two.id), 200)
    expect(await col('devices').findOne({ _id: oid(two.id) })).toMatchObject({ status: 'retired' })
    expect(await col('deploymentrecords').findOne({ deviceId: oid(two.id) })).toMatchObject({ status: 'retired', retired: { cutover: true, previousStatus: 'in_service', serial: 'SYN-CUT-002' } })
    expect(await col('serialregistries').countDocuments({ ownerId: oid(two.id) })).toBe(0)
    expect((await audit('deployment.device.removed')).map((a) => a.objectId).sort()).toEqual([temp.id, two.id].sort())
    // The CMDB lists them as retired, removed after cutover.
    const cmdb = await cmdbView(p.admin.agent, p)
    expect(cmdb.retiredRecords.filter((r) => r.cutover).map((r) => r.id).sort()).toEqual([temp.id, two.id].sort())
  }, 400000)
})

describe('Handover after cutover (decision 4 as ruled; DATA-MODEL §5.22)', () => {
  it('installed interim kit blocks; CMO gear left on site is a warning the PM overrides with a reason (audited, withdrawable), listed in the package', async () => {
    const ctx = t()
    const { p, one, two, temp } = await cutover(ctx)
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb', 'handover'] }).expect(200)
    // Everything deployed and accepted, the interim kit too (it ran the cutover).
    await acceptEverything(p)
    const H = `${p.base}/handover/buildings/${p.b001}`
    const item = async (id) => (await p.admin.agent.get(H).expect(200)).body.checklist.find((i) => i.id === id)
    expect(await item('interim')).toMatchObject({ ok: false, label: 'Interim kit (IMO): removed after cutover', detail: `1 still installed: ${temp.label}` })
    expect(await item('old-gear')).toMatchObject({ ok: false, warning: true, overridable: true, label: 'CMO gear marked Replace or Remove: removed', detail: expect.stringMatching(/^2 still on site: OLD-SW-01, OLD-SW-02/) })
    expect((await p.admin.agent.post(`${H}/compile`).expect(409)).body.error.message).toBe('The pre-compilation checklist is not complete')
    // The interim kit removed: that item is met. Deployment no longer waits for it.
    expectStatus(await removal(p, p.fe, temp.id), 200)
    expect(await item('interim')).toMatchObject({ ok: true, detail: 'None installed' })
    expect(await item('deployment')).toMatchObject({ ok: true })
    expect(await item('cmdb')).toMatchObject({ ok: true })
    // One CMO switch removed; the other kept on site by the PM, with a reason.
    expectStatus(await removal(p, p.fe, two.id), 200)
    expect((await item('old-gear')).detail).toMatch(/^1 still on site: OLD-SW-01/)
    expectStatus(await p.admin.agent.put(`${H}/old-gear`).send({ reason: '' }), 400)
    expectStatus(await p.reviewer.put(`${H}/old-gear`).send({ reason: 'x' }), 403)
    expectStatus(await p.fe.put(`${H}/old-gear`).send({ reason: 'x' }), 403)
    const kept = expectStatus(await p.admin.agent.put(`${H}/old-gear`).send({ reason: 'Kept as a spare until the client collects it' }), 200).body
    expect(kept.checklist.find((i) => i.id === 'old-gear')).toMatchObject({ ok: true, override: { reason: 'Kept as a spare until the client collects it', by: 'Owner' }, detail: 'Kept on site (1): Kept as a spare until the client collects it — Owner' })
    expect(kept.ready).toBe(true)
    // Withdrawn and given again: audited both ways.
    expectStatus(await p.admin.agent.put(`${H}/old-gear`).send({ reason: null }), 200)
    expect(await item('old-gear')).toMatchObject({ ok: false })
    expectStatus(await p.admin.agent.put(`${H}/old-gear`).send({ reason: 'Kept as a spare until the client collects it' }), 200)
    expect((await audit('handover.old_gear_kept')).length).toBe(2)
    expect((await audit('handover.old_gear_override_withdrawn')).length).toBe(1)
    // The package lists it.
    expectStatus(await p.admin.agent.post(`${H}/compile`), 202)
    await ctx.app.__documents.process({ limit: 30 })
    const view = (await p.admin.agent.get(H).expect(200)).body
    expect(view.state).toBe('compiled')
    const zip = await JSZip.loadAsync((await binary(p.admin.agent.get(`${p.base}/documents/${view.package.id}/download`)).expect(200)).body)
    const csv = await zip.file('kept-on-site.csv').async('string')
    expect(csv).toContain('OLD-SW-01')
    expect(csv).toContain('Kept as a spare until the client collects it')
    expect(await zip.file('manifest.csv').async('string')).toContain('kept-on-site.csv')
    expect(csv).not.toContain(one.id)
  }, 600000)
})

describe('The CMDB shows the mode in the project’s words (DATA-MODEL §5.22)', () => {
  it('each record carries its mode and the configured label; the extract has a Mode column; removed kit is not counted against the design', async () => {
    const ctx = t()
    const { p, temp } = await cutover(ctx)
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb'] }).expect(200)
    expectStatus(await p.admin.agent.patch(`${p.base}/mode-labels`).send({ modeLabels: { interim: 'Transition', future: 'To-Be' } }), 200)
    await acceptEverything(p)
    let cmdb = await cmdbView(p.admin.agent, p)
    expect(cmdb.modeLabels).toEqual({ current: 'CMO', interim: 'Transition', future: 'To-Be' })
    expect(cmdb.records.find((r) => r.id === temp.id)).toMatchObject({ modeState: 'interim', modeLabel: 'Transition' })
    expect(cmdb.records.filter((r) => r.id !== temp.id).every((r) => r.modeState === 'future' && r.modeLabel === 'To-Be')).toBe(true)
    const designBefore = cmdb.reconciliation.designCount
    expectStatus(await removal(p, p.fe, temp.id), 200)
    cmdb = await cmdbView(p.admin.agent, p)
    expect(cmdb.records.map((r) => r.id)).not.toContain(temp.id)
    expect(cmdb.reconciliation.designCount).toBe(designBefore - 1)
    // The extract: a Mode column in the configured words.
    const res = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'cmdb-extract', format: 'csv' }), 202)
    await ctx.app.__documents.process()
    const doc = (await p.admin.agent.get(`${p.base}/documents/${res.body.document.id}`).expect(200)).body.document
    const csv = (await binary(p.admin.agent.get(`${p.base}/documents/${doc.id}/download`)).expect(200)).body.toString('utf8')
    const [header, ...lines] = csv.trim().split(/\r?\n/)
    expect(header.split(',').slice(0, 4)).toEqual(['Hostname', 'Legacy hostname', 'Mode', 'Role'])
    expect(lines.every((l) => l.split(',')[2] === 'To-Be')).toBe(true)
  }, 600000)
})
