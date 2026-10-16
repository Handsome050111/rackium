import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { panelLabel } from '@rackium/shared/lldDesign.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { lldProject, withDesign, complete, PANEL } from './helpers/lld.js'
import { surveyProject, roomWithRack } from './helpers/survey.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

// fix/cmo-naming-gaps: surveyed (existing) gear keeps the customer's own
// names, and FMO naming rules never block the design because of it.
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

// The rack survey as the client sends it: every item already in the rack
// (with its id) plus `extra` — a save replaces the rack's whole contents.
async function surveyRack(p, rackId, extra) {
  const { placements } = (await p.fe.get(`${p.base}/survey/racks/${rackId}`).expect(200)).body
  const kept = placements
    .filter((x) => x.kind === 'device')
    .map((x) => ({ deviceId: x.deviceId, ru: x.ru, heightU: x.heightU, face: x.face, fullDepth: x.fullDepth, mounting: x.mounting, railSide: x.railSide, category: x.category, label: x.label, sublabel: x.sublabel }))
  return expectStatus(await p.fe.patch(`${p.base}/survey/racks/${rackId}/placements`).send({ placements: [...kept, ...extra] }), 200).body
}
const surveyedPanel = (ru, extra = {}) => ({ ru, heightU: 1, face: 'front', mounting: 'rack', category: 'Patch panels', label: '24-port patch panel', sublabel: '1U', ...extra })

describe('L-PANEL-LABEL and surveyed panels', () => {
  it('two surveyed panels of the same type in one building do not block the LLD: it submits', async () => {
    const p = await lldProject(t())
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    // The Field Engineer records the customer's existing panels — one in each room's rack.
    await surveyRack(p, p.racks[0].id, [surveyedPanel(10)])
    await surveyRack(p, p.racks[1].id, [surveyedPanel(10)])
    await complete(d)
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
    const findings = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body.findings
    expect(findings.filter((f) => f.rule.startsWith('L-PANEL-LABEL'))).toEqual([])
  })

  it('planned panels with the same label are still Critical and block the submit; the Architect renames one from the LLD and it submits', async () => {
    const p = await lldProject(t())
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    const first = await complete(d)
    const second = expectStatus(await d.save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: p.racks[0].id, ru: 20, face: 'front' }), 201).body.device
    expect(second.label).not.toBe(first.label)
    // Two planned panels with one label (e.g. data from before labels were unique).
    await col('devices').updateOne({ _id: new mongoose.Types.ObjectId(second.id) }, { $set: { label: first.label.toLowerCase() } })
    const blocked = expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 409).body.error
    expect(blocked.code).toBe('validation_blocked')
    expect(blocked.details.findings.map((f) => [f.rule, f.severity])).toEqual([['L-PANEL-LABEL', 'critical']])
    // Renaming: hostname-safe, not a label or hostname the design already uses, panels only.
    expect(expectStatus(await d.save('put', `${p.lld}/devices/${second.id}/label`, { label: first.label }), 409).body.error.code).toBe('label_in_use')
    expectStatus(await d.save('put', `${p.lld}/devices/${second.id}/label`, { label: 'PP 2' }), 400)
    expectStatus(await d.save('put', `${p.lld}/devices/${(await d.device('edge')).id}/label`, { label: 'EDGE-X' }), 400)
    const renamed = expectStatus(await d.save('put', `${p.lld}/devices/${second.id}/label`, { label: 'PP-SPARE-01' }), 200).body.device
    expect(renamed).toMatchObject({ id: second.id, label: 'PP-SPARE-01', isPanel: true })
    const audit = await col('auditentries').findOne({ action: 'lld.device.relabelled' })
    expect(audit.changes).toEqual([expect.objectContaining({ field: 'label', before: first.label.toLowerCase(), after: 'PP-SPARE-01' })])
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
  })

  it("a planned panel with an existing panel's recorded label is a Warning only: it is added, and the LLD submits", async () => {
    const p = await lldProject(t())
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    await surveyRack(p, p.racks[0].id, [surveyedPanel(10, { existingLabel: 'VT-A-01' })])
    await complete(d)
    // The customer's label taken as a custom label: allowed (was 409 label_in_use).
    const clash = expectStatus(await d.save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: p.racks[0].id, ru: 20, face: 'front', label: 'vt-a-01' }), 201).body.device
    const findings = (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body.findings.filter((f) => f.rule.startsWith('L-PANEL-LABEL'))
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'L-PANEL-LABEL-EXISTING',
        severity: 'warning',
        objectId: clash.id,
        message: `vt-a-01 is also the label recorded on an existing panel (${p.rooms.main.code} rack ${p.racks[0].code} RU10) — rename the planned panel so the two cannot be confused on site`,
      }),
    ])
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
  })

  it("a new panel's default label skips the labels recorded on existing panels", async () => {
    const p = await lldProject(t())
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    const taken = panelLabel({ room: p.rooms.main.code, rack: p.racks[0].code, seq: 1 })
    await surveyRack(p, p.racks[0].id, [surveyedPanel(10, { existingLabel: taken })])
    const added = expectStatus(await d.save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: p.racks[0].id, ru: 20, face: 'front' }), 201).body.device
    expect(added.label).toBe(panelLabel({ room: p.rooms.main.code, rack: p.racks[0].code, seq: 2 }))
  })
})

describe('Renaming a planned panel: who and when (PR #14 review)', () => {
  it('the Architect or PM renames (the rename rules); Reviewer, Field Engineer and Viewer cannot; out of scope or another organisation is 404; refused after handover and while submitted', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    const panel = await complete(d)
    const rename = (agent, label) => d.save('put', `${p.lld}/devices/${panel.id}/label`, { label }, { agent })
    expect(expectStatus(await rename(p.architect, 'PP-BY-ARCHITECT'), 200).body.device.label).toBe('PP-BY-ARCHITECT')
    expect(expectStatus(await rename(p.admin.agent, 'PP-BY-PM'), 200).body.device.label).toBe('PP-BY-PM')
    for (const agent of [p.reviewer, p.fe, p.viewer]) expectStatus(await rename(agent, 'PP-NOT-ALLOWED'), 403)
    // Building scope: an Architect for B002 only does not find B001's panel.
    const b002Architect = await projectMember(ctx, p.admin, { email: 'arch-b002@example.com', role: 'architect', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    expect(expectStatus(await rename(b002Architect, 'PP-OUT-OF-SCOPE'), 404).body.error.message).toBe('Building not found')
    // Another organisation (its own project, where it is the PM): not found.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    const otherProject = (await other.agent.post(`/api/v1/orgs/${other.orgId}/projects`).send({ name: 'Other', code: 'OTH' }).expect(201)).body.project.id
    expectStatus(await other.agent.put(`/api/v1/orgs/${other.orgId}/projects/${otherProject}/lld/devices/${panel.id}/label`).send({ label: 'PP-FOREIGN', baseRevision: await d.rev() }), 404)
    expect((await d.view()).devices.find((x) => x.id === panel.id).label).toBe('PP-BY-PM')
    // After the client accepts the handover the design is read-only.
    const accepted = { organisationId: new mongoose.Types.ObjectId(p.admin.orgId), projectId: new mongoose.Types.ObjectId(p.projectId), buildingId: new mongoose.Types.ObjectId(p.b001), state: 'accepted' }
    const { insertedId } = await col('handoverworkflows').insertOne(accepted)
    expect(expectStatus(await rename(p.architect, 'PP-AFTER-HANDOVER'), 409).body.error.code).toBe('handed_over')
    await col('handoverworkflows').deleteOne({ _id: insertedId })
    // Submitted for approval: locked until a PM or Reviewer decides.
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
    expect(expectStatus(await rename(p.architect, 'PP-WHILE-SUBMITTED'), 409).body.error.code).toBe('lld_submitted')
    // Every successful rename is audited; refused ones change nothing.
    expect((await col('auditentries').find({ action: 'lld.device.relabelled' }).toArray()).map((a) => a.changes[0].after)).toEqual(['PP-BY-ARCHITECT', 'PP-BY-PM'])
  })
})

describe('CMO import: floor, vendor and rows without a serial', () => {
  it('stores the floor (checked like room and rack) and the vendor; rows without a serial import marked No serial and are picked in the Rack Survey', async () => {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    const eg = await roomWithRack(p.fe, p.base, b001)
    const og = await roomWithRack(p.fe, p.base, b001, { token: '1.OG', order: 1 })
    const row = (i, fields) => ({ rowIndex: i, hostname: null, vendor: null, model: null, serial: null, mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null, ...fields })
    const rows = [
      row(0, { hostname: 'SW-1', vendor: 'Cisco', model: 'C9300-48UX', serial: 'S-1', floor: 'eg', room: eg.room.code, rack: eg.rack.code, ru: '40' }),
      row(1, { hostname: 'VT-A-01', vendor: 'Panduit', model: 'Patch panel 24', floor: 'Floor EG' }),
      row(2, { model: 'Patch panel 24', floor: '1OG' }),
      row(3, { hostname: 'AP-X', serial: 'S-4', floor: '9.OG', room: eg.room.code }),
      row(4, { hostname: 'SW-5', serial: 'S-5', floor: '1.OG', room: eg.room.code }),
      row(5, { vendor: 'Cisco' }),
      row(6, { model: 'Cable manager 1U', building: null }),
    ]
    const preview = expectStatus(await p.admin.agent.post(`${p.base}/cmo/preview`).send({ salId: p.sal('ERL').id, rows }), 200).body
    expect(preview.rows.map((r) => [r.errors, r.warnings])).toEqual([
      [[], []],
      [[], ['no_serial']],
      [[], ['no_serial']],
      [[], ['unknown_floor']],
      [[], ['room_not_on_floor']],
      [['no_identity'], []],
      [[], ['no_serial']],
    ])
    expect(preview.rows.map((r) => r.floorId)).toEqual([eg.floor.id, eg.floor.id, og.floor.id, null, og.floor.id, null, null])
    expect(preview.summary).toMatchObject({ valid: 6, blocked: 1, unassigned: 1, noSerial: 3 })

    const result = expectStatus(await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: p.sal('ERL').id, rows }), 201).body
    expect(result.summary).toEqual({ imported: 6, assigned: 5, unassigned: 1, noSerial: 3, skipped: 1 })
    const cmo = (await p.admin.agent.get(`${p.base}/cmo`).expect(200)).body
    const byName = (name) => cmo.devices.find((x) => x.hostname === name || (!x.hostname && x.model === name))
    expect(byName('SW-1')).toMatchObject({ vendor: 'Cisco', serial: 'S-1', floorId: eg.floor.id, floorToken: 'EG', roomCode: eg.room.code, rackCode: eg.rack.code, ru: 40 })
    expect(byName('VT-A-01')).toMatchObject({ vendor: 'Panduit', serial: null, floorToken: 'EG', roomId: null })
    expect(byName('Patch panel 24')).toMatchObject({ serial: null, floorToken: '1.OG' })
    // Unknown floor: none stored; the floor shown is the room's.
    expect(byName('AP-X')).toMatchObject({ floorId: null, floorToken: 'EG', roomCode: eg.room.code })
    expect(byName('SW-5')).toMatchObject({ floorToken: '1.OG', roomId: null })
    expect(cmo.kpis).toMatchObject({ total: 6, noSerial: 3 })
    // Serials go to the registry; rows without one do not.
    expect((await col('serialregistries').find({}).toArray()).map((r) => r.serial).sort()).toEqual(['S-1', 'S-4', 'S-5'])
    const blocker = await col('blockers').findOne({ source: 'system', phaseKey: 'cmo' })
    expect(blocker.description).toBe('Unassigned CMO device Cable manager 1U (no serial) at SAL ERL — the PM assigns it to a building')
    expectStatus(await p.admin.agent.patch(`${p.base}/cmo/devices/${byName('Cable manager 1U').id}/assignment`).send({ buildingId: b001 }), 200)
    expect((await col('auditentries').findOne({ action: 'cmo.device.assigned' })).comment).toBe('Cable manager 1U assigned to B001')

    // The Rack Survey lists it in the CMO list and the surveyor picks it: no serial needed or added.
    const vt = byName('VT-A-01')
    const survey = (await p.fe.get(`${p.base}/survey/racks/${eg.rack.id}`).expect(200)).body
    expect(survey.roomCmoList.find((c) => c.deviceId === vt.id)).toMatchObject({ serial: null, expectedHostname: 'VT-A-01', vendor: 'Panduit' })
    const saved = await surveyRack(p, eg.rack.id, [surveyedPanel(30, { deviceId: vt.id, existingLabel: 'VT-A-01' })])
    expect(saved.placements.find((x) => x.deviceId === vt.id)).toMatchObject({ fromCmo: true, serial: null, existingLabel: 'VT-A-01', displayName: 'VT-A-01', label: '24-port patch panel' })
    expect(await col('serialregistries').countDocuments()).toBe(3)
  })
})

describe('Rack Survey with CMO devices imported into a rack (found in fix/cmo-naming-gaps)', () => {
  it('a rack holding CMO devices imported with a rack saves: one with an RU shows as 1U there; one without an RU stays in the rack, off the elevation, in its CMO list', async () => {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    const eg = await roomWithRack(p.fe, p.base, b001)
    const row = (i, fields) => ({ rowIndex: i, hostname: null, vendor: null, model: null, serial: null, mac: null, building: 'B001', floor: null, room: eg.room.code, rack: eg.rack.code, ru: null, ...fields })
    expectStatus(await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: p.sal('ERL').id, rows: [row(0, { hostname: 'SW-AT-40', serial: 'R-1', ru: '40' }), row(1, { hostname: 'SW-NO-RU', serial: 'R-2' })] }), 201)
    const survey = (await p.fe.get(`${p.base}/survey/racks/${eg.rack.id}`).expect(200)).body
    const devices = survey.placements.filter((x) => x.kind === 'device')
    expect(devices.map((x) => [x.hostname, x.ru, x.heightU, x.mounting])).toEqual([['SW-AT-40', 40, 1, 'rack']])
    const noRu = survey.roomCmoList.find((c) => c.expectedHostname === 'SW-NO-RU')
    expect(noRu.placedInRackId).toBe(eg.rack.id)
    // Saving the rack as the client does (it sends what it shows) — was 400 "a rack-mounted item is at least 1U".
    await surveyRack(p, eg.rack.id, [surveyedPanel(10)])
    const after = await col('devices').find({ hostname: { $in: ['SW-AT-40', 'SW-NO-RU'] } }).sort({ hostname: 1 }).toArray()
    expect(after.map((d) => [d.hostname, String(d.rackId), d.ru, d.heightU])).toEqual([
      ['SW-AT-40', eg.rack.id, 40, 1],
      ['SW-NO-RU', eg.rack.id, null, null],
    ])
  })
})

describe('Rack Survey: existing label / name', () => {
  it('free text recorded on site, shown instead of the library name in the survey and the LLD; what was placed still sets the port count', async () => {
    const p = await lldProject(t())
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const name = 'Schrank 3 / Feld A'
    const saved = await surveyRack(p, p.racks[0].id, [surveyedPanel(10, { label: '48-port patch panel', existingLabel: `  ${name} ` })])
    const placement = saved.placements.find((x) => x.label === '48-port patch panel')
    expect(placement).toMatchObject({ existingLabel: name, displayName: name })
    const lldDevice = async () => (await p.architect.get(`${p.lld}/buildings/${p.b001}`).expect(200)).body.devices.find((x) => x.id === placement.deviceId)
    expect(await lldDevice()).toMatchObject({ origin: 'existing', label: name, existingLabel: name, isPanel: true })
    expect((await lldDevice()).ports).toHaveLength(48)
    // Omitted keeps it (surveyRack sends what the rack has, without the field) …
    await surveyRack(p, p.racks[0].id, [])
    expect((await lldDevice()).label).toBe(name)
    // … null clears it: the library name is shown again.
    const { placements } = (await p.fe.get(`${p.base}/survey/racks/${p.racks[0].id}`).expect(200)).body
    const body = placements.filter((x) => x.kind === 'device').map((x) => ({ deviceId: x.deviceId, ru: x.ru, heightU: x.heightU, face: x.face, fullDepth: x.fullDepth, mounting: x.mounting, railSide: x.railSide, category: x.category, label: x.label, sublabel: x.sublabel, existingLabel: null }))
    expectStatus(await p.fe.patch(`${p.base}/survey/racks/${p.racks[0].id}/placements`).send({ placements: body }), 200)
    expect(await lldDevice()).toMatchObject({ label: '48-port patch panel', existingLabel: null })
    // At most 120 characters.
    expectStatus(await p.fe.patch(`${p.base}/survey/racks/${p.racks[0].id}/placements`).send({ placements: body.map((x) => ({ ...x, existingLabel: 'x'.repeat(121) })) }), 400)
  })
})
