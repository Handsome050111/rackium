import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import * as XLSX from 'xlsx'
import { localDate, addDays, startOfLocalDay, localTime } from '@rackium/shared/timeZone.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { deployable, deliverAll, install, depView, acceptEverything } from './helpers/m6a.js'
import { hldProject } from './helpers/hld.js'
import { lldProject } from './helpers/lld.js'
import { dguvReminders } from '../src/deployment/jobs.js'
import { scheduleAlerts } from '../src/schedule/service.js'
import { forEachProject } from '../src/notifications/jobs.js'

// M7b-1 (addendum v2.3): the External Reviewer and the price rules wherever a
// price, margin or supplier could appear; DGUV exemption with a reason; BOM
// accuracy against the as-installed and the BOM revision count; the SLA
// escalation contact; the save-time port conflict check.
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
const get = async (agent, url, status = 200) => expectStatus(await agent.get(url), status).body
const me = async (agent) => (await agent.get('/api/v1/me').expect(200)).body.user.id
const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })

// Anything priced or commercial anywhere in a response: a price, cost,
// margin or BOM value with a value; the supplier, PO number and notes set below.
const PRICE_KEYS = new Set(['unitPriceMinor', 'lineTotalMinor', 'costMinor', 'sellMinor', 'marginPercent', 'pricePerMetreMinor', 'minimumMinor', 'costBeforeMinor', 'costAfterMinor', 'poNumber', 'bomValue'])
const SECRETS = ['Acme Distribution GmbH', 'PO-SECRET-4711', 'Agreed 12% below list']
function leaks(body) {
  const found = []
  const walk = (v, path) => {
    if (v == null) return
    if (typeof v === 'string') {
      for (const s of SECRETS) if (v.includes(s)) found.push(`${path}: ${s}`)
      return
    }
    if (typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) {
      if (PRICE_KEYS.has(k) && x != null && x !== false) found.push(`${path}.${k}`)
      if (k === 'pricing' && x) found.push(`${path}.pricing`)
      walk(x, `${path}.${k}`)
    }
  }
  walk(body, '$')
  return found
}

describe('External Reviewer (addendum v2.3 Q11): approves designs like a Reviewer, never sees prices, margins or suppliers', () => {
  it('approves or sends back an HLD and is told when one is submitted; cannot accept installations, export cost prices or read the audit log', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    const er = await projectMember(ctx, p.admin, { email: 'client-reviewer@example.com', role: 'external_reviewer', projectId: p.projectId })
    const erId = await me(er)
    // Invited with the new role and shown with its name.
    expect(await col('memberships').findOne({ userId: oid(erId), projectId: oid(p.projectId), role: 'external_reviewer', active: true })).toBeTruthy()
    let v = await get(p.architect, `${p.hld}/buildings/${p.b001}`)
    await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: v.design.revision }).expect(201)
    v = await get(p.architect, `${p.hld}/buildings/${p.b001}`)
    expectStatus(await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision: v.design.revision }), 201)
    // Told, like the PM and the Reviewer.
    expect(await col('notifications').countDocuments({ type: 'hld_submitted', recipientId: oid(erId) })).toBe(1)
    expectStatus(await er.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested', comment: 'Please add a second uplink' }), 200)
    v = await get(p.architect, `${p.hld}/buildings/${p.b001}`)
    expectStatus(await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision: v.design.revision }), 201)
    expectStatus(await er.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }), 200)
    expect((await get(p.viewer, `${p.hld}/buildings/${p.b001}`)).design.state).toBe('approved')
    // Raises a blocker (a comment on the work), like a Reviewer.
    expectStatus(await er.post(`${p.base}/blockers`).send({ buildingId: p.b001, phaseKey: 'hld', description: 'Client: rack R02 is not ours' }), 201)
    // Not the Reviewer's internal rights.
    expectStatus(await er.get(`/api/v1/orgs/${p.admin.orgId}/audit?projectId=${p.projectId}`), 403)
    expectStatus(await er.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx', options: { prices: 'cost' } }), 403)
    expectStatus(await er.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx', options: { prices: 'sell' } }), 403)
    expectStatus(await er.post(`${p.base}/documents`).send({ typeKey: 'bom-summary', format: 'csv', options: { prices: 'sell' } }), 403)
    expectStatus(await er.patch(`${p.base}/commercial-settings`).send({ marginPercent: 1 }), 403)
  }, 240000)

  it('no price, cost, margin, BOM value, supplier, PO number or procurement note in any screen, API, export, report, search or document — a PM sees them all', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    const er = await projectMember(ctx, p.admin, { email: 'client-reviewer@example.com', role: 'external_reviewer', projectId: p.projectId })
    const org = `/api/v1/orgs/${p.admin.orgId}`
    // Procurement facts on a line: a supplier, a PO number, a note.
    const bom = await get(p.admin.agent, `${p.base}/bom/buildings/${p.b001}`)
    const line = bom.lines.find((l) => l.lineType === 'serialised')
    expectStatus(await p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: line.key, status: 'ordered', vendor: SECRETS[0], poNumber: SECRETS[1], notes: SECRETS[2], version: 0 }), 200)
    // A change request whose BOM impact has a cost before and after.
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Longer trunk', reason: 'Route changed' }), 201).body.changeRequest
    const be = await d.link('border', 'edge', cr.branchId)
    expectStatus(await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 75 }, { branchId: cr.branchId }), 200)
    // Priced documents a PM made: never listed or opened for the External Reviewer.
    const sell = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx', options: { prices: 'sell' } }), 202).body.document
    const own = expectStatus(await er.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'bom-final', format: 'xlsx' }), 202).body.document
    const report = expectStatus(await er.post(`${p.base}/documents`).send({ typeKey: 'bom-summary', format: 'csv' }), 202).body.document
    await ctx.app.__documents.process()

    const catalogue = await get(er, `${org}/catalogue?projectId=${p.projectId}`)
    const pricedItem = (await get(p.admin.agent, `${org}/catalogue?projectId=${p.projectId}`)).items.find((i) => i.unitPriceMinor != null)
    const screens = [
      `${p.base}/bom/buildings/${p.b001}`,
      `${p.base}/commercial-settings`,
      `${p.base}/solution-package/buildings/${p.b001}`,
      `${p.base}/change-requests/buildings/${p.b001}`,
      `${p.base}/change-requests/${cr.id}`,
      `${p.base}/dashboard`,
      `${p.base}/dashboard/rollup`,
      `${p.base}/dashboard/buildings/${p.b001}`,
      `${org}/dashboard`,
      `${p.base}/analytics`,
      `${p.base}/deployment/buildings/${p.b001}`,
      `${p.base}/cmdb/buildings/${p.b001}`,
      `${p.base}/hld/buildings/${p.b001}`,
      `${p.base}/lld/buildings/${p.b001}`,
      `${p.base}/documents?buildingId=${p.b001}`,
      `${p.base}/documents`,
      `${org}/search?q=Acme`,
      `${org}/search?q=PO-SECRET`,
      `${org}/catalogue/${pricedItem.id}?projectId=${p.projectId}`,
    ]
    expect(leaks(catalogue)).toEqual([])
    for (const url of screens) expect(leaks(await get(er, url)), url).toEqual([])
    // The BOM: quantities and specifications only.
    const erBom = await get(er, `${p.base}/bom/buildings/${p.b001}`)
    expect(erBom).toMatchObject({ showPrices: false, procurementDetails: false, pricing: null })
    expect(erBom.lines.find((l) => l.key === line.key).procurement).toMatchObject({ status: 'ordered' })
    expect(erBom.lines.find((l) => l.key === line.key).qty).toBe(line.qty)
    // Not listed, not opened; their own unpriced document and report open and hold nothing priced.
    expect((await get(er, `${p.base}/documents?buildingId=${p.b001}`)).documents.map((x) => x.id)).not.toContain(sell.id)
    expectStatus(await er.get(`${p.base}/documents/${sell.id}/download`), 404)
    const workbook = (await binary(er.get(`${p.base}/documents/${own.id}/download`)).expect(200)).body
    const text = XLSX.read(workbook).SheetNames.map((n) => XLSX.utils.sheet_to_csv(XLSX.read(workbook).Sheets[n])).join('\n')
    for (const s of SECRETS) expect(text).not.toContain(s)
    expect(text).not.toMatch(/Unit price|Line total/)
    const csv = (await binary(er.get(`${p.base}/documents/${report.id}/download`)).expect(200)).body.toString('utf8')
    for (const s of SECRETS) expect(csv).not.toContain(s)
    expect(csv).not.toMatch(/Value|EUR/)
    // The client's own link to the change request: no cost either.
    expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
    const pub = (await ctx.agent().post(`/api/v1/public/share-links/${link.token}/view`).send({ password: link.password }).expect(200)).body
    expect(pub.changeRequest.impact.bom.lines.length).toBeGreaterThan(0)
    expect(leaks(pub)).toEqual([])

    // Found while building this: the margin and a change request's costs went
    // to every member. Now only to those who may see prices.
    for (const agent of [p.architect, p.viewer, p.fe]) {
      expect(leaks(await get(agent, `${p.base}/commercial-settings`))).toEqual([])
      expect(leaks(await get(agent, `${p.base}/change-requests/${cr.id}`))).toEqual([])
    }
    // The PM sees everything (the scan is not blind).
    const pmBom = await get(p.admin.agent, `${p.base}/bom/buildings/${p.b001}`)
    expect(pmBom.lines.find((l) => l.key === line.key).procurement).toMatchObject({ vendor: SECRETS[0], poNumber: SECRETS[1], notes: SECRETS[2] })
    expect(leaks(pmBom).length).toBeGreaterThan(0)
    expect((await get(p.admin.agent, `${p.base}/commercial-settings`)).settings.marginPercent).toBe(15)
    expect((await get(p.admin.agent, `${p.base}/change-requests/${cr.id}`)).changeRequest.impact.bom).toMatchObject({ costBeforeMinor: expect.any(Number), costAfterMinor: expect.any(Number) })
    expect(leaks(await get(p.reviewer, `${p.base}/dashboard/rollup`)).length).toBeGreaterThan(0)
  }, 300000)
})

describe('DGUV exemption with a reason (addendum v2.3 Q13; v2.2 §20.9)', () => {
  it('the PM exempts a device (reason mandatory, audited); exempt devices are never overdue or reminded, listed apart on the dashboard, CSV and report; the model sets the default; a device can be required anyway', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await deliverAll(p)
    const mains = v.devices.filter((x) => x.mainsPowered)
    for (const dev of mains) await install(p, dev)
    const [exempted, inspected] = mains
    const D = `${p.dep}/devices/${exempted.id}/dguv-override`
    // Who and what: the PM only; a reason; not the same as the model's default.
    for (const agent of [p.fe, p.architect, p.reviewer, p.viewer]) expectStatus(await agent.put(D).send({ required: false, reason: 'Fed by the building UPS' }), 403)
    expectStatus(await p.admin.agent.put(D).send({ required: false }), 400)
    expectStatus(await p.admin.agent.put(D).send({ required: false, reason: '   ' }), 400)
    expectStatus(await p.admin.agent.put(D).send({ required: true, reason: 'Already required' }), 400)
    const res = expectStatus(await p.admin.agent.put(D).send({ required: false, reason: 'Fed by the building UPS, inspected by the landlord' }), 200).body.device
    expect(res.dguv).toMatchObject({ exempt: true, required: false, byType: true, override: { required: false, reason: 'Fed by the building UPS, inspected by the landlord' } })
    expect(res.acceptanceBlockers.join()).not.toMatch(/DGUV/)
    expect(await col('auditentries').countDocuments({ action: 'deployment.dguv.override' })).toBe(1)
    // An exempt device takes no inspection.
    expect(expectStatus(await p.fe.put(`${p.dep}/devices/${exempted.id}/dguv`).send({ inspectionDate: localDate(new Date(), 'Europe/Berlin'), inspector: 'Elektro Meyer' }), 409).body.error.code).toBe('dguv_exempt')
    expectStatus(await p.fe.put(`${p.dep}/devices/${inspected.id}/dguv`).send({ inspectionDate: localDate(new Date(), 'Europe/Berlin'), inspector: 'Elektro Meyer' }), 200)
    // The dashboard: exempt on its own, out of the compliant share and never the worst.
    const node = (await get(p.viewer, `${p.base}/dguv`)).node
    expect(node.counts).toMatchObject({ total: mains.length, exempt: 1, valid: 1, not_inspected: mains.length - 2 })
    expect(node.compliantPct).toBe(Math.round((1 / (mains.length - 1)) * 100))
    const rows = (await get(p.viewer, `${p.base}/dguv/devices?status=exempt`)).devices
    expect(rows).toEqual([expect.objectContaining({ deviceId: exempted.id, state: 'exempt', stateLabel: 'Exempt', exemptReason: 'Fed by the building UPS, inspected by the landlord' })])
    const csv = (await p.viewer.get(`${p.base}/dguv/export.csv?status=exempt`).expect(200)).text
    expect(csv).toMatch(/Exempt reason/)
    expect(csv).toMatch(/Fed by the building UPS, inspected by the landlord/)
    // The building dashboard and the CMDB.
    expect((await get(p.viewer, `${p.base}/dashboard/buildings/${p.b001}`)).dguv).toMatchObject({ exempt: 1, total: mains.length - 1 })
    // Reminders: the uninspected ones, never the exempt one.
    await dguvReminders({ now: new Date() })
    const reminded = (await col('notifications').find({ type: { $in: ['dguv_not_inspected', 'dguv_expiry'] } }).toArray()).map((n) => n.title).join(' | ')
    expect(reminded).not.toContain(exempted.hostname ?? exempted.label)
    expect(await col('deploymentrecords').findOne({ deviceId: oid(exempted.id) })).toMatchObject({ dguv: { remindersSent: [] } })
    // The DGUV report lists it apart, with its reason.
    const doc = expectStatus(await p.admin.agent.post(`${p.base}/documents`).send({ buildingId: p.b001, typeKey: 'dguv-report', format: 'xlsx' }), 202).body.document
    await ctx.app.__documents.process()
    const book = XLSX.read((await binary(p.admin.agent.get(`${p.base}/documents/${doc.id}/download`)).expect(200)).body)
    expect(book.SheetNames).toEqual(['DGUV', 'Exempt'])
    expect(XLSX.utils.sheet_to_csv(book.Sheets.Exempt)).toMatch(/inspected by the landlord/)
    expect(XLSX.utils.sheet_to_csv(book.Sheets.DGUV)).not.toMatch(new RegExp(exempted.hostname ?? exempted.label))
    // Back to the default: inspected again.
    expectStatus(await p.admin.agent.put(D).send({ required: null }), 200)
    expect((await get(p.viewer, `${p.base}/dguv`)).node.counts.exempt).toBe(0)

    // The model sets the default: marked "not required", its devices leave DGUV…
    const item = (await col('platformcatalogueitems').findOne({ key: { $exists: true }, model: { $exists: true }, $or: [{ powerInletType: { $ne: null } }, { psuCount: { $gt: 0 } }] }))
    const ofModel = mains.filter((x) => x.model === item.model)
    expect(ofModel.length).toBeGreaterThan(0)
    {
      await col('platformcatalogueitems').updateOne({ _id: item._id }, { $set: { dguvRequired: false } })
      expect((await get(p.viewer, `${p.base}/dguv`)).node.counts.total).toBe(mains.length - ofModel.length)
      // …and one of them is required anyway, with a reason.
      expectStatus(await p.admin.agent.put(`${p.dep}/devices/${ofModel[0].id}/dguv-override`).send({ required: true, reason: 'Client asked for it' }), 200)
      expect((await get(p.viewer, `${p.base}/dguv`)).node.counts.total).toBe(mains.length - ofModel.length + 1)
    }
  }, 300000)
})

describe('Analytics (addendum v2.3 Q14–15): BOM accuracy against the as-installed; BOM revision count apart', () => {
  it('a building deployed as designed is 100% accurate; a missing installed cable lowers it; one approval is no revision; a building still installing is counted apart', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    let a = (await get(p.admin.agent, `${p.base}/analytics`)).metrics
    // Approved BOM, deployment not finished: counted as still installing.
    expect(a.bomAccuracy).toMatchObject({ count: 0, inProgress: 1, noApprovedBom: 2 })
    expect(a.bomRevisions).toMatchObject({ count: 1, totalRevisions: 0, buildings: [{ code: 'B001', versions: 1, revisions: 0, changePct: 0 }] })
    await acceptEverything(p)
    a = (await get(p.admin.agent, `${p.base}/analytics`)).metrics
    expect(a.bomAccuracy).toMatchObject({ count: 1, inProgress: 0, avgAccuracyPct: 100, excluded: 0 })
    const b = a.bomAccuracy.buildings[0]
    expect(b).toMatchObject({ code: 'B001', accuracyPct: 100, variancePct: 0 })
    expect(b.devices.installed).toBe(b.devices.approved)
    expect(b.cables.installed).toBe(b.cables.approved)
    expect(b.devices.approved).toBeGreaterThan(0)
    expect(b.notComparable).toBeGreaterThan(0)
    expect(a.bomAccuracy.trend).toEqual([expect.objectContaining({ period: localDate(new Date(), 'Europe/Berlin').slice(0, 7), value: 100 })])
    // One cable fewer recorded on site: less accurate.
    const rec = await col('connectionrecords').findOne({ buildingId: oid(p.b001), 'installed.segments.1': { $exists: true } })
    await col('connectionrecords').updateOne({ _id: rec._id }, { $pop: { 'installed.segments': 1 } })
    a = (await get(p.admin.agent, `${p.base}/analytics`)).metrics
    expect(a.bomAccuracy.buildings[0].cables.installed).toBe(b.cables.installed - 1)
    expect(a.bomAccuracy.buildings[0].accuracyPct).toBeLessThan(100)
  }, 300000)
})

describe('SLA escalation contact (addendum v2.3 Q12)', () => {
  it('a breached SLA goes to the PMs, the Org Admins and the project escalation contact; unset, the Org Admins alone; the contact must be a member', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    const S = `${p.base}/schedule`
    const ids = { admin: p.admin.userId, architect: await me(p.architect), fe: await me(p.fe) }
    const today = localDate(new Date(), 'Europe/Berlin')
    expectStatus(await p.admin.agent.post(`${S}/slas`).send({ name: 'Survey contract', phaseKey: 'hld', startDate: addDays(today, -30), dueDate: addDays(today, -1) }), 201)
    // Who may set it, and whom.
    for (const agent of [p.architect, p.viewer, p.fe]) expectStatus(await agent.put(`${S}/settings`).send({ escalationContactId: ids.architect }), 403)
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    expectStatus(await p.admin.agent.put(`${S}/settings`).send({ escalationContactId: other.userId }), 400)
    expectStatus(await p.admin.agent.put(`${S}/settings`).send({ escalationContactId: new mongoose.Types.ObjectId().toString() }), 400)
    expectStatus(await p.admin.agent.put(`${S}/settings`).send({ escalationContactId: ids.architect }), 200)
    expect((await get(p.viewer, S)).settings).toMatchObject({ escalationContactId: ids.architect, escalationContactName: 'architect' })
    expect(await col('auditentries').countDocuments({ action: 'schedule.settings.updated' })).toBe(1)
    const morning = (() => {
      const start = startOfLocalDay(today, 'Europe/Berlin').getTime()
      for (let k = 0; k < 26 * 60; k++) if (localTime(new Date(start + k * 60000), 'Europe/Berlin') === '07:00') return new Date(start + k * 60000)
    })()
    expect((await scheduleAlerts({ now: morning, forEachProject })).slaBreached).toBe(1)
    const to = (await col('notifications').find({ type: 'sla_breached' }).toArray()).map((n) => String(n.recipientId)).sort()
    expect(to).toEqual([ids.admin, ids.architect].sort())
    // Unset: the PMs and Org Admins only.
    expectStatus(await p.admin.agent.put(`${S}/settings`).send({ escalationContactId: null }), 200)
    await col('notifications').deleteMany({})
    await col('slas').updateMany({}, { $set: { breachedNotifiedAt: null } })
    await scheduleAlerts({ now: morning, forEachProject })
    expect((await col('notifications').find({ type: 'sla_breached' }).toArray()).map((n) => String(n.recipientId))).toEqual([ids.admin])
  }, 240000)
})

describe('Save-time port conflict check (addendum v2.3 Q2): "this port was changed by [user], reload"', () => {
  it('Deployment: two Field Engineers patch the same link — the second save is refused naming the first and the port; at once, exactly one wins; a port another link holds is refused', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    p.fe2 = await projectMember(ctx, p.admin, { email: 'fe2@example.com', role: 'field_engineer', projectId: p.projectId })
    await col('users').updateOne({ email: 'fe2@example.com' }, { $set: { name: 'Fritz Second' } })
    await col('users').updateOne({ email: 'fe@example.com' }, { $set: { name: 'Fiona First' } })
    let v = await deliverAll(p)
    for (const dev of v.devices) await install(p, dev)
    v = await depView(p.fe, p)
    const [c1, c2] = v.connections
    const seg = (c, m) => c.segments.map((s) => ({ index: s.index, cableId: s.cableId, installedM: m }))
    const url = (c) => `${p.dep}/connections/${c.id}/installation`
    expect(c1.version).toBe(0)
    // Both loaded version 0; the first saves, the second is refused, named.
    expectStatus(await p.fe.put(url(c1)).send({ segments: seg(c1, 3), version: 0 }), 200)
    const refused = expectStatus(await p.fe2.put(url(c1)).send({ segments: seg(c1, 9), version: 0 }), 409).body.error
    expect(refused.code).toBe('port_changed')
    expect(refused.message).toMatch(new RegExp(`^Port ${c1.source.portId} on ${c1.source.name} \\(to ${c1.dest.portId} on ${c1.dest.name}\\) was changed by Fiona First since you loaded it — reload`))
    // Nothing of the refused save was written.
    expect((await depView(p.fe, p)).connections.find((c) => c.id === c1.id).segments[0].installed.installedM).toBe(3)
    // Reloaded, it saves.
    const reloaded = (await depView(p.fe2, p)).connections.find((c) => c.id === c1.id)
    expect(reloaded).toMatchObject({ version: 1, changedBy: 'Fiona First' })
    expectStatus(await p.fe2.put(url(c1)).send({ segments: seg(c1, 9), version: 1 }), 200)
    // Two saves of the same version at once: one wins, one is refused.
    const both = await Promise.all([p.fe.put(url(c2)).send({ segments: seg(c2, 4), version: 0 }), p.fe2.put(url(c2)).send({ segments: seg(c2, 5), version: 0 })])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])
    expect(both.find((r) => r.status === 409).body.error.code).toBe('port_changed')
    // Patching another link onto a port the first one holds: refused, named.
    const v2 = await depView(p.fe, p)
    const other = v2.connections.find((c) => c.id !== c1.id && c.source.deviceId === c1.source.deviceId) ?? v2.connections.find((c) => c.id !== c1.id && c.dest.deviceId === c1.source.deviceId)
    expect(other).toBeTruthy()
    {
      const end = other.source.deviceId === c1.source.deviceId ? 'sourcePort' : 'destPort'
      const clash = expectStatus(await p.fe.put(url(other)).send({ [end]: c1.source.portId, version: other.version }), 409).body.error
      expect(clash.code).toBe('port_in_use')
      expect(clash.message).toMatch(new RegExp(`^Port ${c1.source.portId} on ${c1.source.name} is already patched`))
    }
    // The version is required.
    expectStatus(await p.fe.put(url(c1)).send({ segments: seg(c1, 9) }), 400)
  }, 300000)

  it('LLD and HLD: a stale save on a port someone changed names the port and who; a stale save elsewhere is still refused', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    const arch2 = await projectMember(ctx, p.admin, { email: 'architect2@example.com', role: 'architect', projectId: p.projectId })
    await col('users').updateOne({ email: 'architect@example.com' }, { $set: { name: 'Ada Architect' } })
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const view = async () => (await get(p.architect, `${p.lld}/buildings/${p.b001}`))
    let v = await view()
    const role = (r) => v.devices.find((x) => x.inDesign && x.role === r)
    const link = (a, b) => v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [role(a).id, role(b).id].sort().join())
    const bf = link('border', 'fusion')
    const be = link('border', 'edge')
    const r = v.design.revision
    // Ada sets the Border's port on the Border–Fusion link; the other architect still has revision r.
    expectStatus(await p.architect.patch(`${p.lld}/connections/${bf.id}`).send({ source: { deviceId: bf.source.deviceId, portId: 'Te1/1/1' }, dest: { deviceId: bf.dest.deviceId, portId: 'Te1/1/1' }, baseRevision: r }), 200)
    const same = expectStatus(await arch2.patch(`${p.lld}/connections/${bf.id}`).send({ source: { deviceId: bf.source.deviceId, portId: 'Te1/1/2' }, baseRevision: r }), 409).body.error
    expect(same.code).toBe('port_changed')
    expect(same.message).toMatch(/^Port Te1\/1\/1 on .+ was changed by Ada Architect since you loaded it — reload/)
    // Asking for the port Ada just took, on another link: named too.
    const taken = expectStatus(await arch2.patch(`${p.lld}/connections/${be.id}`).send({ [be.source.deviceId === bf.source.deviceId ? 'source' : 'dest']: { deviceId: bf.source.deviceId, portId: 'Te1/1/1' }, baseRevision: r }), 409).body.error
    expect(taken.code).toBe('port_changed')
    expect(taken.message).toMatch(/Te1\/1\/1 .* was changed by Ada Architect/)
    // A stale save that touches no changed port: still refused (the design changed), naming Ada.
    const elsewhere = expectStatus(await arch2.patch(`${p.lld}/connections/${be.id}`).send({ engineerSelectedM: 30, baseRevision: r }), 409).body.error
    expect(elsewhere.code).toBe('stale_revision')
    expect(elsewhere.message).toMatch(/changed by Ada Architect/)
    // Deleting a link Ada changed since: named.
    expect(expectStatus(await arch2.delete(`${p.lld}/connections/${bf.id}?baseRevision=${r}`), 409).body.error.code).toBe('port_changed')
  }, 300000)

  it('HLD: the same on an uplink — the port and who changed it named', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    const arch2 = await projectMember(ctx, p.admin, { email: 'architect2@example.com', role: 'architect', projectId: p.projectId })
    await col('users').updateOne({ email: 'architect@example.com' }, { $set: { name: 'Ada Architect' } })
    let h = await get(p.architect, `${p.hld}/buildings/${p.b001}`)
    await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: h.design.revision }).expect(201)
    h = await get(p.architect, `${p.hld}/buildings/${p.b001}`)
    const role = (r) => h.devices.find((x) => x.origin === 'planned' && x.role === r)
    const up = h.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [role('border').id, role('fusion').id].sort().join())
    const r = h.design.revision
    expectStatus(await p.architect.patch(`${p.hld}/uplinks/${up.id}`).send({ source: { deviceId: up.source.deviceId, portId: 'Te1/1/1' }, baseRevision: r }), 200)
    const err = expectStatus(await arch2.patch(`${p.hld}/uplinks/${up.id}`).send({ source: { deviceId: up.source.deviceId, portId: 'Te1/1/2' }, baseRevision: r }), 409).body.error
    expect(err.code).toBe('port_changed')
    expect(err.message).toMatch(/^Port Te1\/1\/1 on .+ was changed by Ada Architect since you loaded it — reload/)
    // Not a port change: the generic refusal, still naming who changed the design.
    const other = h.connections.find((c) => c.id !== up.id)
    const generic = expectStatus(await arch2.patch(`${p.hld}/uplinks/${other.id}`).send({ speed: other.speed, baseRevision: r }), 409).body.error
    expect(generic.code).toBe('stale_revision')
    expect(generic.message).toMatch(/changed by Ada Architect/)
  }, 240000)
})
