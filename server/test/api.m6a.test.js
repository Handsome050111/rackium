import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { localDate } from '@rackium/shared/timeZone.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { jpeg, upload } from './helpers/survey.js'
import { deployable, freeze, depView, cmdbView, deliver, deliverAll, install, patch, step } from './helpers/m6a.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { Device } from '../src/models/device.js'
import { SerialRegistry } from '../src/models/serialRegistry.js'
import { dguvReminders } from '../src/deployment/jobs.js'
import { buildingWithScopeIds } from '../src/access/scope.js'

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
const byRole = (v, role) => v.devices.find((d) => d.role === role)
const panelOf = (v) => v.devices.find((d) => d.isPanel)
const connBetween = (v, a, b) => v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [a.id, b.id].sort().join())
const notificationsOf = async (email) => {
  const user = await col('users').findOne({ email })
  return col('notifications').find({ recipientId: user._id }).toArray()
}

// Installed, patched, tested and accepted as designed: Border and Fusion
// (their only shared link), as a quick route to CMDB records.
async function acceptedPair(p) {
  let v = await deliverAll(p)
  const border = byRole(v, 'border')
  const fusion = byRole(v, 'fusion')
  await install(p, border)
  await install(p, fusion)
  v = await depView(p.fe, p)
  const bf = connBetween(v, border, fusion)
  await patch(p, bf)
  expectStatus(await p.fe.post(`${p.dep}/connections/${bf.id}/test`).send({ result: 'pass' }), 200)
  for (const device of [fusion]) {
    for (const s of ['configured', 'tested']) expectStatus(await step(p.fe, p, device, s), 200)
    expectStatus(await p.fe.put(`${p.dep}/devices/${device.id}/dguv`).send({ inspectionDate: '2026-10-01', inspector: 'Elektro Meyer' }), 200)
    expectStatus(await step(p.reviewer, p, device, 'accepted'), 200)
  }
  return { border, fusion, bf }
}

describe('Delivery gating and the installation record (brief §5.7, D22)', () => {
  it('nothing is installed before the design is frozen; a device only once its own procurement line is Delivered; only the Field Engineer installs', async () => {
    const ctx = t()
    const d = await deployable(ctx, { frozen: false })
    const { p } = d
    let v = await depView(p.fe, p)
    expect(v).toMatchObject({ started: true, frozen: false })
    const edge = byRole(v, 'edge')
    expect(edge).toMatchObject({ status: 'planned', deploymentLabel: 'Pending', serialised: true, mainsPowered: true, delivery: { delivered: false } })
    expect((await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ serial: 'FOX1' }).expect(409)).body.error.code).toBe('design_not_frozen')

    await freeze(ctx, d)
    const res = expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ serial: 'FOX1' }), 409)
    expect(res.body.error).toMatchObject({ code: 'awaiting_delivery' })
    expect(res.body.error.message).toMatch(/^Awaiting delivery/)
    await deliver(p, edge.delivery.lineKey)
    v = await depView(p.fe, p)
    expect(byRole(v, 'edge')).toMatchObject({ status: 'delivered', delivery: { delivered: true } })
    // Other devices stay gated by their own lines; the patch panel by its aggregated item line.
    expect(byRole(v, 'border').status).toBe('planned')
    expect(panelOf(v).delivery.lineKey).toMatch(/^item:/)
    expect(byRole(v, 'border').delivery.lineKey).toBe(`device:${byRole(v, 'border').id}`)

    for (const agent of [p.architect, p.admin.agent, p.reviewer, p.viewer]) await agent.put(`${p.dep}/devices/${edge.id}/installation`).send({ serial: 'FOX1' }).expect(403)
    expect((await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ markInstalled: true }).expect(400)).body.error.message).toBe('Record the serial number before marking the device installed')
    expect((await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ serial: 'FOX1', markInstalled: true }).expect(400)).body.error.message).toMatch(/Confirm the rack, RU and face/)
    const out = expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ serial: 'FOX1', mac: '0011.2233.4455', rackId: edge.rackId, ru: edge.ru, face: edge.face, pduOutlet: 'A-07', gps: { lat: 52.52, lng: 13.4, accuracyM: 8 }, markInstalled: true }), 200).body
    expect(out).toMatchObject({ installed: true, device: { status: 'installed', deploymentLabel: 'Installed', installation: { serial: 'FOX1', mac: '00:11:22:33:44:55', ru: edge.ru, face: edge.face, pduOutlet: 'A-07', gps: { lat: 52.52, lng: 13.4, accuracyM: 8 }, technician: 'field_engineer' }, deviations: [] } })
    expect(out.device.installation.installedAt).toBeTruthy()
    // The serial is in the project registry, owned by the device; the design is untouched.
    expect(await col('serialregistries').findOne({ serial: 'FOX1' })).toMatchObject({ ownerType: 'device' })
    const design = await col('devices').findOne({ _id: new mongoose.Types.ObjectId(edge.id) })
    expect(design).toMatchObject({ status: 'planned', ru: edge.ru })
    const audit = await col('auditentries').findOne({ action: 'deployment.device.installed' })
    expect(audit).toMatchObject({ phaseKey: 'deployment', changeType: 'as_built' })
    expect(audit.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['installation.serial', 'installation.mac', 'installation.pduOutlet']))
    // PMs hear about it.
    expect((await notificationsOf('owner@example.com')).map((n) => n.type)).toContain('device_installed')
    v = await depView(p.fe, p)
    expect(v.pipeline.devices).toMatchObject({ planned: 5, installed: 1, remaining: 4 })
    expect(v.tree.counts).toMatchObject({ Installed: 1, Pending: 4 })
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'deployment').status).toBe('in_progress')
    expect(dash.phases.find((x) => x.phaseKey === 'cmdb').status).toBe('not_started')
  }, 120000)

  it('serial and MAC: validated, normalised and unique in the project — CMO-imported gear included', async () => {
    const { p } = await deployable(t())
    const v = await deliverAll(p)
    const [border, fusion] = [byRole(v, 'border'), byRole(v, 'fusion')]
    // A CMO-imported switch with a serial and a MAC.
    await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, async () => {
      const building = await buildingWithScopeIds(p.b001)
      const [cmo] = await Device.create([{ origin: 'existing', status: 'in_service', salId: building.salId, buildingId: building.id, hostname: 'OLD-SW-1', installation: { serial: 'CMO-123', mac: 'aa:bb:cc:dd:ee:01' } }])
      await SerialRegistry.create([{ serial: 'CMO-123', ownerType: 'device', ownerId: cmo._id }])
    })
    const put = (device, body) => p.fe.put(`${p.dep}/devices/${device.id}/installation`).send(body)
    expect((await put(border, { mac: 'zz:zz' }).expect(400)).body.error.message).toMatch(/12 hexadecimal/)
    expect((await put(border, { serial: 'bad serial!' }).expect(400)).body.error.message).toMatch(/letters, digits/)
    expect((await put(border, { serial: 'cmo-123' }).expect(409)).body.error.message).toBe('Serial cmo-123 belongs to the CMO-imported device OLD-SW-1 — check the label')
    expect((await put(border, { mac: 'AA-BB-CC-DD-EE-01' }).expect(409)).body.error.message).toBe('MAC aa:bb:cc:dd:ee:01 belongs to the CMO-imported device OLD-SW-1')
    expectStatus(await put(border, { serial: 'FOX-B', mac: '00-11-22-33-44-55' }), 200)
    expect((await put(fusion, { serial: 'fox-b' }).expect(409)).body.error.message).toMatch(/already recorded on B-DE-ERL/)
    expect((await put(fusion, { mac: '0011.2233.4455' }).expect(409)).body.error.message).toMatch(/already recorded on B-DE-ERL/)
    // A changed serial frees the old one.
    expectStatus(await put(border, { serial: 'FOX-B2' }), 200)
    expectStatus(await put(fusion, { serial: 'FOX-B' }), 200)
    expect((await col('serialregistries').find({ ownerType: 'device' }).toArray()).map((r) => r.serial).sort()).toEqual(['CMO-123', 'FOX-B', 'FOX-B2'])
  }, 120000)
})

describe('Deviations, exceptions and acceptance (brief §5.7)', () => {
  it('a placement differing from the frozen LLD blocks acceptance until corrected or logged and accepted; rejected, corrected and superseded exceptions', async () => {
    const { p } = await deployable(t())
    let v = await deliverAll(p)
    const edge = byRole(v, 'edge')
    const out = await install(p, edge, { ru: 30, face: 'rear' })
    expect(out.device.deviations.map((x) => [x.field, x.designedValue, x.installedValue, x.handled])).toEqual([
      ['ru', String(edge.ru), '30', false],
      ['face', 'front', 'rear', false],
    ])
    expect(out.device.openDeviations).toBe(2)
    // Nothing to log where nothing differs; only the Field Engineer logs.
    expect((await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'rack', reason: 'x' }).expect(409)).body.error.code).toBe('no_deviation')
    await p.reviewer.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'ru', reason: 'x' }).expect(403)
    const photo = await upload(p.fe, p.base, { attachedTo: { type: 'device', id: edge.id }, bytes: await jpeg(), category: 'evidence' })
    const logged = expectStatus(await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'ru', reason: 'RU 40 holds the old router until cut-over', photoFileIds: [photo.id] }), 201).body.exception
    expect(logged).toMatchObject({ status: 'open', label: 'RU', designedValue: String(edge.ru), installedValue: '30', photoFileIds: [photo.id], loggedBy: 'field_engineer' })
    expect((await notificationsOf('reviewer@example.com')).map((n) => n.type)).toContain('exception_logged')
    // Correcting the face closes nothing (none logged) and clears that deviation.
    expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ face: 'front' }), 200)
    // Rejected: the deviation is unhandled again.
    await p.fe.post(`${p.dep}/exceptions/${logged.id}/review`).send({ decision: 'accepted' }).expect(403)
    expect((await p.reviewer.post(`${p.dep}/exceptions/${logged.id}/review`).send({ decision: 'rejected' }).expect(400)).body.error.details[0].message).toBe('Say why the exception is rejected')
    expectStatus(await p.reviewer.post(`${p.dep}/exceptions/${logged.id}/review`).send({ decision: 'rejected', note: 'Move it now' }), 200)
    expect((await notificationsOf('fe@example.com')).map((n) => n.type)).toContain('exception_reviewed')
    v = await depView(p.fe, p)
    expect(byRole(v, 'edge')).toMatchObject({ openDeviations: 1, openExceptions: 0 })
    expect((await p.reviewer.post(`${p.dep}/exceptions/${logged.id}/review`).send({ decision: 'accepted' }).expect(409)).body.error.code).toBe('not_open')
    // Logged again, then the installation changes: superseded; then corrected.
    const again = expectStatus(await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'ru', reason: 'Old router still there' }), 201).body.exception
    expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ ru: 31 }), 200)
    const third = expectStatus(await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'ru', reason: 'Old router still there' }), 201).body.exception
    await install(p, edge, { ru: edge.ru })
    const statuses = Object.fromEntries((await col('deploymentexceptions').find().toArray()).map((e) => [String(e._id), e.status]))
    expect([statuses[logged.id], statuses[again.id], statuses[third.id]]).toEqual(['rejected', 'superseded', 'corrected'])
    v = await depView(p.fe, p)
    expect(byRole(v, 'edge')).toMatchObject({ openDeviations: 0, deviations: [] })
    expect(v.exceptions.map((e) => e.status)).toEqual(['corrected', 'superseded', 'rejected'])
  }, 120000)

  it('connections: patching per cable with ID and Installed length, length beyond tolerance, link tests, acceptance by PM/Reviewer only; device steps and acceptance rights', async () => {
    const { p } = await deployable(t())
    let v = await deliverAll(p)
    const [border, edge, ap, panel] = [byRole(v, 'border'), byRole(v, 'edge'), byRole(v, 'ap'), panelOf(v)]
    for (const device of [border, edge, ap, panel]) await install(p, device)
    v = await depView(p.fe, p)
    const ea = connBetween(v, edge, ap)
    const be = connBetween(v, border, edge)
    expect(ea.segments.map((s) => s.cableId)).toEqual(['C-EA-1', 'C-EA-1b'])
    // Every cable must be confirmed with its ID and length.
    const first = { index: 0, cableId: 'C-EA-1', installedM: 1, confirmed: true }
    expect((await p.fe.put(`${p.dep}/connections/${ea.id}/installation`).send({ segments: [first], confirm: true }).expect(400)).body.error.message).toMatch(/cable 2/)
    await p.architect.put(`${p.dep}/connections/${ea.id}/installation`).send({ segments: [first] }).expect(403)
    // Cable 2 has no designed length (the AP is not in a rack): any length is fine; cable 1 is 1 m designed.
    const done = expectStatus(await p.fe.put(`${p.dep}/connections/${ea.id}/installation`).send({ segments: [{ ...first, installedM: 2 }, { index: 1, cableId: 'C-EA-1b', installedM: 12, confirmed: true }], confirm: true }), 200).body
    expect(done).toMatchObject({ installed: true, connection: { status: 'installed', segments: [{ installed: { cableId: 'C-EA-1', installedM: 2, confirmed: true } }, { installed: { cableId: 'C-EA-1b', installedM: 12 } }] } })
    expect(done.connection.deviations.map((x) => [x.field, x.designedValue, x.installedValue])).toEqual([['length:0', '1 m', '2 m']])
    // Wrong port and cable ID on the trunk too.
    await patch(p, be, { cableIds: { 0: 'C-XX-9' } })
    v = await depView(p.fe, p)
    expect(connBetween(v, border, edge).deviations.map((x) => x.field)).toEqual(['cable_id:0'])
    // Tests: fail → Faulty, pass → Tested; acceptance needs no unresolved difference.
    await p.fe.post(`${p.dep}/connections/${be.id}/accept`).expect(403)
    expectStatus(await p.fe.post(`${p.dep}/connections/${ea.id}/test`).send({ result: 'fail', note: 'NEXT fail' }), 200)
    expect((await depView(p.fe, p)).connections.find((c) => c.id === ea.id)).toMatchObject({ status: 'faulty', test: { result: 'fail', note: 'NEXT fail' } })
    expect((await p.reviewer.post(`${p.dep}/connections/${ea.id}/accept`).expect(409)).body.error.message).toMatch(/link test has passed/)
    expectStatus(await p.fe.post(`${p.dep}/connections/${ea.id}/test`).send({ result: 'pass' }), 200)
    expect((await p.reviewer.post(`${p.dep}/connections/${ea.id}/accept`).expect(409)).body.error.code).toBe('unresolved')
    expectStatus(await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, connectionId: ea.id, field: 'length:0', reason: 'Cable tray detour' }), 201)
    const exc = (await depView(p.reviewer, p)).exceptions[0]
    expectStatus(await p.reviewer.post(`${p.dep}/exceptions/${exc.id}/review`).send({ decision: 'accepted' }), 200)
    expectStatus(await p.reviewer.post(`${p.dep}/connections/${ea.id}/accept`), 200)
    // Re-patching an accepted connection is a CMDB change, not a deployment edit.
    expect((await p.fe.put(`${p.dep}/connections/${ea.id}/installation`).send({ segments: [first] }).expect(409)).body.error.code).toBe('accepted')

    // Device steps: Configured, then Tested only once every connection is tested.
    expect((await step(p.fe, p, edge, 'tested').expect(409)).body.error.message).toMatch(/next is Configured/)
    expectStatus(await step(p.fe, p, edge, 'configured'), 200)
    expect((await step(p.fe, p, edge, 'tested').expect(409)).body.error.message).toMatch(/1 connection\(s\) of this device are not tested/)
    expectStatus(await p.fe.post(`${p.dep}/connections/${be.id}/test`).send({ result: 'pass' }), 200)
    // Re-patching a tested link needs a new test.
    await patch(p, be)
    expect((await depView(p.fe, p)).connections.find((c) => c.id === be.id)).toMatchObject({ status: 'installed', test: null, deviations: [] })
    expectStatus(await p.fe.post(`${p.dep}/connections/${be.id}/test`).send({ result: 'pass' }), 200)
    expectStatus(await step(p.fe, p, edge, 'tested'), 200)
    // Accepted by a PM or Reviewer only, and only with DGUV recorded for a mains-powered device.
    await step(p.fe, p, edge, 'accepted').expect(403)
    await step(p.architect, p, edge, 'accepted').expect(403)
    expect((await step(p.reviewer, p, edge, 'accepted').expect(409)).body.error.message).toBe('Cannot accept yet: no DGUV inspection recorded')
    expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/dguv`).send({ inspectionDate: '2026-10-01', inspector: 'Elektro Meyer' }), 200)
    const accepted = expectStatus(await step(p.admin.agent, p, edge, 'accepted'), 200).body.device
    expect(accepted).toMatchObject({ status: 'accepted', deploymentLabel: 'Ready', acceptedBy: 'Owner', acceptanceBlockers: [] })
    expect(accepted.history.map((h) => h.status)).toEqual(['installed', 'configured', 'tested', 'accepted'])
    expect((await p.fe.put(`${p.dep}/devices/${edge.id}/installation`).send({ notes: 'x' }).expect(409)).body.error.code).toBe('accepted')
    v = await depView(p.fe, p)
    expect(v.pipeline.connections).toMatchObject({ planned: 3, installed: 2, tested: 2 })
    const r2 = v.roomChecklists.find((r) => r.room === 'TR-EG-02')
    // Both links into TR-EG-02 (the trunk and the AP's) are tested.
    expect(r2.tasks.find((x) => x.id === 'test-link')).toMatchObject({ done: 2, total: 2 })
    // The dashboard counts connections from their records (it showed 0 before the M6a review)
    // and summarises DGUV: the Edge inspected, the Border installed but not inspected (APs and panels have no mains).
    const dash = (await p.viewer.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.kpis).toMatchObject({ connections: 3, connectionStatus: { designed: 3, installed: 2, tested: 2, accepted: 1 } })
    expect(dash.dguv).toEqual({ total: 2, valid: 1, expiring_soon: 0, expiring: 0, overdue: 0, notInspected: 1 })
  }, 180000)
})

describe('DGUV V3 (brief §6.9)', () => {
  it('mains-powered devices only; status from the organisation intervals on the local date; no future dates', async () => {
    const { p } = await deployable(t())
    const v = await deliverAll(p)
    const [edge, ap] = [byRole(v, 'edge'), byRole(v, 'ap')]
    await install(p, edge)
    await install(p, ap)
    expect(ap.mainsPowered).toBe(false)
    expect((await p.fe.put(`${p.dep}/devices/${ap.id}/dguv`).send({ inspectionDate: '2026-10-01', inspector: 'X' }).expect(400)).body.error.message).toMatch(/not mains-powered/)
    const today = localDate(new Date(), 'Europe/Berlin')
    const monthsAgo = (n) => {
      const [y, m, d] = today.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1 - n, Math.min(d, 28))).toISOString().slice(0, 10)
    }
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10)
    expect((await p.fe.put(`${p.dep}/devices/${edge.id}/dguv`).send({ inspectionDate: tomorrow, inspector: 'X' }).expect(400)).body.error.message).toMatch(/future/)
    await p.viewer.put(`${p.dep}/devices/${edge.id}/dguv`).send({ inspectionDate: today, inspector: 'X' }).expect(403)
    await p.reviewer.put(`${p.dep}/devices/${edge.id}/dguv`).send({ inspectionDate: today, inspector: 'X' }).expect(403)
    // The screen offers the form only to those the server lets record it.
    expect((await depView(p.reviewer, p)).permissions).toMatchObject({ recordDguv: false, accept: true })
    expect((await depView(p.fe, p)).permissions).toMatchObject({ recordDguv: true, install: true })
    const rec = expectStatus(await p.fe.put(`${p.dep}/devices/${edge.id}/dguv`).send({ inspectionDate: monthsAgo(10), inspector: 'Elektro Meyer' }), 200).body.device
    expect(rec.dguv).toMatchObject({ status: 'valid', inspector: 'Elektro Meyer', lastInspectionDate: monthsAgo(10) })
    // A 12-month interval: about two months left → Expiring soon (≤ 90 days).
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ dguv: { intervalMonths: 12, expiringSoonDays: 30, expiringDays: 60 } }).expect(400)
    expectStatus(await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ dguv: { intervalMonths: 12, expiringSoonDays: 90, expiringDays: 30 } }), 200)
    expect((await depView(p.fe, p)).devices.find((x) => x.id === edge.id).dguv.status).toBe('expiring_soon')
    const audit = await col('auditentries').findOne({ action: 'organisation.settings.updated', 'changes.field': 'dguv.intervalMonths' })
    expect(audit.changes.find((c) => c.field === 'dguv.intervalMonths')).toMatchObject({ before: 48, after: 12 })
  }, 120000)

  it('reminders once per level and due date, on the organisation local date (time zone)', async () => {
    const { p } = await deployable(t())
    const v = await deliverAll(p)
    const edge = byRole(v, 'edge')
    await install(p, edge)
    // Never inspected: one "not inspected" reminder to the PMs, once per device.
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 1 })
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    expect((await notificationsOf('owner@example.com')).filter((n) => n.type === 'dguv_not_inspected').map((n) => n.title)).toEqual([`${edge.hostname} is installed but not DGUV-inspected (B001)`])
    expect((await notificationsOf('fe@example.com')).filter((n) => n.type === 'dguv_not_inspected')).toEqual([])
    // Due 2026-10-13 (48 months). At 22:30 UTC on the 13th it is the 14th in Berlin (overdue)…
    await col('deploymentrecords').updateOne({ deviceId: new mongoose.Types.ObjectId(edge.id) }, { $set: { 'dguv.lastInspectionDate': '2022-10-13', 'dguv.inspector': 'X' } })
    const now = new Date('2026-10-13T22:30:00Z')
    expect(await dguvReminders({ now })).toEqual({ sent: 1, notInspected: 0 })
    expect(await dguvReminders({ now })).toEqual({ sent: 0, notInspected: 0 })
    let pm = (await notificationsOf('owner@example.com')).filter((n) => n.type === 'dguv_expiry')
    expect(pm.map((n) => n.title)).toEqual([`DGUV inspection of ${edge.hostname} overdue since 2026-10-13`])
    // …but still the 13th in New York: due today → Expiring. (The first is read, so the second is not grouped into it.)
    await col('notifications').updateMany({}, { $set: { readAt: new Date() } })
    await col('deploymentrecords').updateOne({ deviceId: new mongoose.Types.ObjectId(edge.id) }, { $set: { 'dguv.remindersSent': [] } })
    expectStatus(await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ timeZone: 'America/New_York' }), 200)
    expect(await dguvReminders({ now })).toEqual({ sent: 1, notInspected: 0 })
    pm = (await notificationsOf('owner@example.com')).filter((n) => n.type === 'dguv_expiry')
    expect(pm.map((n) => n.title)).toContain(`DGUV inspection of ${edge.hostname} expires on 2026-10-13 (Expiring)`)
  }, 120000)
})

describe('CMDB from accepted deployment records (brief §5.8; client audit 9.1, 9.2)', () => {
  it('only accepted devices, with field provenance; accepted connections with the hop trace; reconciliation; change log', async () => {
    const { p } = await deployable(t())
    expect((await cmdbView(p.viewer, p)).records).toEqual([])
    const { border, fusion, bf } = await acceptedPair(p)
    let c = await cmdbView(p.viewer, p)
    expect(c.records.map((r) => r.id)).toEqual([fusion.id])
    const rec = c.records[0]
    expect(rec).toMatchObject({ hostname: fusion.hostname, status: 'accepted', acceptedBy: 'reviewer', serial: expect.stringMatching(/^SN-fusion/), dguv: { status: 'valid' } })
    // Design values carry their label and the freeze date (a missing label once showed as "design").
    expect(rec.provenance.hostname).toMatchObject({ source: 'design', label: 'Design' })
    expect(rec.provenance.hostname.setAt).toBeTruthy()
    expect(rec.provenance.serial).toMatchObject({ source: 'deployment', label: 'Deployment', setBy: 'field_engineer' })
    expect(rec.provenance.dguv.source).toBe('deployment')
    // Border is installed, not accepted: not in the CMDB, and neither is their link.
    expect(c.connections).toEqual([])
    expect(c.reconciliation).toMatchObject({ designCount: 5, installedCount: 2, cmdbCount: 1, notInstalled: 3, cableIdConflicts: [], openExceptions: 0 })
    expect(c.changeLog.map((e) => e.action)).toEqual(expect.arrayContaining(['deployment.device.accepted', 'deployment.device.installed', 'deployment.dguv.recorded']))
    // Border accepted too (its trunk to the Edge tested) → the link is as-built, both directions in the cable matrix.
    const be = connBetween(await depView(p.fe, p), border, byRole(await depView(p.fe, p), 'edge'))
    await patch(p, be)
    expectStatus(await p.fe.post(`${p.dep}/connections/${be.id}/test`).send({ result: 'pass' }), 200)
    for (const s of ['configured', 'tested']) expectStatus(await step(p.fe, p, border, s), 200)
    expectStatus(await p.fe.put(`${p.dep}/devices/${border.id}/dguv`).send({ inspectionDate: '2026-10-01', inspector: 'X' }), 200)
    expectStatus(await step(p.reviewer, p, border, 'accepted'), 200)
    expectStatus(await p.reviewer.post(`${p.dep}/connections/${bf.id}/accept`), 200)
    c = await cmdbView(p.viewer, p)
    expect(c.connections.map((x) => x.id)).toEqual([bf.id])
    expect(c.connections[0]).toMatchObject({ testResult: 'pass', segments: [{ cableId: 'C-BF-1' }] })
    expect(c.cableMatrix.map((r) => `${r.device} ${r.port} → ${r.toDevice} ${r.toPort} ${r.cableIds.join()}`)).toEqual([`${border.hostname} Te1/1/1 → ${fusion.hostname} Te1/1/1 C-BF-1`, `${fusion.hostname} Te1/1/1 → ${border.hostname} Te1/1/1 C-BF-1`])
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'cmdb').status).toBe('in_progress')
    const projects = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/projects`).expect(200)).body.projects
    expect(projects[0].buildings.find((b) => b.id === p.b001).progress).toBeGreaterThan(0)
  }, 180000)

  it('operational edits by an Architect or PM only, audited as operational changes with manual provenance; stale edits refused', async () => {
    const { p } = await deployable(t())
    const { fusion } = await acceptedPair(p)
    const rec = (await cmdbView(p.architect, p)).records[0]
    expect((await cmdbView(p.architect, p)).canEdit).toBe(true)
    expect((await cmdbView(p.fe, p)).canEdit).toBe(false)
    for (const agent of [p.fe, p.viewer, p.reviewer]) await agent.patch(`${p.cmdb}/records/${fusion.id}`).send({ assetTag: 'X', version: rec.version }).expect(403)
    const res = expectStatus(await p.architect.patch(`${p.cmdb}/records/${fusion.id}`).send({ assetTag: 'INV-0042', status: 'maintenance', warrantyEnd: '2031-10-01', version: rec.version }), 200).body
    expect(res.changed).toBe(3)
    await p.admin.agent.patch(`${p.cmdb}/records/${fusion.id}`).send({ notes: 'stale', version: rec.version }).expect(409)
    expect((await p.admin.agent.patch(`${p.cmdb}/records/${fusion.id}`).send({ warrantyStart: '2032-01-01', version: res.version }).expect(400)).body.error.message).toMatch(/before warranty start/)
    const after = (await cmdbView(p.viewer, p)).records[0]
    expect(after).toMatchObject({ assetTag: 'INV-0042', status: 'maintenance', lifecycle: { warrantyEnd: '2031-10-01' } })
    expect(after.provenance.assetTag).toMatchObject({ source: 'manual', setBy: 'architect' })
    expect(after.provenance.status.source).toBe('manual')
    const audit = await col('auditentries').findOne({ action: 'cmdb.record.updated' })
    expect(audit).toMatchObject({ phaseKey: 'cmdb', changeType: 'operational_change', comment: 'Operational change' })
    expect(audit.changes.map((ch) => ch.field).sort()).toEqual(['assetTag', 'lifecycle.warrantyEnd', 'status'])
    // Accepted devices are out of the deployment workflow.
    expect((await step(p.fe, p, fusion, 'configured').expect(409)).body.error.code).toBe('invalid_transition')
  }, 180000)

  it('lifecycle import: matched by serial, then hostname; preview, apply with import provenance; unmatched rows reported', async () => {
    const { p } = await deployable(t())
    const { fusion } = await acceptedPair(p)
    const rec = (await cmdbView(p.architect, p)).records[0]
    const rows = [
      { Serial: rec.serial.toLowerCase(), 'Warranty start': '2026-10-01', 'Warranty end': '01.10.2031' },
      { Hostname: fusion.hostname, 'Refresh date': '2032-06-30' },
      { Serial: 'UNKNOWN', 'Warranty end': '2030-01-01' },
      { Hostname: fusion.hostname, 'Warranty end': 'soon' },
    ]
    await p.fe.post(`${p.cmdb}/lifecycle-import`).send({ buildingId: p.b001, rows }).expect(403)
    const preview = expectStatus(await p.architect.post(`${p.cmdb}/lifecycle-import`).send({ buildingId: p.b001, fileName: 'warranty.xlsx', rows }), 200).body
    expect(preview).toMatchObject({ matched: 2, problems: 2, applied: 0 })
    expect(preview.rows.map((r) => [r.row, r.match, r.device, r.problems.length])).toEqual([
      [2, 'serial', fusion.hostname, 0],
      [3, 'hostname', fusion.hostname, 0],
      [4, null, null, 1],
      [5, 'hostname', fusion.hostname, 1],
    ])
    expect((await cmdbView(p.viewer, p)).records[0].lifecycle.warrantyEnd).toBeNull()
    const applied = expectStatus(await p.architect.post(`${p.cmdb}/lifecycle-import`).send({ buildingId: p.b001, fileName: 'warranty.xlsx', rows, apply: true }), 200).body
    expect(applied).toMatchObject({ applied: 2 })
    const after = (await cmdbView(p.viewer, p)).records[0]
    expect(after.lifecycle).toMatchObject({ warrantyStart: '2026-10-01', warrantyEnd: '2031-10-01', refreshDate: '2032-06-30' })
    expect(after.provenance.warrantyEnd).toMatchObject({ source: 'import', setBy: 'architect', importBatchId: applied.batchId })
    const audit = await col('auditentries').findOne({ action: 'cmdb.lifecycle.imported' })
    expect(audit).toMatchObject({ changeType: 'import', source: 'import', comment: 'warranty.xlsx: 2 device(s) updated' })
    expect((await cmdbView(p.viewer, p)).changeLog.map((e) => e.action)).toContain('cmdb.lifecycle.imported')
  }, 180000)
})

describe('Scopes and isolation (DATA-MODEL §1.6)', () => {
  it('out-of-scope members and other organisations see 404', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await deliverAll(p)
    const edge = byRole(v, 'edge')
    await install(p, edge, { serial: 'FOX-SCOPE' })
    const feB002 = await projectMember(ctx, p.admin, { email: 'fe-b002@example.com', role: 'field_engineer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    await feB002.get(`${p.dep}/buildings/${p.b001}`).expect(404)
    await feB002.get(`${p.cmdb}/buildings/${p.b001}`).expect(404)
    await feB002.put(`${p.dep}/devices/${edge.id}/installation`).send({ notes: 'x' }).expect(404)
    await feB002.post(`${p.dep}/exceptions`).send({ deviceId: edge.id, field: 'ru', reason: 'x' }).expect(404)
    const fileRes = await feB002.get(`${p.base}/files?type=device&id=${edge.id}`)
    expect(fileRes.status).toBe(404)
    // In scope: the B001-scoped Field Engineer works there.
    expectStatus(await p.feB001.put(`${p.dep}/devices/${edge.id}/installation`).send({ notes: 'Scoped engineer' }), 200)
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await other.agent.get(`${p.dep}/buildings/${p.b001}`).expect(404)
    const otherBase = `/api/v1/orgs/${other.orgId}/projects/${p.projectId}`
    await other.agent.get(`${otherBase}/deployment/buildings/${p.b001}`).expect(404)
    await other.agent.put(`${otherBase}/deployment/devices/${edge.id}/installation`).send({ notes: 'x' }).expect(404)
  }, 120000)
})

describe('Installation records outlive a change request (M6a)', () => {
  it('a device the change request removes is retired: serial and MAC released (audited), open exceptions closed, shown in the CMDB change log; no orphaned reservation', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    let v = await deliverAll(p)
    const [edge, ap, panel] = [byRole(v, 'edge'), byRole(v, 'ap'), panelOf(v)]
    await install(p, edge)
    await install(p, panel)
    await install(p, ap, { serial: 'AP-SERIAL-1', mac: '00:11:22:33:44:aa' })
    v = await depView(p.fe, p)
    const ea = connBetween(v, edge, ap)
    await patch(p, ea, { cableIds: { 0: 'C-EA-9' } })
    // An open exception on the link that goes with it.
    expectStatus(await p.fe.post(`${p.dep}/exceptions`).send({ deviceId: ap.id, connectionId: ea.id, field: 'cable_id:0', reason: 'Relabelled' }), 201)
    // The CR removes the AP (and its link) from the design: the HLD and the LLD of its branch.
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Drop the AP', reason: 'Room repurposed' }), 201).body.changeRequest
    const hldOf = async () => (await p.architect.get(`${p.hld}/buildings/${p.b001}?branchId=${cr.branchId}`).expect(200)).body
    let hld = await hldOf()
    const hldAp = hld.devices.find((x) => x.role === 'ap')
    const hldUplink = hld.connections.find((x) => [x.source.deviceId, x.dest.deviceId].includes(hldAp.id))
    expectStatus(await p.architect.delete(`${p.hld}/uplinks/${hldUplink.id}?baseRevision=${hld.design.revision}`), 200)
    hld = await hldOf()
    expectStatus(await p.architect.delete(`${p.hld}/devices/${hldAp.id}?baseRevision=${hld.design.revision}`), 200)
    const branchLink = await d.link('edge', 'ap', cr.branchId)
    expectStatus(await p.architect.delete(`${p.lld}/connections/${branchLink.id}?baseRevision=${await d.rev(cr.branchId)}`), 200)
    const branchAp = await d.device('ap', cr.branchId)
    expectStatus(await p.architect.delete(`${p.lld}/devices/${branchAp.id}?baseRevision=${await d.rev(cr.branchId)}`), 200)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    const { clientDecides } = await import('./helpers/m5a.js')
    expectStatus(await clientDecides(ctx, link, { comments: 'OK' }), 200)

    // Retired, with what it released; no registry row left for it.
    const rec = await col('deploymentrecords').findOne({ deviceId: new mongoose.Types.ObjectId(ap.id) })
    expect(rec).toMatchObject({ status: 'retired', installation: { serial: null, mac: null }, retired: { previousStatus: 'installed', serial: 'AP-SERIAL-1', mac: '00:11:22:33:44:aa', reason: 'CR-1 Drop the AP' } })
    expect(await col('serialregistries').findOne({ serial: 'AP-SERIAL-1' })).toBeNull()
    expect(await col('connectionrecords').findOne({ connectionId: new mongoose.Types.ObjectId(ea.id) })).toMatchObject({ status: 'retired' })
    expect((await col('deploymentexceptions').findOne({ connectionId: new mongoose.Types.ObjectId(ea.id) })).status).toBe('superseded')
    const audit = await col('auditentries').findOne({ action: 'deployment.record.retired' })
    expect(audit).toMatchObject({ changeType: 'system', phaseKey: 'cmdb', objectId: ap.id })
    expect(audit.comment).toMatch(/AP-SERIAL-1 released/)
    expect(audit.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['status', 'installed', 'retired'],
      ['installation.serial', 'AP-SERIAL-1', null],
      ['installation.mac', '00:11:22:33:44:aa', null],
    ])
    // Gone from deployment; the serial and MAC are free for another device.
    v = await depView(p.fe, p)
    expect(v.devices.map((x) => x.id)).not.toContain(ap.id)
    expect(v.exceptions.filter((e) => e.status === 'open')).toEqual([])
    const fusion = byRole(v, 'fusion')
    expectStatus(await p.fe.put(`${p.dep}/devices/${fusion.id}/installation`).send({ serial: 'AP-SERIAL-1', mac: '00-11-22-33-44-AA' }), 200)
    // Listed in the CMDB with the retirement in its change log.
    const c = await cmdbView(p.viewer, p)
    expect(c.retiredRecords).toEqual([expect.objectContaining({ id: ap.id, label: ap.hostname, previousStatus: 'installed', serial: 'AP-SERIAL-1' })])
    expect(c.changeLog.map((e) => e.action)).toEqual(expect.arrayContaining(['deployment.record.retired', 'deployment.connection.retired']))
    expect(c.reconciliation.designCount).toBe(4)
  }, 180000)

  it('a CR approved by the client re-creates the frozen LLD under the same ids: installation, serial and deviations still apply to the new design', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    const v = await deliverAll(p)
    const edge = byRole(v, 'edge')
    await install(p, edge, { serial: 'FOX-CR', ru: 30 })
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Move the edge switch', reason: 'Old router stays' }), 201).body.changeRequest
    // On the branch the Edge moves to RU 30 — where it was installed.
    const branchEdge = await d.device('edge', cr.branchId)
    expectStatus(await d.save('put', `${p.lld}/devices/${branchEdge.id}/placement`, { rackId: edge.rackId, ru: 30, face: 'front' }, { branchId: cr.branchId }), 200)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    const { clientDecides } = await import('./helpers/m5a.js')
    expectStatus(await clientDecides(ctx, link, { comments: 'OK' }), 200)
    const after = byRole(await depView(p.fe, p), 'edge')
    expect(after).toMatchObject({ id: edge.id, ru: 30, status: 'installed', installation: { serial: 'FOX-CR', ru: 30 }, deviations: [], openDeviations: 0 })
  }, 180000)
})
