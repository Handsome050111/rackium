import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp } from './helpers/app.js'
import { hldProject, hldView } from './helpers/hld.js'
import { lldProject, withDesign, complete } from './helpers/lld.js'
import { deployable } from './helpers/m6a.js'
import { clientDecides } from './helpers/m5a.js'
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
const col = (name) => mongoose.connection.db.collection(name)
const oid = (id) => new mongoose.Types.ObjectId(String(id))
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const audit = (action) => col('auditentries').find({ action }).toArray()

// Two CMO switches of B001 in its main room (synthetic names and serials).
async function importCmo(p) {
  const rows = [
    { rowIndex: 0, hostname: 'OLD-SW-01', vendor: null, model: 'Legacy Switch 48', serial: 'SYN-CMO-001', mac: null, building: 'B001', floor: null, room: p.rooms.main.code, rack: p.racks[0].code, ru: '20' },
    { rowIndex: 1, hostname: 'OLD-SW-02', vendor: null, model: 'Legacy Switch 24', serial: 'SYN-CMO-002', mac: null, building: 'B001', floor: null, room: p.rooms.main.code, rack: null, ru: null },
  ]
  expectStatus(await p.admin.agent.post(`${p.base}/cmo/import`).send({ salId: p.sal('ERL').id, rows, fileName: 'cmo.xlsx' }), 201)
  const view = await hldView(p.architect, p)
  return { one: view.cmoDevices.find((d) => d.hostname === 'OLD-SW-01'), two: view.cmoDevices.find((d) => d.hostname === 'OLD-SW-02') }
}
const helpers = (p, branchId = null) => {
  const view = (agent = p.architect) => (branchId ? agent.get(`${p.hld}/buildings/${p.b001}`).query({ branchId }).expect(200).then((r) => r.body) : hldView(agent, p))
  return {
    view,
    device: async (role) => (await view()).devices.find((d) => d.role === role),
    // A design write with the current revision, read before the request is built.
    write: async (method, url, body = {}, agent = p.architect) => {
      const baseRevision = (await view()).design.revision
      return agent[method](url).send({ ...body, ...(branchId ? { branchId } : {}), baseRevision })
    },
    decide: async (deviceId, body, agent = p.architect) => {
      const baseRevision = (await view()).design.revision
      return agent.put(`${p.hld}/devices/${deviceId}/cmo-decision`).send({ ...body, ...(branchId ? { branchId } : {}), baseRevision })
    },
    validation: async () => (await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).query(branchId ? { branchId } : {}).expect(200)).body,
  }
}
async function generated(ctx = t()) {
  const p = await hldProject(ctx)
  const v0 = await hldView(p.architect, p)
  await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: v0.design.revision }).expect(201)
  return p
}

describe('State labels are configuration (addendum v2.3 Q5; DATA-MODEL §5.21)', () => {
  it('CMO / IMO / FMO by default; the organisation sets its own, a project overrides them, null goes back; audited; only who manages settings may change them', async () => {
    const p = await hldProject(t())
    const labels = async () => (await p.architect.get(`${p.base}/mode-labels`).expect(200)).body
    expect(await labels()).toMatchObject({ modeLabels: { current: 'CMO', interim: 'IMO', future: 'FMO' }, defaults: { current: 'CMO', interim: 'IMO', future: 'FMO' }, project: { current: null, interim: null, future: null } })
    // The organisation's words.
    const org = expectStatus(await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ modeLabels: { current: 'As-Is', interim: 'Transition', future: 'To-Be' } }), 200).body.settings
    expect(org.modeLabels).toEqual({ current: 'As-Is', interim: 'Transition', future: 'To-Be' })
    expect(await labels()).toMatchObject({ modeLabels: { current: 'As-Is', interim: 'Transition', future: 'To-Be' }, organisation: { current: 'As-Is' } })
    // A project's own over them; the HLD reads what is in force.
    expectStatus(await p.admin.agent.patch(`${p.base}/mode-labels`).send({ modeLabels: { future: 'Target' } }), 200)
    expect((await labels()).modeLabels).toEqual({ current: 'As-Is', interim: 'Transition', future: 'Target' })
    expect((await hldView(p.architect, p)).modeLabels).toEqual({ current: 'As-Is', interim: 'Transition', future: 'Target' })
    expect((await audit('settings.mode_labels.updated'))[0].changes).toEqual([expect.objectContaining({ field: 'modeLabels.future', before: 'To-Be', after: 'Target' })])
    expect((await audit('organisation.settings.updated'))[0].changes.map((c) => c.field)).toEqual(['modeLabels.current', 'modeLabels.interim', 'modeLabels.future'])
    // null goes back to the organisation's.
    expectStatus(await p.admin.agent.patch(`${p.base}/mode-labels`).send({ modeLabels: { future: null } }), 200)
    expect((await labels()).modeLabels.future).toBe('To-Be')
    // Refused: too long, empty, unknown state, nothing; an Architect or Viewer may not.
    for (const body of [{ modeLabels: { future: 'x'.repeat(25) } }, { modeLabels: { future: '' } }, { modeLabels: { target: 'X' } }, { modeLabels: {} }]) expectStatus(await p.admin.agent.patch(`${p.base}/mode-labels`).send(body), 400)
    expectStatus(await p.architect.patch(`${p.base}/mode-labels`).send({ modeLabels: { future: 'X' } }), 403)
    expectStatus(await p.viewer.patch(`${p.base}/mode-labels`).send({ modeLabels: { future: 'X' } }), 403)
  }, 120000)
})

describe('Decisions on CMO gear in the HLD (addendum v2.3 Q5; DATA-MODEL §5.21)', () => {
  it('each CMO device gets Keep (a new name from the naming pattern, not applied yet), Replace (by a future device) or Remove; undecided is a warning, never a block; cleared again; audited; Architect only', async () => {
    const p = await generated()
    const h = helpers(p)
    const { one, two } = await importCmo(p)
    expect(one).toMatchObject({ origin: 'existing', cmo: true, modeState: 'current', cmoDecision: null, roomCode: p.rooms.main.code, rackCode: p.racks[0].code })
    // Undecided: W-NO-DECISION on both, a warning.
    let v = await h.validation()
    const undecided = v.findings.filter((f) => f.rule === 'W-NO-DECISION')
    expect(undecided.map((f) => f.objectId).sort()).toEqual([one.id, two.id].sort())
    expect(undecided.every((f) => f.severity === 'warning')).toBe(true)
    expect(v.summary.blocksSubmit).toBe(false)

    // Keep: a role, and the name the pattern gives it — the device itself unchanged until the LLD is approved.
    const kept = expectStatus(await h.decide(one.id, { decision: 'keep', role: 'edge' }), 200).body.decision
    expect(kept).toMatchObject({ decision: 'keep', role: 'edge', hostname: expect.stringMatching(/^E-DE-ERL-C01-B001-EG-\d{3}$/) })
    const planned = (await h.view()).devices.map((d) => d.hostname)
    expect(planned).not.toContain(kept.hostname)
    const raw = await col('devices').findOne({ _id: oid(one.id) })
    expect(raw).toMatchObject({ hostname: 'OLD-SW-01', legacyHostname: null })
    expect(raw.modeState ?? null).toBe(null)
    // The same role again keeps the name; a later planned edge does not take it.
    expect(expectStatus(await h.decide(one.id, { decision: 'keep', role: 'edge' }), 200).body.decision.hostname).toBe(kept.hostname)
    const added = expectStatus(await h.write('post', `${p.hld}/devices`, { buildingId: p.b001, role: 'edge', roomId: p.rooms.main.id }), 201).body.device
    expect(added.hostname).not.toBe(kept.hostname)

    // Replace: by a device of the future design; not by interim kit, not by a device elsewhere.
    const edge = await h.device('edge')
    expect(expectStatus(await h.decide(two.id, { decision: 'replace', replacedById: edge.id }), 200).body.decision).toMatchObject({ decision: 'replace', replacedById: edge.id, replacedByName: edge.hostname })
    const temp = expectStatus(await h.write('post', `${p.hld}/devices`, { buildingId: p.b001, role: 'edge', roomId: p.rooms.main.id, modeState: 'interim' }), 201).body.device
    expect(temp.modeState).toBe('interim')
    expect(expectStatus(await h.decide(two.id, { decision: 'replace', replacedById: temp.id }), 400).body.error.message).toMatch(/FMO/)
    expectStatus(await h.decide(two.id, { decision: 'replace', replacedById: one.id }), 404)
    // The contract: Keep needs a role, Replace a device, Remove neither.
    expectStatus(await h.decide(two.id, { decision: 'keep' }), 400)
    expectStatus(await h.decide(two.id, { decision: 'replace' }), 400)
    expectStatus(await h.decide(two.id, { decision: 'remove', role: 'edge' }), 400)
    // Only CMO gear; only the Architect.
    expectStatus(await h.decide(edge.id, { decision: 'remove' }), 404)
    expectStatus(await h.decide(two.id, { decision: 'remove' }, p.fe), 403)
    expectStatus(await h.decide(two.id, { decision: 'remove' }, p.viewer), 403)

    v = await h.validation()
    expect(v.findings.filter((f) => f.rule === 'W-NO-DECISION')).toEqual([])
    const view = await h.view()
    expect(view.cmoDevices.find((d) => d.id === two.id).cmoDecision).toMatchObject({ decision: 'replace', replacedById: edge.id })

    // The replacement leaves the design: a warning again.
    expectStatus(await p.architect.delete(`${p.hld}/devices/${edge.id}`).query({ baseRevision: view.design.revision }), 200)
    expect((await h.validation()).findings.find((f) => f.rule === 'W-NO-DECISION')).toMatchObject({ objectId: two.id, message: expect.stringMatching(/no longer in the design/) })

    // Remove, then clear: undecided again.
    expectStatus(await h.decide(two.id, { decision: 'remove' }), 200)
    const rev = (await h.view()).design.revision
    expectStatus(await p.architect.delete(`${p.hld}/devices/${two.id}/cmo-decision`).query({ baseRevision: rev }), 200)
    expect((await h.view()).cmoDevices.find((d) => d.id === two.id).cmoDecision).toBe(null)
    expectStatus(await p.architect.delete(`${p.hld}/devices/${two.id}/cmo-decision`).query({ baseRevision: rev + 1 }), 404)
    // A stale decision is refused like any design write.
    expectStatus(await p.architect.put(`${p.hld}/devices/${two.id}/cmo-decision`).send({ decision: 'remove', baseRevision: 0 }), 409)
    const decided = await audit('hld.cmo.decided')
    expect(decided[0]).toMatchObject({ objectId: one.id, changes: [expect.objectContaining({ field: 'cmoDecision', before: null, after: `keep · ${kept.hostname}` })] })
    expect((await audit('hld.cmo.decision_cleared')).length).toBe(1)
  }, 180000)

  it('interim kit and links: added as IMO; an FMO link to interim kit or to CMO gear marked Remove is Critical (blocks submit) until the link is IMO; the wizard check says so', async () => {
    const p = await generated()
    const h = helpers(p)
    const { two } = await importCmo(p)
    const border = await h.device('border')
    // Interim kit: created IMO, switched to FMO and back; audited.
    const temp = expectStatus(await h.write('post', `${p.hld}/devices`, { buildingId: p.b001, role: 'edge', roomId: p.rooms.main.id, modeState: 'interim' }), 201).body.device
    expect((await h.view()).devices.find((d) => d.id === temp.id).modeState).toBe('interim')
    expect((await audit('hld.device.added')).at(-1).comment).toMatch(/\(IMO\)$/)
    // An FMO link to it: Critical; the wizard check fails it too.
    const link = expectStatus(await h.write('post', `${p.hld}/uplinks`, { buildingId: p.b001, source: { deviceId: border.id }, dest: { deviceId: temp.id }, media: 'os2', speed: '10G' }), 201).body.uplink
    expect(link.modeState).toBe('future')
    let v = await h.validation()
    expect(v.findings.find((f) => f.rule === 'E-MODE-LINK')).toMatchObject({ severity: 'critical', objectId: link.id, message: expect.stringMatching(/this FMO link ends on .*, which is IMO only/) })
    expect(v.summary.blocksSubmit).toBe(true)
    const check = expectStatus(await p.architect.post(`${p.hld}/uplinks/check`).send({ buildingId: p.b001, connectionId: link.id, source: { deviceId: border.id }, dest: { deviceId: temp.id }, media: 'os2', speed: '10G' }), 200).body
    expect(check.blocked).toBe(true)
    expect(check.checks.find((c) => c.id === 'mode-state')).toMatchObject({ status: 'fail' })
    expect(expectStatus(await h.write('post', `${p.hld}/submit`, { buildingId: p.b001 }), 409).body.error.code).toBe('validation_blocked')
    // The link made IMO: fine.
    expect(expectStatus(await h.write('patch', `${p.hld}/uplinks/${link.id}`, { modeState: 'interim' }), 200).body.uplink.modeState).toBe('interim')
    expect((await h.validation()).findings.filter((f) => f.rule === 'E-MODE-LINK')).toEqual([])
    expect((await audit('hld.uplink.updated')).at(-1).changes).toEqual([expect.objectContaining({ field: 'modeState', before: 'future', after: 'interim' })])

    // CMO gear on the canvas: its links are listed; an FMO link to gear marked Remove is Critical, Keep is fine.
    const toCmo = expectStatus(await h.write('post', `${p.hld}/uplinks`, { buildingId: p.b001, source: { deviceId: border.id }, dest: { deviceId: two.id }, media: 'cat6a', speed: '1G' }), 201).body.uplink
    expect((await h.view()).connections.map((c) => c.id)).toContain(toCmo.id)
    expect((await h.validation()).findings.filter((f) => f.rule === 'E-MODE-LINK')).toEqual([])
    expectStatus(await h.decide(two.id, { decision: 'remove' }), 200)
    expect((await h.validation()).findings.find((f) => f.rule === 'E-MODE-LINK')).toMatchObject({ objectId: toCmo.id, message: expect.stringMatching(/which is marked Remove \(CMO only\)/) })
    expectStatus(await h.decide(two.id, { decision: 'keep', role: 'edge' }), 200)
    expect((await h.validation()).findings.filter((f) => f.rule === 'E-MODE-LINK')).toEqual([])

    // The device made FMO itself: the IMO link stays valid, an FMO one too.
    expectStatus(await h.write('patch', `${p.hld}/devices/${temp.id}`, { modeState: 'future' }), 200)
    expect((await h.view()).devices.find((d) => d.id === temp.id).modeState).toBe('future')
  }, 180000)
})

describe('The LLD carries the modes, and its approval applies Keep (addendum v2.3 Q5; DATA-MODEL §5.21)', () => {
  it('the LLD starts with the HLD’s interim kit and links; approving the LLD renames kept CMO gear (old name kept, immutable), puts it in the future state, leaves removed gear current, and gives the reprint task', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    const h = helpers(p)
    const { one, two } = await importCmo(p)
    // After the HLD's approval the Architect still decides on the main HLD.
    const kept = expectStatus(await h.decide(one.id, { decision: 'keep', role: 'edge' }), 200).body.decision
    expectStatus(await h.decide(two.id, { decision: 'remove' }), 200)
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom'] }).expect(200)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const d = withDesign(p)
    // The LLD shows the CMO gear with the HLD's decisions.
    let lld = await d.view()
    expect(lld.modeLabels).toEqual({ current: 'CMO', interim: 'IMO', future: 'FMO' })
    expect(lld.devices.find((x) => x.id === one.id)).toMatchObject({ cmo: true, modeState: 'current', cmoDecision: { decision: 'keep', hostname: kept.hostname } })
    expect(lld.connections.every((c) => c.modeState === 'future')).toBe(true)
    await complete(d)
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
    expect(await col('tasks').countDocuments({ kind: 'reprint_labels' })).toBe(0)
    await p.admin.agent.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)

    const [rawOne, rawTwo] = await Promise.all([one, two].map((x) => col('devices').findOne({ _id: oid(x.id) })))
    expect(rawOne).toMatchObject({ hostname: kept.hostname, legacyHostname: 'OLD-SW-01', modeState: 'future', role: 'edge' })
    expect(rawTwo).toMatchObject({ hostname: 'OLD-SW-02', legacyHostname: null })
    expect(rawTwo.modeState ?? 'current').toBe('current')
    lld = await d.view()
    expect(lld.devices.find((x) => x.id === one.id)).toMatchObject({ modeState: 'future', label: `OLD-SW-01 → ${kept.hostname}` })
    const applied = (await audit('device.mode_state.applied'))[0]
    expect(applied.changes.map((c) => [c.objectId, c.field, c.after]).sort()).toEqual([[one.id, 'hostname', kept.hostname], [one.id, 'legacyHostname', 'OLD-SW-01'], [one.id, 'modeState', 'future'], [one.id, 'role', 'edge']].sort())
    // CMO gear is on site: its labels are reprinted.
    const tasks = await col('tasks').find({ kind: 'reprint_labels' }).toArray()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: 'Reprint labels — LLD of B001: 1 renamed device(s)', relatedObjectType: null, renames: [{ deviceId: one.id, from: 'OLD-SW-01', to: kept.hostname }] })
    // The old name is immutable.
    await expect(mongoose.model('Device').updateOne({ _id: oid(one.id) }, { $set: { legacyHostname: 'X' } })).rejects.toThrow(/immutable/)
  }, 300000)

  it('interim kit reaches the LLD from the approved HLD with its mode', async () => {
    const p = await generated()
    const h = helpers(p)
    const edge = await h.device('edge')
    const temp = expectStatus(await h.write('post', `${p.hld}/devices`, { buildingId: p.b001, role: 'ap', roomId: p.rooms.second.id, modeState: 'interim' }), 201).body.device
    const link = expectStatus(await h.write('post', `${p.hld}/uplinks`, { buildingId: p.b001, source: { deviceId: edge.id }, dest: { deviceId: temp.id }, media: 'cat6a', speed: '1G', modeState: 'interim' }), 201).body.uplink
    expect(link.modeState).toBe('interim')
    expectStatus(await h.write('post', `${p.hld}/submit`, { buildingId: p.b001 }), 201)
    await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld'] }).expect(200)
    await p.architect.post(`${p.base}/lld/start`).send({ buildingId: p.b001 }).expect(201)
    const lld = (await p.architect.get(`${p.base}/lld/buildings/${p.b001}`).expect(200)).body
    const copy = lld.devices.find((x) => x.hldRef === temp.id)
    expect(copy).toMatchObject({ modeState: 'interim', inDesign: true })
    expect(lld.connections.find((c) => c.hldRef === link.id).modeState).toBe('interim')
    // The HLD version's snapshot carries the mode too (versions and diffs read it).
    const version = await col('designversions').findOne({ designType: 'hld' })
    expect(version.counts.devices).toBeGreaterThan(0)
  }, 180000)
})

describe('A change request changes the decisions on a frozen HLD (addendum v2.3 Q5; DATA-MODEL §5.21)', () => {
  it('frozen: refused on the main HLD; on the branch the decision is made and shows in the impact; the client’s approval writes it onto the device, with the reprint task', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    p.hld = `${p.base}/hld`
    const { one } = await importCmo(p)
    const h = helpers(p)
    expect(expectStatus(await h.decide(one.id, { decision: 'keep', role: 'edge' }), 409).body.error.code).toBe('change_request_required')
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Keep the old access switch', reason: 'Budget' }), 201).body.changeRequest
    const b = helpers(p, cr.branchId)
    const kept = expectStatus(await b.decide(one.id, { decision: 'keep', role: 'edge' }), 200).body.decision
    expect((await b.view()).cmoDevices.find((x) => x.id === one.id).cmoDecision).toMatchObject({ decision: 'keep' })
    expect((await h.view()).cmoDevices.find((x) => x.id === one.id).cmoDecision).toBe(null)
    const impact = (await p.admin.agent.get(`${p.base}/change-requests/${cr.id}`).expect(200)).body.changeRequest.impact
    expect(impact.design.hld.decisions.added).toEqual([{ id: one.id, label: 'OLD-SW-01' }])
    expect(impact.design.total).toBe(1)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    expectStatus(await clientDecides(ctx, link, { decision: 'approved', comments: 'Approved' }), 200)

    expect(await col('devices').findOne({ _id: oid(one.id) })).toMatchObject({ hostname: kept.hostname, legacyHostname: 'OLD-SW-01', modeState: 'future' })
    expect((await h.view()).cmoDevices.find((x) => x.id === one.id)).toMatchObject({ modeState: 'future', cmoDecision: { decision: 'keep', hostname: kept.hostname } })
    expect(await col('cmodecisions').countDocuments({ layer: { $ne: 'hld' } })).toBe(0)
    const [task] = await col('tasks').find({ kind: 'reprint_labels' }).toArray()
    expect(task).toMatchObject({ relatedObjectType: 'change_request', relatedObjectId: cr.id, renames: [{ deviceId: one.id, from: 'OLD-SW-01', to: kept.hostname }] })
  }, 400000)
})
