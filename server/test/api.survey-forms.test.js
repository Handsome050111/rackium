import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { surveyProject, roomWithRack, fillTab, transition, newId, upload, jpeg } from './helpers/survey.js'
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
const edit = (agent, base, target, op, baseLastModifiedAt = null) => agent.post(`${base}/survey/records/edits`).send({ ...target, op, baseLastModifiedAt })
const getRecord = async (agent, base, { buildingId, roomId, tab }) =>
  (await agent.get(`${base}/survey/records`).query({ buildingId, tab, ...(roomId ? { roomId } : {}) }).expect(200)).body.record

describe('survey tab workflow (DATA-MODEL §5.4)', () => {
  it('Draft → Submitted → Rejected (with reason) → Draft on edit → Submitted → Verified; roles enforced at each step', async () => {
    const p = await surveyProject(t())
    const ssid = { buildingId: p.building('B001').id, roomId: null, tab: 'SSID' }
    const rowId = newId()
    await edit(p.fe, p.base, ssid, { kind: 'addRow', sectionIndex: 0, rowId }).expect(200)
    for (const key of ['ssid_name', 'purpose', 'authencation_method', 'ip_assignment', 'where_is_it_used']) {
      await edit(p.fe, p.base, ssid, { kind: 'setField', sectionIndex: 0, rowId, key, value: 'x' }).expect(200)
    }
    expect((await transition(p.architect, p.base, ssid, 'submit')).status).toBe(403)
    const submitted = (await transition(p.fe, p.base, ssid, 'submit').expect(200)).body.record
    expect(submitted.status).toBe('submitted')

    // Locked while the Architect reviews.
    const locked = await edit(p.fe, p.base, ssid, { kind: 'setField', sectionIndex: 0, rowId, key: 'purpose', value: 'y' }).expect(409)
    expect(locked.body.error.code).toBe('tab_submitted')

    expect((await transition(p.fe, p.base, ssid, 'reject', 'nope')).status).toBe(403)
    expect((await transition(p.architect, p.base, ssid, 'reject', '  ')).status).toBe(409)
    const rejected = (await transition(p.architect, p.base, ssid, 'reject', 'SSID purpose is wrong').expect(200)).body.record
    expect(rejected).toMatchObject({ status: 'rejected', rejected: expect.objectContaining({ reason: 'SSID purpose is wrong' }) })

    const editRes = (await edit(p.fe, p.base, ssid, { kind: 'setField', sectionIndex: 0, rowId, key: 'purpose', value: 'Guests' }).expect(200)).body
    expect(editRes.record.status).toBe('draft')
    await transition(p.fe, p.base, ssid, 'submit').expect(200)
    expect((await transition(p.architect, p.base, ssid, 'verify').expect(200)).body.record.status).toBe('verified')
    expect((await transition(p.architect, p.base, ssid, 'verify')).status).toBe(409)
  })

  it('"Must" fields block submit; an empty table is complete; a started incomplete row blocks', async () => {
    const p = await surveyProject(t())
    const b = p.building('B001').id
    const storage = { buildingId: b, roomId: null, tab: 'Storage Area' }
    const blocked = await transition(p.fe, p.base, storage, 'submit').expect(409)
    expect(blocked.body.error.message).toMatch(/Must/)

    const wan = { buildingId: b, roomId: null, tab: 'WAN' }
    expect((await getRecord(p.fe, p.base, wan)).completeness.complete).toBe(true)
    await edit(p.fe, p.base, wan, { kind: 'addRow', sectionIndex: 0, rowId: newId() }).expect(200)
    expect((await getRecord(p.fe, p.base, wan)).completeness.complete).toBe(false)
    await transition(p.fe, p.base, wan, 'submit').expect(409)
  })

  it('calculated fields are filled for the record and are read-only', async () => {
    const p = await surveyProject(t())
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    const firewall = { buildingId: p.building('B001').id, roomId: room.id, tab: 'Firewall' }
    const rowId = newId()
    await edit(p.fe, p.base, firewall, { kind: 'addRow', sectionIndex: 0, rowId }).expect(200)
    const record = await getRecord(p.fe, p.base, firewall)
    expect(record.sections[0][0]).toMatchObject({ building_name: 'Building B001', building_number: 'B001', room_name_number: room.code })
    const refused = await edit(p.fe, p.base, firewall, { kind: 'setField', sectionIndex: 0, rowId, key: 'building_name', value: 'X' }).expect(400)
    expect(refused.body.error.message).toMatch(/calculated/)

    // Rack Layout has one instance per real rack, identity calculated.
    const rl = await getRecord(p.fe, p.base, { ...firewall, tab: 'Rack Layout' })
    expect(rl.sections[0]).toEqual([expect.objectContaining({ rack_name: 'R01', sequence_no: '1' })])
  })

  it('prefill fields: Architect/PM fill them before the survey; the Field Engineer confirms on site', async () => {
    const p = await surveyProject(t())
    const loc = { buildingId: p.building('B001').id, roomId: null, tab: 'Location Details' }
    await edit(p.architect, p.base, loc, { kind: 'setField', sectionIndex: 0, key: 'location_function', value: 'Office' }).expect(200)
    await edit(p.architect, p.base, loc, { kind: 'confirmField', sectionIndex: 0, key: 'location_function', confirmed: true }).expect(403)
    await edit(p.fe, p.base, loc, { kind: 'confirmField', sectionIndex: 0, key: 'location_function', confirmed: true }).expect(200)
    const record = await getRecord(p.fe, p.base, loc)
    expect(record.sections[0]).toMatchObject({ location_function: 'Office', location_function__confirmed: true })
    // A non-prefill field stays the Field Engineer's.
    const fwRow = newId()
    const { room } = await roomWithRack(p.fe, p.base, p.building('B001').id)
    await edit(p.fe, p.base, { ...loc, roomId: room.id, tab: 'Firewall' }, { kind: 'addRow', sectionIndex: 0, rowId: fwRow }).expect(200)
    await edit(p.architect, p.base, { ...loc, roomId: room.id, tab: 'Firewall' }, { kind: 'setField', sectionIndex: 0, rowId: fwRow, key: 'building_wing', value: 'A' }).expect(403)
    await edit(p.viewer, p.base, loc, { kind: 'setField', sectionIndex: 0, key: 'location_id', value: 'x' }).expect(403)
  })

  it('membership scope applies to survey records, and another organisation sees nothing', async () => {
    const ctx = t()
    const p = await surveyProject(ctx)
    const b002 = { buildingId: p.building('B002').id, roomId: null, tab: 'SSID' }
    await p.feB001.get(`${p.base}/survey/records`).query({ buildingId: b002.buildingId, tab: 'SSID' }).expect(404)
    await edit(p.feB001, p.base, b002, { kind: 'addRow', sectionIndex: 0, rowId: newId() }).expect(404)
    await edit(p.fe, p.base, b002, { kind: 'addRow', sectionIndex: 0, rowId: newId() }).expect(200)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.base}/survey/records`).query({ buildingId: b002.buildingId, tab: 'SSID' }).expect(404)
  })
})

describe('serial check for survey forms', () => {
  it("validates a serial against the building's CMO devices; another device's serial is a duplicate", async () => {
    const p = await surveyProject(t())
    const b001 = p.building('B001').id
    await p.admin.agent
      .post(`${p.base}/cmo/import`)
      .send({ salId: p.sal('ERL').id, rows: [{ rowIndex: 0, hostname: 'SW-1', model: 'C9300', serial: 'CMO-777', mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }] })
      .expect(201)
    const check = async (buildingId, serial) => (await p.fe.get(`${p.base}/survey/serials/check`).query({ buildingId, serial }).expect(200)).body.status
    expect(await check(b001, 'cmo-777')).toBe('validated')
    expect(await check(p.building('B002').id, 'CMO-777')).toBe('duplicate')
    expect(await check(b001, 'UNKNOWN-1')).toBe('not-in-cmo')
    await p.feB001.get(`${p.base}/survey/serials/check`).query({ buildingId: p.building('B002').id, serial: 'X' }).expect(404)
  })
})

describe('import, revert to Draft and the design flag', () => {
  async function verifyAll(p, buildingId, roomIds) {
    for (const tab of BUILDING_TABS) await fillTab(p.fe, p.base, { buildingId, tab })
    for (const roomId of roomIds) for (const tab of ROOM_TABS) await fillTab(p.fe, p.base, { buildingId, roomId, tab })
    const targets = [...BUILDING_TABS.map((tab) => ({ buildingId, roomId: null, tab })), ...roomIds.flatMap((roomId) => ROOM_TABS.map((tab) => ({ buildingId, roomId, tab })))]
    for (const target of targets) {
      await transition(p.fe, p.base, target, 'submit').expect(200)
      await transition(p.architect, p.base, target, 'verify').expect(200)
    }
  }

  it('the survey phase is Approved only when every room tab and building tab is Verified; it shows on dashboard and project list', async () => {
    const p = await surveyProject(t())
    const b = p.building('B001').id
    const { room } = await roomWithRack(p.fe, p.base, b)
    const dash = async () => (await p.admin.agent.get(`${p.base}/dashboard/buildings/${b}`).expect(200)).body.phases.find((x) => x.phaseKey === 'survey').status
    expect(await dash()).toBe('not_started')
    await verifyAll(p, b, [room.id])
    const progress = (await p.fe.get(`${p.base}/survey/buildings/${b}/progress`).expect(200)).body
    expect(progress).toMatchObject({ totalCount: 18, verifiedCount: 18, allVerified: true, phaseStatus: 'approved' })
    expect(await dash()).toBe('approved')
    const listed = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/projects`).expect(200)).body.projects[0].buildings.find((x) => x.id === b)
    expect(listed.progress).toBe(50) // CMO not started, Survey approved

    // A new room makes the building incomplete again.
    const structure = (await p.fe.get(`${p.base}/survey/buildings/${b}/structure`).expect(200)).body
    await p.fe.post(`${p.base}/survey/rooms`).send({ floorId: structure.buildings[0].floors[0].id }).expect(201)
    expect(await dash()).toBe('in_progress')
  })

  it('editing a Verified tab reverts it to Draft with an audit entry; editing an Imported one also raises "survey changed after import"', async () => {
    const p = await surveyProject(t())
    const b = p.building('B001').id
    const { room } = await roomWithRack(p.fe, p.base, b)
    await verifyAll(p, b, [room.id])
    const storage = { buildingId: b, roomId: null, tab: 'Storage Area' }

    // Verified → Draft, no flag.
    const res = (await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Changed' }).expect(200)).body
    expect(res.result).toMatchObject({ reverted: true })
    expect(res.record).toMatchObject({ status: 'draft', changedAfterImport: false })
    const audit = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/audit?projectId=${p.projectId}&limit=100`).expect(200)).body.entries.map((e) => e.action)
    expect(audit).toContain('survey.tab.reverted')
    await transition(p.fe, p.base, storage, 'submit').expect(200)
    await transition(p.architect, p.base, storage, 'verify').expect(200)

    // Import (Architect or PM, never the Field Engineer).
    await p.fe.post(`${p.base}/survey/import`).send({ buildingId: b }).expect(403)
    const imported = (await p.architect.post(`${p.base}/survey/import`).send({ buildingId: b }).expect(200)).body
    expect(imported.tabs.every((x) => x.status === 'imported')).toBe(true)
    expect(imported.phaseStatus).toBe('approved')

    // Imported → Draft, with the design flag for M4's HLD.
    const after = (await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Again' }).expect(200)).body
    expect(after.record).toMatchObject({ status: 'draft', changedAfterImport: true })
    expect((await p.fe.get(`${p.base}/survey/buildings/${b}/progress`)).body).toMatchObject({ openDesignFlags: 1, phaseStatus: 'in_progress' })

    // Verifying and importing again clears the flag.
    await transition(p.fe, p.base, storage, 'submit').expect(200)
    await transition(p.architect, p.base, storage, 'verify').expect(200)
    await p.admin.agent.post(`${p.base}/survey/import`).send({ buildingId: b }).expect(200)
    expect((await p.fe.get(`${p.base}/survey/buildings/${b}/progress`)).body.openDesignFlags).toBe(0)
  })

  it('import is refused until every tab is Verified', async () => {
    const p = await surveyProject(t())
    const b = p.building('B001').id
    await roomWithRack(p.fe, p.base, b)
    const res = await p.architect.post(`${p.base}/survey/import`).send({ buildingId: b }).expect(409)
    expect(res.body.error.message).toMatch(/18 still to verify/)
  })
})

describe('custom fields (Org Admin)', () => {
  it('are stored and shown, filled by the Field Engineer, never counted for completeness', async () => {
    const p = await surveyProject(t())
    await p.fe.post(`${p.base}/survey/custom-fields`).send({ tab: 'WAN', label: 'Internal note' }).expect(403)
    const field = (await p.admin.agent.post(`${p.base}/survey/custom-fields`).send({ tab: 'WAN', label: 'Internal note' }).expect(201)).body.customField
    expect(field.key).toMatch(/^custom_[a-f0-9]{24}$/)
    const storage = { buildingId: p.building('B001').id, roomId: null, tab: 'Storage Area' }
    const without = (await getRecord(p.fe, p.base, { ...storage, tab: 'WAN' })).customFields
    expect(without).toEqual([expect.objectContaining({ key: field.key })]) // shown on its tab
    await p.admin.agent.post(`${p.base}/survey/custom-fields`).send({ tab: 'Storage Area', label: 'Gate code' }).expect(201)
    const before = (await getRecord(p.fe, p.base, storage)).completeness
    const gate = (await getRecord(p.fe, p.base, storage)).customFields[0]
    await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: gate.key, value: '1234' }).expect(200)
    const record = await getRecord(p.fe, p.base, storage)
    expect(gate).toMatchObject({ label: 'Gate code', requirement: 'unspecified' })
    expect(record.sections[0][gate.key]).toBe('1234')
    expect(record.completeness).toEqual(before) // never counted
    // A custom field belongs to its own tab only.
    expect((await getRecord(p.fe, p.base, { ...storage, tab: 'SSID' })).customFields).toEqual([])
  })
})

describe('offline sync (DATA-MODEL §5.7)', () => {
  it('replays in queued order; last save wins and the conflict names who changed it; a retried sync never applies twice', async () => {
    const p = await surveyProject(t())
    const storage = { buildingId: p.building('B001').id, roomId: null, tab: 'Storage Area' }
    // The Field Engineer opened the tab (online), then went offline.
    const opened = (await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Room 1' }).expect(200)).body.result.lastModifiedAt
    // Meanwhile a colleague saves the same tab.
    const other = (await edit(p.feB001, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Loading dock' }, opened).expect(200)).body.result
    expect(other.conflict).toBeNull()

    const now = Date.now()
    const edits = [
      { opId: 'op-second-000001', queuedAt: new Date(now + 1000).toISOString(), ...storage, op: { kind: 'setField', sectionIndex: 0, key: 'staging_power_sockets_type', value: 'Schuko' }, baseLastModifiedAt: opened },
      { opId: 'op-first-0000001', queuedAt: new Date(now).toISOString(), ...storage, op: { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Basement' }, baseLastModifiedAt: opened },
    ]
    const first = (await p.fe.post(`${p.base}/survey/sync`).send({ edits }).expect(200)).body.results
    expect(first.map((r) => r.opId)).toEqual(['op-first-0000001', 'op-second-000001'])
    expect(first[0]).toMatchObject({ outcome: 'conflict', conflict: { changedBy: 'field_engineer', fields: [{ field: 'staging_space', theirValue: 'Loading dock', yourValue: 'Basement', changedBy: 'field_engineer' }] } })
    expect(first[1]).toMatchObject({ outcome: 'applied', conflict: null })
    expect((await getRecord(p.fe, p.base, storage)).sections[0].staging_space).toBe('Basement')

    const versionBefore = (await getRecord(p.fe, p.base, storage)).version
    const again = (await p.fe.post(`${p.base}/survey/sync`).send({ edits }).expect(200)).body.results
    expect(again.every((r) => r.duplicate)).toBe(true)
    expect((await getRecord(p.fe, p.base, storage)).version).toBe(versionBefore)

    const audit = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/audit?projectId=${p.projectId}&limit=100`)).body.entries
    expect(audit.some((e) => e.action === 'survey.tab.edited' && e.source === 'offline_sync' && e.conflict === true)).toBe(true)
  })

  // Regression: conflicts were detected per record, so every queued edit after
  // the first (all sharing the base from when the tab was opened) was reported
  // as a conflict with the user's own earlier edit.
  it("the user's own queued edits sharing one base never conflict with each other", async () => {
    const p = await surveyProject(t())
    const storage = { buildingId: p.building('B001').id, roomId: null, tab: 'Storage Area' }
    const opened = (await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'A' }).expect(200)).body.result.lastModifiedAt
    const q = (i, key, value) => ({ opId: `op-own-${String(i).padStart(9, '0')}`, queuedAt: new Date(Date.now() + i).toISOString(), ...storage, op: { kind: 'setField', sectionIndex: 0, key, value }, baseLastModifiedAt: opened })
    const results = (await p.fe.post(`${p.base}/survey/sync`).send({ edits: [q(1, 'staging_space', 'B'), q(2, 'staging_space', 'C'), q(3, 'staging_area_location', 'Hall')] }).expect(200)).body.results
    expect(results.map((r) => r.outcome)).toEqual(['applied', 'applied', 'applied'])
    const audit = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/audit?projectId=${p.projectId}&limit=20`)).body.entries
    expect(audit.filter((e) => e.conflict)).toEqual([])
  })

  it('removing a row a colleague changed after your base is reported as a conflict', async () => {
    const p = await surveyProject(t())
    const wan = { buildingId: p.building('B001').id, roomId: null, tab: 'WAN' }
    const rowId = newId()
    const opened = (await edit(p.fe, p.base, wan, { kind: 'addRow', sectionIndex: 0, rowId }).expect(200)).body.result.lastModifiedAt
    await edit(p.feB001, p.base, wan, { kind: 'setField', sectionIndex: 0, rowId, key: 'wan_cpe_building_wing', value: 'North' }, opened).expect(200)
    const res = (await edit(p.fe, p.base, wan, { kind: 'removeRow', sectionIndex: 0, rowId }, opened).expect(200)).body.result
    expect(res).toMatchObject({ outcome: 'conflict', conflict: { fields: [{ field: 'row', changedBy: 'field_engineer' }] } })
  })

  it('an edit to a row deleted meanwhile is skipped, and an edit to a submitted tab is rejected — both reported', async () => {
    const p = await surveyProject(t())
    const wan = { buildingId: p.building('B001').id, roomId: null, tab: 'WAN' }
    const rowId = newId()
    await edit(p.fe, p.base, wan, { kind: 'addRow', sectionIndex: 0, rowId }).expect(200)
    await edit(p.fe, p.base, wan, { kind: 'removeRow', sectionIndex: 0, rowId }).expect(200)
    const ssid = { buildingId: p.building('B001').id, roomId: null, tab: 'SSID' }
    await transition(p.fe, p.base, ssid, 'submit').expect(200)
    const results = (
      await p.fe
        .post(`${p.base}/survey/sync`)
        .send({
          edits: [
            { opId: 'op-gone-00000001', queuedAt: new Date().toISOString(), ...wan, op: { kind: 'setField', sectionIndex: 0, rowId, key: 'wan_cpe_building_wing', value: 'x' }, baseLastModifiedAt: null },
            { opId: 'op-locked-000001', queuedAt: new Date(Date.now() + 1).toISOString(), ...ssid, op: { kind: 'addRow', sectionIndex: 0, rowId: newId() }, baseLastModifiedAt: null },
          ],
        })
        .expect(200)
    ).body.results
    expect(results[0]).toMatchObject({ outcome: 'skipped' })
    expect(results[1]).toMatchObject({ outcome: 'rejected', reason: expect.stringMatching(/Submitted/) })
  })

  it('a photo captured offline is referenced by its client-chosen id once uploaded; an unknown id is refused', async () => {
    const p = await surveyProject(t())
    const storage = { buildingId: p.building('B001').id, roomId: null, tab: 'Storage Area' }
    await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_area_photos', value: { fileIds: [newId()] } }).expect(400)
    const photo = await upload(p.fe, p.base, { attachedTo: { type: 'surveyTab', ...storage }, bytes: await jpeg() })
    await edit(p.fe, p.base, storage, { kind: 'setField', sectionIndex: 0, key: 'staging_area_photos', value: { fileIds: [photo.id] } }).expect(200)
    expect((await getRecord(p.fe, p.base, storage)).sections[0].staging_area_photos).toEqual({ count: 1, fileIds: [photo.id] })
  })
})
