import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin } from './helpers/app.js'
import { approvedLld } from './helpers/lld.js'
import { hldView } from './helpers/hld.js'
import { spView, bomView, readyPackage, submitPackage, clientDecides, decision, PNG, ADDRESSING } from './helpers/m5a.js'
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
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const pub = (ctx, token, path = '') => `/api/v1/public/share-links/${token}${path}`

// An approved LLD whose package is ready, sent to the client.
async function sent(ctx = t()) {
  const d = await approvedLld(ctx)
  await readyPackage(d.p)
  const link = await submitPackage(d.p)
  return { ctx, d, p: d.p, link }
}
// …and approved by the client: HLD and LLD frozen, procurement unlocked.
async function approvedPackage() {
  const s = await sent()
  expectStatus(await clientDecides(s.ctx, s.link), 200)
  return s
}

describe('Draft BOM from the approved HLD + LLD (brief §5.6)', () => {
  it('lines with source tag and reason; serialised per device; reconciled; Draft until the package is approved; prices only for those who may see them', async () => {
    const ctx = t()
    const d = await approvedLld(ctx)
    const { p } = d
    const bom = await bomView(p.admin.agent, p)
    expect(bom).toMatchObject({ stage: 'lld', status: 'in_progress', subLabel: 'Draft', currency: 'EUR', showPrices: true })
    const serial = bom.lines.filter((l) => l.lineType === 'serialised')
    expect(serial.map((l) => l.item).sort()).toEqual(['C9300-48UX', 'C9500', 'C9500', 'Catalyst 9130AXI'])
    expect(serial.every((l) => l.qty === 1 && l.source === 'HLD' && l.basis)).toBe(true)
    expect(bom.lines.find((l) => l.key === 'optic:cisco sfp-10g-lr')).toMatchObject({ qty: 2, source: 'HLD', unitPriceMinor: 18000 })
    expect(bom.lines.find((l) => l.key === 'cable:os2:50')).toMatchObject({ qty: 1, source: 'LLD', spec: '50 m' })
    expect(bom.lines.find((l) => l.key.startsWith('cord:'))).toMatchObject({ key: 'cord:schuko/c13', qty: 6 })
    expect(bom.reconciliation).toMatchObject({ reconciled: true, realCount: 4, bomCount: 4 })
    expect(bom.pricing).toMatchObject({ marginPercent: 15 })
    expect(bom.pricing.sellMinor).toBe(Math.round(bom.pricing.costMinor * 1.15))
    expect(bom.unpricedCount).toBe(3)
    expect(bom.lines.filter((l) => !l.priced).map((l) => l.priceNote).sort()).toEqual(['Length pending — priced once both ends are placed', 'Not priced in the catalogue', 'Not priced in the catalogue'])
    // The Architect (setting off), Field Engineer and Viewer read it without prices.
    for (const agent of [p.architect, p.fe, p.viewer]) {
      const hidden = await bomView(agent, p)
      expect(hidden.showPrices).toBe(false)
      expect(hidden.pricing).toBeNull()
      expect(hidden.lines.some((l) => 'unitPriceMinor' in l || 'lineTotalMinor' in l)).toBe(false)
      // Nor whether a line has a price (M7b-1): no flag, note, currency, count or "Not priced" status.
      expect(hidden.lines.some((l) => ['priced', 'priceNote', 'currency'].some((k) => k in l) || l.status === 'Not priced')).toBe(false)
      expect(hidden).toMatchObject({ currency: null, unpricedCount: null })
      expect(hidden.calc.some((c) => /priced/i.test(c))).toBe(false)
      expect(hidden.lines.find((l) => l.key === 'cable:os2:50').status).toBe('Calculated')
    }
    // …until the Org Admin lets Architects see prices.
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ architectsSeePrices: true }).expect(200)
    expect((await bomView(p.architect, p)).showPrices).toBe(true)
    // Scope and isolation.
    await p.feB001.get(`${p.base}/bom/buildings/${p.building('B002').id}`).expect(404)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.base}/bom/buildings/${p.b001}`).expect(404)
    await outsider.agent.get(`${p.base}/solution-package/buildings/${p.b001}`).expect(404)
    // Procurement is locked before the client approves the package.
    expect(bom.procurement).toMatchObject({ unlocked: false, spApproved: false, bomApproved: false })
    expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 409)
    expectStatus(await p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: serial[0].key, status: 'quotation_requested', version: 0 }), 409)
  })

  it('PM commercial standards: margin, Bill of Resources minutes and a customer cord standard change the numbers', async () => {
    const { p } = await approvedLld(t())
    await p.architect.patch(`${p.base}/commercial-settings`).send({ marginPercent: 30 }).expect(403)
    await p.admin.agent.patch(`${p.base}/commercial-settings`).send({ resourceMinutes: { 'not-a-task': 5 } }).expect(400)
    const before = await spView(p.admin.agent, p)
    const res = expectStatus(await p.admin.agent.patch(`${p.base}/commercial-settings`).send({ marginPercent: 30, resourceMinutes: { 'patch-fibre': 60 }, powerCordStandard: { label: '2 m C13/C14 black', connectorPair: 'C13/C14' } }), 200)
    expect(res.body.settings).toMatchObject({ marginPercent: 30, resourceMinutes: { 'patch-fibre': 60, 'patch-copper': 10 } })
    const bom = await bomView(p.admin.agent, p)
    expect(bom.pricing.sellMinor).toBe(Math.round(bom.pricing.costMinor * 1.3))
    expect(bom.lines.filter((l) => l.key.startsWith('cord:')).map((l) => [l.key, l.qty])).toEqual([['cord:c13/c14', 6]])
    // Two fibre links × 40 extra minutes.
    expect((await spView(p.admin.agent, p)).resourceEstimate.totalMinutes - before.resourceEstimate.totalMinutes).toBe(80)
  })

  it('power cords: a surveyed PDU socket type (C13) decides the cords of the devices in that rack; the rest use the country table', async () => {
    const { p } = await approvedLld(t())
    expectStatus(await p.fe.patch(`${p.base}/survey/racks/${p.racks[0].id}/facts`).send({ mountingPower: { cageNutType: 'M5', pduA: { totalSockets: 24, freeSockets: 20, socketType: 'C13' } } }), 200)
    await p.fe.patch(`${p.base}/survey/racks/${p.racks[0].id}/facts`).send({ mountingPower: { pduA: { totalSockets: 24, freeSockets: 20, socketType: 'C20' } } }).expect(400)
    const bom = await bomView(p.admin.agent, p)
    // Border and Fusion (main rack, 2 PSUs each): C13/C14 from the PDU, tagged Survey; the Edge: Schuko.
    expect(bom.lines.filter((l) => l.key.startsWith('cord:')).map((l) => [l.key, l.qty, l.source])).toEqual([
      ['cord:c13/c14', 4, 'Survey'],
      ['cord:schuko/c13', 2, 'HLD'],
    ])
    // Cage nuts follow the surveyed type per rack: 2 RU per rack × 4 per RU
    // on the front face (the organisation default).
    expect(bom.lines.filter((l) => l.key.startsWith('cage:')).map((l) => [l.key, l.qty])).toEqual([
      ['cage:m5', 8],
      ['cage:m6', 8],
    ])
  })
})

describe('Solution Package: Required Inputs, validation and readiness (brief §5.5)', () => {
  it('18 sections, 12 groups; group 1 checks CIDR/VLAN/overlap; owners are members; stale saves refused; warnings accepted with who; submit only when ready', async () => {
    const { p } = await approvedLld(t())
    let sp = await spView(p.architect, p)
    expect(sp.sections).toHaveLength(18)
    expect(sp.groups).toHaveLength(12)
    expect(sp).toMatchObject({ status: 'not_started', readyForSubmission: false })
    const put = (agent, key, body, revision) => agent.put(`${p.base}/solution-package/groups/${key}`).send({ buildingId: p.b001, ...body, baseRevision: revision })
    await put(p.fe, 'addressing', { addressingEntries: ADDRESSING }, 0).expect(403)
    // Overlapping subnets: the group stays in progress.
    expectStatus(await put(p.architect, 'addressing', { addressingEntries: [...ADDRESSING, { id: 'a2', label: 'Voice', vlanId: 20, cidr: '10.10.0.128/25', gateway: '' }] }, 0), 200)
    sp = await spView(p.architect, p)
    expect(sp.groups[0]).toMatchObject({ key: 'addressing', status: 'in_progress', entryCount: 2 })
    expect(sp.status).toBe('in_progress')
    expectStatus(await put(p.architect, 'addressing', { addressingEntries: ADDRESSING }, 0), 409) // stale
    expectStatus(await put(p.architect, 'addressing', { addressingEntries: ADDRESSING, ownerId: String(new mongoose.Types.ObjectId()) }, sp.revision), 400)
    const architectId = sp.members.find((m) => m.role === 'architect').id
    expectStatus(await put(p.architect, 'addressing', { addressingEntries: ADDRESSING, ownerId: architectId, dueDate: '2026-11-30' }, sp.revision), 200)
    sp = await spView(p.architect, p)
    expect(sp.groups[0]).toMatchObject({ status: 'complete', ownerName: 'architect', dueDate: '2026-11-30' })
    expectStatus(await put(p.architect, 'routing', { addressingEntries: ADDRESSING }, sp.revision), 400)
    // Not ready: the PM cannot send it yet, and says why.
    const notReady = expectStatus(await p.admin.agent.post(`${p.base}/solution-package/submit`).send({ buildingId: p.b001 }), 409)
    expect(notReady.body.error.details.blockers[0]).toBe('11 required input group(s) are not complete')
    const ready = await readyPackage(p)
    expect(ready).toMatchObject({ readyForSubmission: true, blockers: [], allComplete: true })
    expect(ready.acceptedWarnings.map((w) => w.acceptedBy)).toContain('Owner (PM)')
    expect(ready.validationAreas.filter((a) => a.result === 'accepted').length).toBe(ready.acceptedWarnings.length)
    // A passing area has nothing to accept.
    expectStatus(await p.admin.agent.post(`${p.base}/solution-package/accept-warning`).send({ buildingId: p.b001, areaKey: 'source-data', baseRevision: ready.revision }), 409)
    // Only the PM sends it to the client.
    await p.architect.post(`${p.base}/solution-package/submit`).send({ buildingId: p.b001 }).expect(403)
    await p.admin.agent.post(`${p.base}/solution-package/submit`).send({ buildingId: p.b001, expiryDays: 31 }).expect(400)
    const link = await submitPackage(p)
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(link.password).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(link.generatedPassword).toBe(true)
    sp = await spView(p.admin.agent, p)
    expect(sp).toMatchObject({ state: 'awaiting_client', status: 'awaiting_approval', approvals: [{ status: 'pending', versionNumber: 1 }] })
    expect(sp.shareLinks[0]).toMatchObject({ status: 'active' })
    expect(Math.round((new Date(link.expiresAt) - Date.now()) / 86400000)).toBe(14)
    // Locked while the client decides.
    expectStatus(await put(p.architect, 'routing', { kvPairs: [] }, sp.revision), 409)
  })
})

describe('Share links: hashed secrets, expiry, brute-force lock, extend and revoke', () => {
  it('only the token hash and an argon2id password hash are stored; the token alone reveals nothing', async () => {
    const { ctx, link } = await sent()
    const rows = await col('sharelinks').find({}).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).toBe(crypto.createHash('sha256').update(link.token).digest('hex'))
    expect(rows[0].passwordHash).toMatch(/^\$argon2id\$/)
    const stored = JSON.stringify(await col('sharelinks').find({}).toArray()) + JSON.stringify(await col('sharelinkindexes').find({}).toArray()) + JSON.stringify(await col('auditentries').find({}).toArray())
    expect(stored).not.toContain(link.token)
    expect(stored).not.toContain(link.password)
    expect((await ctx.agent().get(pub(ctx, link.token)).expect(200)).body).toEqual({ status: 'active', kind: 'solution_package', kindLabel: 'Solution Package', passwordRequired: true })
    await ctx.agent().get(pub(ctx, 'x'.repeat(43))).expect(404)
    // Regression: the project was looked up organisation-wide. Put another
    // project of the same organisation first in natural order (re-inserting
    // the package's own project after it): the page must still name its own.
    const own = await col('projects').findOne({ code: 'SRV' })
    await col('projects').insertOne({ ...own, _id: new mongoose.Types.ObjectId(), name: 'Another project', code: 'AAA' })
    await col('projects').deleteOne({ _id: own._id })
    await col('projects').insertOne(own)
    const view = (await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: link.password }).expect(200)).body
    expect(view).toMatchObject({ kind: 'solution_package', versionNumber: 1, building: { code: 'B001' }, project: { name: 'Survey', code: 'SRV' }, package: { packageCompleteness: expect.any(Number) } })
    expect(view.package.sections).toHaveLength(18)
    expect(JSON.stringify(view)).not.toMatch(/PriceMinor/)
  })

  it('five wrong passwords lock the link for 15 minutes, even for the right password', async () => {
    const { ctx, link } = await sent()
    for (let i = 4; i >= 1; i--) {
      const res = await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: 'wrong-password' }).expect(401)
      expect(res.body.error.message).toBe(`Incorrect password (${i} attempt(s) left before the link locks).`)
    }
    expect((await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: 'wrong-password' }).expect(429)).body.error.code).toBe('link_locked')
    expect((await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: link.password }).expect(429)).body.error.code).toBe('link_locked')
    await clientDecides(ctx, link).expect(429)
    await col('sharelinks').updateMany({}, { $set: { lockedUntil: new Date(Date.now() - 1000) } })
    await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: link.password }).expect(200)
  })

  it('expiry is checked when the decision is submitted (the approval stays pending); the PM extends or revokes', async () => {
    const { ctx, p, link } = await sent()
    await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: link.password }).expect(200)
    await col('sharelinks').updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await clientDecides(ctx, link).expect(410)
    expect(expired.body.error).toMatchObject({ code: 'link_expired' })
    expect(expired.body.error.message).toMatch(/expired before your decision was submitted — nothing was recorded/)
    let sp = await spView(p.admin.agent, p)
    expect(sp.approvals[0].status).toBe('pending')
    expect(sp.shareLinks[0].status).toBe('expired')
    // Extend (PM only, 1–30 days).
    const linkId = sp.shareLinks[0].id
    await p.architect.post(`${p.base}/share-links/${linkId}/extend`).send({ days: 3 }).expect(403)
    await p.admin.agent.post(`${p.base}/share-links/${linkId}/extend`).send({ days: 31 }).expect(400)
    await p.admin.agent.post(`${p.base}/share-links/${linkId}/extend`).send({ days: 3 }).expect(200)
    sp = await spView(p.admin.agent, p)
    expect(sp.shareLinks[0]).toMatchObject({ status: 'active', extensions: [{ extendedBy: 'Owner' }] })
    // Revoke: the link is dead and the package is editable again.
    await p.admin.agent.post(`${p.base}/share-links/${linkId}/revoke`).expect(200)
    expect((await clientDecides(ctx, link).expect(410)).body.error.code).toBe('link_revoked')
    sp = await spView(p.admin.agent, p)
    expect(sp).toMatchObject({ state: 'draft', approvals: [{ status: 'expired' }] })
    // A fresh link with a PM-chosen password.
    const again = await submitPackage(p, { password: 'Client-Secret-42', expiryDays: 2 })
    expect(again).toMatchObject({ password: 'Client-Secret-42', generatedPassword: false })
  })
})

describe('Client approval and freeze (brief §5.5)', () => {
  it('approve: name, role, comments, acceptance and a signature recorded on the approval and in the audit; HLD and LLD frozen; procurement unlocked; the link is single-use', async () => {
    const { ctx, p, d, link } = await sent()
    // Acceptance is required; a change request needs a comment.
    await ctx.agent().post(pub(ctx, link.token, '/decision')).send({ password: link.password, ...decision({ termsAccepted: false }) }).expect(400)
    await clientDecides(ctx, link, { decision: 'changes_requested' }).expect(400)
    const res = expectStatus(await clientDecides(ctx, link, { comments: 'Looks good', signature: PNG }), 200)
    expect(res.body).toMatchObject({ decision: 'approved', frozen: true })
    const approval = await col('approvals').findOne({ gate: 'sp_client' })
    expect(approval).toMatchObject({ status: 'approved', client: { name: 'Clara Client', role: 'IT Director' }, decision: { value: 'approved', comments: 'Looks good', termsAccepted: true, decidedByRole: 'client' } })
    expect(String(approval.client.shareLinkId)).toBe(String((await col('sharelinks').findOne({}))._id))
    const signature = await col('files').findOne({ _id: approval.decision.signatureFileId })
    expect(signature).toMatchObject({ category: 'signature', mimeType: 'image/png', attachedTo: { type: 'approval' } })
    const audit = await col('auditentries').findOne({ action: 'solution_package.client_approved' })
    expect(audit).toMatchObject({ changeType: 'client_decision', source: 'client_link', actor: { type: 'client_link', clientName: 'Clara Client', clientRole: 'IT Director' } })
    expect(String(audit.actor.shareLinkId)).toBe(String(approval.client.shareLinkId))
    // Single use.
    expect((await clientDecides(ctx, link).expect(409)).body.error.code).toBe('already_decided')
    // Package approved and frozen; phases updated.
    const sp = await spView(p.admin.agent, p)
    expect(sp).toMatchObject({ state: 'approved', status: 'approved', versions: [{ number: 1, frozen: true }] })
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'solution-package').status).toBe('approved')
    expect(dash.phases.find((x) => x.phaseKey === 'bom')).toMatchObject({ status: 'in_progress', subLabel: null })
    // HLD and LLD refuse direct changes.
    const bf = await d.link('border', 'fusion')
    expect((await d.save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'NOPE' })).body.error.code).toBe('change_request_required')
    expect((await d.save('post', `${p.lld}/branches`, { buildingId: p.b001, name: 'x' })).status).toBe(409)
    const edge = await d.device('edge')
    expect((await d.save('post', `${p.lld}/rename`, { buildingId: p.b001, renames: [{ deviceId: edge.id, hostname: 'E-NEW' }] })).body.error.code).toBe('change_request_required')
    const hld = await hldView(p.architect, p)
    expect((await p.architect.patch(`${p.hld}/devices/${hld.devices[0].id}`).send({ psuConfigured: 1, baseRevision: hld.design.revision })).body.error.code).toBe('change_request_required')
    // Procurement unlocks once the PM approves the procurement BOM.
    expect((await bomView(p.admin.agent, p)).procurement).toMatchObject({ spApproved: true, bomApproved: false, unlocked: false })
  })

  it('two decisions racing on one link: exactly one is recorded', async () => {
    const { ctx, link } = await sent()
    const results = await Promise.all([clientDecides(ctx, link), clientDecides(ctx, link, { decision: 'rejected', comments: 'No' })])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await col('approvals').countDocuments({ gate: 'sp_client', status: { $ne: 'pending' } })).toBe(1)
  })

  it('request changes returns the LLD to In progress; reject too; nothing is frozen', async () => {
    const { ctx, p, d, link } = await sent()
    expectStatus(await clientDecides(ctx, link, { decision: 'changes_requested', comments: 'Add a second uplink' }), 200)
    let sp = await spView(p.admin.agent, p)
    expect(sp).toMatchObject({ state: 'changes_requested', status: 'changes_requested', approvals: [{ status: 'changes_requested', decision: { comments: 'Add a second uplink' } }] })
    expect((await d.view()).status).toBe('in_progress')
    const bf = await d.link('border', 'fusion')
    expectStatus(await d.save('patch', `${p.lld}/connections/${bf.id}`, { cableId: 'C-BF-2' }), 200)
    // Rejected the second time (after the LLD is approved again).
    expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
    await p.reviewer.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
    sp = await spView(p.admin.agent, p)
    const second = await submitPackage(p)
    expectStatus(await clientDecides(ctx, second, { decision: 'rejected', comments: 'Out of budget' }), 200)
    expect((await spView(p.admin.agent, p)).state).toBe('rejected')
    expect((await d.view()).status).toBe('in_progress')
    expect(await col('llddesigns').countDocuments({ frozen: true })).toBe(0)
  })
})

describe('Procurement after approval (brief §5.6)', () => {
  it('the PM approves the procurement BOM; statuses move through validated transitions, audited; stale edits refused', async () => {
    const { p } = await approvedPackage()
    await p.architect.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }).expect(403)
    await p.fe.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }).expect(403)
    expect(expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 201).body.versionNumber).toBe(1)
    expect(expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 409).body.error.code).toBe('already_approved')
    let bom = await bomView(p.admin.agent, p)
    expect(bom).toMatchObject({ status: 'approved', subLabel: null, procurement: { unlocked: true, bomApproved: true, approvedBy: 'Owner', approvedVersionNumber: 1 } })
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'bom').status).toBe('approved')
    const line = bom.lines.find((l) => l.lineType === 'serialised')
    const patch = (body) => p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: line.key, ...body })
    await p.architect.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey: line.key, status: 'quoted', version: 0 }).expect(403)
    expect((await patch({ status: 'shipped', version: 0 }).expect(400)).body.error.message).toBe('Not ordered cannot move to Shipped — next: Quotation requested or Ordered')
    await patch({ status: 'quotation_requested', vendor: 'SERVON', expectedDelivery: '2026-11-15', version: 0 }).expect(200)
    await patch({ status: 'quoted', version: 0 }).expect(409) // stale
    await patch({ status: 'quoted', version: 1 }).expect(200)
    expect((await patch({ status: 'ordered', version: 2 }).expect(400)).body.error.message).toBe('An ordered line needs a PO number')
    await patch({ status: 'ordered', poNumber: 'PO-4711', version: 2 }).expect(200)
    await patch({ status: 'quoted', version: 3 }).expect(400) // never back after ordering
    await patch({ status: 'shipped', version: 3 }).expect(200)
    expect((await patch({ status: 'delivered', version: 4 }).expect(400)).body.error.message).toBe('A delivered line needs the actual delivery date')
    await patch({ status: 'delivered', actualDelivery: '2026-11-14', version: 4 }).expect(200)
    bom = await bomView(p.admin.agent, p)
    expect(bom.lines.find((l) => l.key === line.key).procurement).toMatchObject({ status: 'delivered', vendor: 'SERVON', poNumber: 'PO-4711', expectedDelivery: '2026-11-15', actualDelivery: '2026-11-14', version: 5, updatedBy: 'Owner', next: [] })
    const audit = await col('auditentries').find({ action: 'procurement.line.updated' }).toArray()
    expect(audit).toHaveLength(5)
    expect(audit.flatMap((a) => a.changes).filter((c) => c.field === 'status').map((c) => c.after)).toEqual(['quotation_requested', 'quoted', 'ordered', 'shipped', 'delivered'])
  })
})

describe('Change requests after the freeze (brief §5.5)', () => {
  it('a CR changes a cable on its branch, shows the design diff and BOM impact, and the client approval applies it to the frozen LLD (new frozen version); the BOM then needs re-approval', async () => {
    const { ctx, p, d } = await approvedPackage()
    const hldVersions = (await hldView(p.architect, p)).versions.map((v) => v.id)
    expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 201)
    await p.admin.agent.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'x' }).expect(403)
    const created = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Longer trunk to TR-EG-02', reason: 'Cable route changed', description: 'Re-route C-BE-1' }), 201).body.changeRequest
    expect(created).toMatchObject({ number: 1, status: 'draft' })
    // Nothing changed yet: submitting is refused.
    expect((await p.architect.post(`${p.base}/change-requests/${created.id}/submit`).expect(409)).body.error.code).toBe('no_change')
    // Edit the cable on the CR's branch (the frozen main LLD stays as it is).
    const be = await d.link('border', 'edge', created.branchId)
    expectStatus(await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 75 }, { branchId: created.branchId }), 200)
    expect((await d.link('border', 'edge')).lengths.engineerSelectedM).toBeNull()
    // A hostname rename after approval goes through the CR's branch.
    const edge = await d.device('edge', created.branchId)
    expectStatus(await d.save('post', `${p.lld}/rename`, { buildingId: p.b001, branchId: created.branchId, renames: [{ deviceId: edge.id, hostname: 'E-DE-ERL-C01-B001-EG-009' }] }, { branchId: created.branchId }), 200)
    let cr = (await p.viewer.get(`${p.base}/change-requests/${created.id}`).expect(200)).body.changeRequest
    expect(cr.impact.design.connections.changed.map((c) => c.fields.map((f) => f.field))).toEqual([['engineerSelectedM']])
    expect(cr.impact.design.devices.changed[0].fields).toEqual([{ field: 'hostname', before: 'E-DE-ERL-C01-B001-EG-001', after: 'E-DE-ERL-C01-B001-EG-009' }])
    expect(cr.impact.bom.lines.map((l) => [l.key, l.before, l.after, l.change]).sort()).toEqual([
      ['cable:os2:50', 1, 0, 'removed'],
      ['cable:os2:75', 0, 1, 'added'],
    ])
    await p.architect.patch(`${p.base}/change-requests/${created.id}`).send({ affectedItems: ['C-BE-1', 'E-DE-ERL-C01-B001-EG-001'] }).expect(200)
    expectStatus(await p.architect.post(`${p.base}/change-requests/${created.id}/submit`), 200)
    // Submitted: its design is locked; the PM sends it to the client.
    expect((await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 90 }, { branchId: created.branchId })).body.error.code).toBe('change_request_locked')
    await p.architect.post(`${p.base}/change-requests/${created.id}/send`).send({}).expect(403)
    const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${created.id}/send`).send({}), 201).body.shareLink
    const view = (await ctx.agent().post(pub(ctx, link.token, '/view')).send({ password: link.password }).expect(200)).body
    expect(view).toMatchObject({ kind: 'change_request', changeRequest: { number: 1, title: 'Longer trunk to TR-EG-02', affectedItems: ['C-BE-1', 'E-DE-ERL-C01-B001-EG-001'] } })
    expectStatus(await clientDecides(ctx, link, { comments: 'Approved' }), 200)
    cr = (await p.admin.agent.get(`${p.base}/change-requests/${created.id}`).expect(200)).body.changeRequest
    expect(cr).toMatchObject({ status: 'approved', approvals: [{ status: 'approved', client: { name: 'Clara Client' } }] })
    // Applied to the frozen LLD: a new approved, frozen version; still frozen.
    const lldView = await d.view()
    expect((await d.link('border', 'edge')).lengths.engineerSelectedM).toBe(75)
    expect((await d.device('edge')).hostname).toBe('E-DE-ERL-C01-B001-EG-009')
    expect(lldView).toMatchObject({ frozen: true, status: 'approved' })
    expect(lldView.versions[0]).toMatchObject({ label: 'CR-1 Longer trunk to TR-EG-02', frozen: true })
    // An LLD-only change leaves the HLD's versions as they were (M5a review).
    expect((await hldView(p.architect, p)).versions.map((v) => v.id)).toEqual(hldVersions)
    expect((await p.admin.agent.get(`${p.base}/change-requests/${created.id}`).expect(200)).body.changeRequest.resultingHldVersionId).toBeNull()
    // The BOM changed since its approval: listed, and the PM re-approves.
    const bom = await bomView(p.admin.agent, p)
    expect(bom).toMatchObject({ status: 'in_progress', subLabel: 'Changed since approval' })
    expect(bom.procurement.changesSinceApproval.map((l) => l.key).sort()).toEqual(['cable:os2:50', 'cable:os2:75'])
    expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 201)
    expect((await bomView(p.admin.agent, p)).status).toBe('approved')
    // History against the package.
    expect((await spView(p.admin.agent, p)).changeRequests).toEqual([expect.objectContaining({ number: 1, status: 'approved' })])
  })

  it('request changes sends it back to the Architect; reject discards its branch; withdraw too; one CR with the client at a time', async () => {
    const { ctx, p, d } = await approvedPackage()
    const mk = async (title) => expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title }), 201).body.changeRequest
    const change = async (cr, m) => {
      const be = await d.link('border', 'edge', cr.branchId)
      expectStatus(await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: m }, { branchId: cr.branchId }), 200)
      expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
    }
    const a = await mk('Option A')
    const b = await mk('Option B')
    await change(a, 60)
    await change(b, 65)
    const linkA = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${a.id}/send`).send({}), 201).body.shareLink
    expect((await p.admin.agent.post(`${p.base}/change-requests/${b.id}/send`).send({}).expect(409)).body.error.code).toBe('change_request_pending')
    expectStatus(await clientDecides(ctx, linkA, { decision: 'changes_requested', comments: 'Use 70 m' }), 200)
    let cr = (await p.admin.agent.get(`${p.base}/change-requests/${a.id}`).expect(200)).body.changeRequest
    expect(cr.status).toBe('changes_requested')
    // Editable again on its branch.
    const be = await d.link('border', 'edge', a.branchId)
    expectStatus(await d.save('patch', `${p.lld}/connections/${be.id}`, { engineerSelectedM: 70 }, { branchId: a.branchId }), 200)
    // B goes to the client now and is rejected: its branch is discarded; the frozen LLD is unchanged.
    const linkB = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${b.id}/send`).send({}), 201).body.shareLink
    expectStatus(await clientDecides(ctx, linkB, { decision: 'rejected', comments: 'Not needed' }), 200)
    cr = (await p.admin.agent.get(`${p.base}/change-requests/${b.id}`).expect(200)).body.changeRequest
    expect(cr.status).toBe('rejected')
    expect(await col('designbranches').findOne({ _id: new mongoose.Types.ObjectId(b.branchId) })).toMatchObject({ status: 'discarded' })
    expect((await d.link('border', 'edge')).lengths.engineerSelectedM).toBeNull()
    // Withdraw A.
    expectStatus(await p.architect.post(`${p.base}/change-requests/${a.id}/withdraw`), 200)
    expect(await col('designbranches').findOne({ _id: new mongoose.Types.ObjectId(a.branchId) })).toMatchObject({ status: 'discarded' })
    // A CR branch is never promoted or discarded directly.
    const c = await mk('Option C')
    expect((await d.save('post', `${p.lld}/branches/${c.branchId}/promote`, {})).body.error.code).toBe('change_request_branch')
  })

  it('a change request needs an approved LLD', async () => {
    const ctx = t()
    const { lldProject } = await import('./helpers/lld.js')
    const p = await lldProject(ctx)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    expect((await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Too early' }).expect(409)).body.error.code).toBe('no_approved_design')
  })
})
