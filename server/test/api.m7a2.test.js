import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import sharp from 'sharp'
import { localDate } from '@rackium/shared/timeZone.js'
import { SURVEY_HELP_FIELDS } from '@rackium/shared/fieldHelp.js'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { deployable, deliverAll, install, depView } from './helpers/m6a.js'
import { dguvReminders } from '../src/deployment/jobs.js'
import { deliverOutbox, dailyDigest } from '../src/notifications/jobs.js'

// M7a-2: global search (with its leak tests), DGUV dashboards and the weekly
// DGUV digest merged with the reminders, field help (DATA-MODEL §5.16).
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
const byRole = (v, role) => v.devices.find((d) => d.role === role)
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const search = async (agent, orgId, q, projectId = null) => expectStatus(await agent.get(`/api/v1/orgs/${orgId}/search`).query({ q, ...(projectId ? { projectId } : {}) }), 200).body.results

// The API call behind each screen a search result links to: a result is only
// right if its screen opens for the same caller.
function apiOf(link) {
  const conn = link.match(/^\/l\/([a-f0-9]+)\/([a-f0-9]+)\/c\/([a-f0-9]+)$/)
  if (conn) return `/api/v1/orgs/${conn[1]}/projects/${conn[2]}/connections/${conn[3]}/locate`
  const [path, query = ''] = link.split('?')
  const m = path.match(/^\/orgs\/([a-f0-9]+)\/projects\/([a-f0-9]+)(?:\/buildings\/([a-f0-9]+)(?:\/(.*))?)?$/)
  if (!m) throw new Error(`unknown link ${link}`)
  const base = `/api/v1/orgs/${m[1]}/projects/${m[2]}`
  const [, , , b, page] = m
  if (!b) return base
  const rack = new URLSearchParams(query).get('rack')
  if (page === 'survey/rack' && rack) return `${base}/survey/racks/${rack}`
  if (page === 'survey' || page === 'survey/room') return `${base}/survey/buildings/${b}/structure`
  if (page === 'hld') return `${base}/hld/buildings/${b}`
  if (page === 'lld') return `${base}/lld/buildings/${b}`
  if (page === 'cmdb') return `${base}/cmdb/buildings/${b}`
  if (page === 'cmo') return `${base}/cmo`
  return `${base}/dashboard/buildings/${b}`
}
async function everyResultOpens(agent, results) {
  for (const r of results) expect((await agent.get(apiOf(r.link))).status, `${r.type} ${r.title} → ${r.link}`).toBe(200)
}

// B001's LLD frozen and deployed in part: Edge installed with a serial and a
// MAC (as-built), an asset ID; a surveyed PDU with its existing label; a
// branch-only device; plus a Viewer scoped to B002.
async function searchProject(ctx) {
  const d = await deployable(ctx)
  const { p } = d
  const v = await deliverAll(p)
  const edge = byRole(v, 'edge')
  await install(p, edge, { serial: 'FOCXQZ0AB', mac: '00-1A-2B-3C-4D-5E' })
  await col('deploymentrecords').updateOne({ deviceId: oid(edge.id) }, { $set: { assetTag: 'ASSET-QX' } })
  const surveyed = await col('devices').findOne({ projectId: oid(p.projectId), buildingId: oid(p.b001), layer: null, label: 'PDU-A' })
  await col('devices').updateOne({ _id: surveyed._id }, { $set: { existingLabel: 'VT-A-01' } })
  // A change-request branch's copy: never searched.
  // A change-request branch's copies — a device (hostname, serial, MAC), a
  // connection and its cable ID: never searched.
  const branch = `lld:${new mongoose.Types.ObjectId()}`
  const tenant = { organisationId: oid(p.admin.orgId), projectId: oid(p.projectId) }
  const branchDevice = new mongoose.Types.ObjectId()
  await col('devices').insertOne({ _id: branchDevice, ...tenant, origin: 'planned', salId: surveyed.salId, buildingId: oid(p.b001), layer: branch, hostname: 'SW-BRANCH-ONLY', status: 'planned', installation: { serial: 'SN-BRANCH-1', mac: '00:aa:bb:cc:dd:ee' }, createdAt: new Date() })
  const branchConn = new mongoose.Types.ObjectId()
  await col('connections').insertOne({ _id: branchConn, ...tenant, buildingId: oid(p.b001), layer: branch, source: { deviceId: branchDevice, portId: null }, dest: { deviceId: branchDevice, portId: null }, media: 'cat6a', speed: '1G', cableId: 'C-BRANCH-9', hops: [], lengths: {}, status: 'designed', createdAt: new Date(), updatedAt: new Date() })
  await col('cableidregistries').insertOne({ ...tenant, layer: branch, cableId: 'C-BRANCH-9', cableKey: 'c-branch-9', ownerType: 'connection', connectionId: branchConn, hopSeq: null, status: 'reserved', reservedAt: new Date() })
  const viewerB002 = await projectMember(ctx, p.admin, { email: 'viewer-b002@example.com', role: 'viewer', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
  const lld = (await p.architect.get(`${p.lld}/buildings/${p.b001}`).expect(200)).body
  return { ...d, edge: lld.devices.find((x) => x.id === edge.id) ?? edge, edgeHostname: edge.hostname, lld, viewerB002, surveyedId: String(surveyed._id) }
}

describe('Global search (brief v2.3 §6.12)', () => {
  it('finds every kind of thing; exact before prefix before contains; current project first; every result opens its screen for the caller', async () => {
    const ctx = t()
    const s = await searchProject(ctx)
    const { p } = s
    const o = p.admin.orgId
    // Hostname: exact, then prefix and contains.
    const exact = await search(p.viewer, o, s.edgeHostname)
    expect(exact[0]).toMatchObject({ type: 'device', title: s.edgeHostname, projectId: p.projectId, buildingCode: 'B001' })
    // An HLD device and its LLD copy with the same name: one result, the LLD's.
    expect(exact.filter((r) => r.type === 'device' && r.title === s.edgeHostname)).toHaveLength(1)
    expect(exact[0].link).toBe(`/orgs/${o}/projects/${p.projectId}/buildings/${p.b001}/lld`)
    const prefix = await search(p.viewer, o, s.edgeHostname.slice(0, 5))
    expect(prefix.some((r) => r.title === s.edgeHostname)).toBe(true)
    // Serial, MAC in any notation, asset ID: the as-built record → the CMDB screen.
    for (const q of ['FOCXQZ0AB', 'focxqz0ab', '00:1A:2B:3C:4D:5E', '001a.2b3c.4d5e', '001A2B3C4D5E', '00-1a-2b', 'ASSET-QX']) {
      const r = (await search(p.viewer, o, q)).find((x) => x.type === 'device')
      expect(r, q).toMatchObject({ title: s.edgeHostname, link: `/orgs/${o}/projects/${p.projectId}/buildings/${p.b001}/cmdb` })
    }
    expect((await search(p.viewer, o, '00:1a:2b:3c:4d:5e'))[0].match).toEqual({ field: 'mac', value: '00:1a:2b:3c:4d:5e' })
    // Surveyed gear by its existing label / name → its rack in the Rack Survey.
    const label = (await search(p.viewer, o, 'vt-a-01')).find((r) => r.type === 'device')
    expect(label).toMatchObject({ id: s.surveyedId, title: 'VT-A-01', match: { field: 'existingLabel', value: 'VT-A-01' } })
    expect(label.link).toMatch(/\/survey\/rack\?rack=[a-f0-9]{24}$/)
    // Cable IDs (connection and hop segment) → the connection link; a panel port.
    const cable = (await search(p.viewer, o, 'C-EA-1b')).find((r) => r.type === 'cable')
    expect(cable).toMatchObject({ title: 'C-EA-1b', link: expect.stringMatching(new RegExp(`^/l/${o}/${p.projectId}/c/[a-f0-9]{24}$`)) })
    expect((await search(p.viewer, o, 'c-ea-1')).map((r) => r.title).slice(0, 2)).toEqual(['C-EA-1', 'C-EA-1b'])
    const panel = s.lld.devices.find((x) => x.id === s.panel.id)
    const panelName = panel.hostname ?? panel.existingLabel ?? panel.label
    for (const q of [`${panelName} 01`, `${panelName}/1`, `${panelName} port 2`]) {
      const port = (await search(p.viewer, o, q)).find((r) => r.type === 'port')
      expect(port, q).toMatchObject({ link: cable.link, subtitle: expect.stringContaining('C-EA-1') })
    }
    expect((await search(p.viewer, o, `${panelName} 09`)).filter((r) => r.type === 'port')).toEqual([])
    // Hierarchy: buildings, the SAL, racks, rooms.
    expect((await search(p.viewer, o, 'B001'))[0]).toMatchObject({ type: 'building', link: `/orgs/${o}/projects/${p.projectId}/buildings/${p.b001}` })
    expect((await search(p.viewer, o, 'ERL')).some((r) => r.type === 'sal')).toBe(true)
    expect((await search(p.viewer, o, p.racks[0].code)).some((r) => r.type === 'rack')).toBe(true)
    // Every result of several broad searches opens for the Viewer.
    for (const q of ['B0', 'C-', 'ERL', s.edgeHostname.slice(0, 3), 'PDU', 'Survey']) await everyResultOpens(p.viewer, await search(p.viewer, o, q))
    // The current project first.
    const second = expectStatus(await p.admin.agent.post(`/api/v1/orgs/${o}/projects`).send({ name: 'Second B001 project', code: 'B001X' }), 201).body.project.id
    expect((await search(p.admin.agent, o, 'B001', second))[0].projectId).toBe(second)
    expect((await search(p.admin.agent, o, 'B001', p.projectId))[0].projectId).toBe(p.projectId)
    // Too short, too long.
    expect(await search(p.viewer, o, 'B')).toEqual([])
    expectStatus(await p.viewer.get(`/api/v1/orgs/${o}/search`).query({ q: 'x'.repeat(201) }), 400)
  }, 240000)

  it('never returns change-request branches, frozen snapshots or prices — for any role; an Architect searching a price finds nothing', async () => {
    const ctx = t()
    const s = await searchProject(ctx)
    const { p } = s
    const o = p.admin.orgId
    for (const q of ['SW-BRANCH-ONLY', 'SN-BRANCH-1', '00:aa:bb:cc:dd:ee', '00aa.bbcc.ddee', 'C-BRANCH-9']) expect(await search(p.admin.agent, o, q), q).toEqual([])
    // The frozen design's version snapshots are not searched: no result is a version or a file.
    const versions = (await col('designversions').find({}).toArray()).map((x) => String(x._id))
    expect(versions.length).toBeGreaterThan(0)
    // Prices as stored (minor units) and as shown (major units, two decimals).
    const minor = (await p.admin.agent.get(`${p.base}/bom/buildings/${p.b001}`).expect(200)).body.lines.flatMap((l) => [l.unitPriceMinor, l.lineTotalMinor]).filter((x) => typeof x === 'number' && x > 0)
    const prices = [...new Set(minor.flatMap((m) => [String(m), (m / 100).toFixed(2)]))]
    expect(prices.length).toBeGreaterThan(0)
    for (const agent of [p.admin.agent, p.architect, p.reviewer, p.viewer]) {
      for (const q of [s.edgeHostname, 'C-', 'B00', 'PDU', ...prices.slice(0, 4)]) {
        const results = await search(agent, o, q)
        for (const r of results) {
          expect(versions).not.toContain(r.id)
          expect(['project', 'country', 'sal', 'campus', 'building', 'floor', 'room', 'rack', 'device', 'cable', 'port']).toContain(r.type)
          expect(JSON.stringify(r)).not.toMatch(/price|cost|currency/i)
          expect(Object.keys(r).sort()).toEqual(['buildingCode', 'id', 'link', 'match', 'projectId', 'projectName', 'subtitle', 'title', 'type'])
        }
      }
    }
    for (const price of prices) expect(await search(p.architect, o, price), price).toEqual([])
    // Opened directly, the BOM shows the Architect no price either (D20: not allowed by default).
    const archBom = expectStatus(await p.architect.get(`${p.base}/bom/buildings/${p.b001}`), 200).body
    expect(archBom.lines.length).toBeGreaterThan(0)
    expect(archBom.lines.every((l) => (l.unitPriceMinor ?? null) === null && (l.lineTotalMinor ?? null) === null)).toBe(true)
  }, 240000)

  it('leaks nothing: another organisation, a project the caller is not in, a building outside scope — and opening them directly is 404 too', async () => {
    const ctx = t()
    const s = await searchProject(ctx)
    const { p } = s
    const o = p.admin.orgId
    const edgeQueries = [s.edgeHostname, 'FOCXQZ0AB', '00:1a:2b:3c:4d:5e', 'ASSET-QX', 'VT-A-01', 'C-EA-1']
    // Another organisation, with its own project and its own B001.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    const otherProject = expectStatus(await other.agent.post(`/api/v1/orgs/${other.orgId}/projects`).send({ name: 'Other', code: 'OTH' }), 201).body.project.id
    await other.agent.post(`/api/v1/orgs/${other.orgId}/projects/${otherProject}/hierarchy/import`).send({ rows: [{ countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B001', buildingName: 'Their B001', wingCode: '', wingName: '' }] }).expect(201)
    for (const q of edgeQueries) expect(await search(other.agent, other.orgId, q), q).toEqual([])
    expect((await search(other.agent, other.orgId, 'B001')).map((r) => r.projectId)).toEqual([otherProject])
    // …and this organisation's search URL is not theirs; opening the records directly is 404.
    expectStatus(await other.agent.get(`/api/v1/orgs/${o}/search`).query({ q: 'B001' }), 404)
    for (const url of [`${p.base}/dashboard/buildings/${p.b001}`, `${p.base}/lld/buildings/${p.b001}`, `${p.base}/cmdb/buildings/${p.b001}`, `${p.base}/connections/${s.lld.connections[0].id}/locate`]) expectStatus(await other.agent.get(url), 404)
    // A PM of another project in the same organisation.
    const second = expectStatus(await p.admin.agent.post(`/api/v1/orgs/${o}/projects`).send({ name: 'Second', code: 'SEC' }), 201).body.project.id
    const outsider = await projectMember(ctx, p.admin, { email: 'pm-elsewhere@example.com', role: 'pm', projectId: second })
    for (const q of [...edgeQueries, 'B001', 'ERL', p.racks[0].code]) expect((await search(outsider, o, q)).filter((r) => r.projectId === p.projectId), q).toEqual([])
    expectStatus(await outsider.get(`${p.base}/dashboard/buildings/${p.b001}`), 404)
    // A Viewer scoped to B002: nothing of B001.
    for (const q of [...edgeQueries, p.racks[0].code]) expect(await search(s.viewerB002, o, q), q).toEqual([])
    const b0 = await search(s.viewerB002, o, 'B00')
    expect(b0.filter((r) => r.type === 'building').map((r) => r.buildingCode)).toEqual(['B002'])
    expect(b0.some((r) => r.buildingCode === 'B001')).toBe(false)
    expectStatus(await s.viewerB002.get(`${p.base}/dashboard/buildings/${p.b001}`), 404)
    expectStatus(await s.viewerB002.get(`${p.base}/connections/${s.lld.connections[0].id}/locate`), 404)
    await everyResultOpens(s.viewerB002, b0)
    // View As (the Org Admin as a Viewer of this project): only this project, as that role;
    // a session that is not the caller's is refused.
    const session = expectStatus(await p.admin.agent.post(`${p.base}/view-as`).send({ projectId: p.projectId, role: 'viewer' }), 201).body.session
    const asViewer = expectStatus(await p.admin.agent.get(`/api/v1/orgs/${o}/search`).set('X-View-As-Session', session.id).query({ q: 'B00' }), 200).body.results
    expect(asViewer.length).toBeGreaterThan(0)
    expect(asViewer.every((r) => r.projectId === p.projectId)).toBe(true)
    expect((await search(p.admin.agent, o, 'SEC')).some((r) => r.projectId === second)).toBe(true)
    expect((await p.admin.agent.get(`/api/v1/orgs/${o}/search`).set('X-View-As-Session', session.id).query({ q: 'SEC' })).body.results.some((r) => r.projectId === second)).toBe(false)
    // Opened directly with the session, the other project is refused (the session is bound to this one).
    expectStatus(await p.admin.agent.get(`/api/v1/orgs/${o}/projects/${second}/schedule`).set('X-View-As-Session', session.id), 403)
    expectStatus(await outsider.get(`/api/v1/orgs/${o}/search`).set('X-View-As-Session', session.id).query({ q: 'B00' }), 403)
    expectStatus(await p.admin.agent.get(`/api/v1/orgs/${o}/search`).set('X-View-As-Session', 'nope').query({ q: 'B00' }), 403)
  }, 240000)
})

describe('DGUV dashboards (brief v2.2 §20.9.3, §20.9.6)', () => {
  it('rolls up device → rack → room → floor → building → SAL → country → project on the local date with the organisation thresholds; drill-down; CSV; scope', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await deliverAll(p)
    const mains = v.devices.filter((x) => x.mainsPowered)
    expect(mains.length).toBeGreaterThanOrEqual(2)
    for (const dev of mains) await install(p, dev)
    const today = localDate(new Date(), 'Europe/Berlin')
    const monthsAgo = (n) => {
      const [y, m, d] = today.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1 - n, Math.min(d, 28))).toISOString().slice(0, 10)
    }
    // One valid, one overdue (49 months, the inspector a formula), the rest not inspected.
    await col('deploymentrecords').updateOne({ deviceId: oid(mains[0].id) }, { $set: { 'dguv.lastInspectionDate': monthsAgo(10), 'dguv.inspector': 'Elektro Meyer' } })
    await col('deploymentrecords').updateOne({ deviceId: oid(mains[1].id) }, { $set: { 'dguv.lastInspectionDate': monthsAgo(49), 'dguv.inspector': '=HYPERLINK("x")' } })
    const D = `${p.base}/dguv`
    const view = async (agent, query = {}) => expectStatus(await agent.get(D).query(query), 200).body
    const project = await view(p.viewer)
    expect(project.today).toBe(today)
    expect(project.thresholds).toEqual({ intervalMonths: 48, expiringSoonDays: 90, expiringDays: 30 })
    expect(project.node).toMatchObject({ level: 'project', worst: 'overdue', counts: { total: mains.length, valid: 1, overdue: 1, not_inspected: mains.length - 2 } })
    expect(project.childLevel).toBe('country')
    // Down the tree: country → SAL → building → floor → room → rack → device, with the path back up.
    let node = project
    for (const level of ['country', 'sal', 'building', 'floor', 'room', 'rack']) {
      const row = node.rows[0]
      expect(row.level).toBe(level)
      node = await view(p.viewer, { level, id: row.id })
      expect(node.node).toMatchObject({ level, id: row.id })
      expect(node.path.at(-1)).toMatchObject({ level, id: row.id })
    }
    expect(node.path.map((x) => x.level)).toEqual(['project', 'country', 'sal', 'building', 'floor', 'room', 'rack'])
    const b001 = await view(p.viewer, { level: 'building', id: p.b001 })
    expect(b001.node.counts.total).toBe(mains.length)
    expect(b001.node.name).toMatch(/^B001/)
    // Drill-down lists, worst first; one status.
    const devices = expectStatus(await p.viewer.get(`${D}/devices`).query({ level: 'building', id: p.b001 }), 200).body.devices
    expect(devices[0]).toMatchObject({ deviceId: mains[1].id, state: 'overdue' })
    expect(devices.map((x) => x.state).at(-1)).toBe('valid')
    expect(expectStatus(await p.viewer.get(`${D}/devices`).query({ status: 'valid' }), 200).body.devices.map((x) => x.deviceId)).toEqual([mains[0].id])
    // CSV: the same rows, formula cells prefixed.
    const csv = expectStatus(await p.viewer.get(`${D}/export.csv`).query({ level: 'building', id: p.b001 }), 200)
    expect(csv.headers['content-type']).toMatch(/text\/csv/)
    const lines = csv.text.trim().split('\r\n')
    expect(lines[0]).toBe('Building,Floor,Room,Rack,Device,Status,Last inspection,Due date,Days remaining,Inspector')
    expect(lines).toHaveLength(mains.length + 1)
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`)
    // The organisation's thresholds: a 12-month interval makes the valid one expiring soon.
    expectStatus(await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ dguv: { intervalMonths: 12, expiringSoonDays: 90, expiringDays: 30 } }), 200)
    expect((await view(p.viewer)).node.counts).toMatchObject({ valid: 0, expiring_soon: 1 })
    // The organisation's local date.
    expectStatus(await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/settings`).send({ timeZone: 'Pacific/Kiritimati' }), 200)
    expect((await view(p.viewer)).today).toBe(localDate(new Date(), 'Pacific/Kiritimati'))
    // Scope: a PM of B002 sees none of B001; B001's nodes are 404.
    const pmB002 = await projectMember(ctx, p.admin, { email: 'pm-b002@example.com', role: 'pm', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    expect((await view(pmB002)).node.counts.total).toBe(0)
    for (const [level, id] of [['building', p.b001], ['rack', p.racks[0].id], ['device', mains[0].id], ['sal', project.rows[0] && (await view(p.viewer, { level: 'country', id: project.rows[0].id })).rows[0].id]]) {
      expectStatus(await pmB002.get(D).query({ level, id }), 404)
    }
    expect(expectStatus(await pmB002.get(`${D}/export.csv`), 200).text.trim().split('\r\n')).toHaveLength(1)
    // …in the drill-down and the CSV too, whatever node is asked for.
    expect(expectStatus(await pmB002.get(`${D}/devices`), 200).body.devices).toEqual([])
    for (const query of [{ level: 'building', id: p.b001 }, { level: 'rack', id: p.racks[0].id }, { level: 'device', id: mains[0].id }]) {
      expectStatus(await pmB002.get(`${D}/devices`).query(query), 404)
      expectStatus(await pmB002.get(`${D}/export.csv`).query(query), 404)
    }
    // Every project role reads it (as the CMDB); someone without a role in this project does not.
    for (const agent of [p.viewer, p.reviewer, p.fe, p.architect]) expectStatus(await agent.get(D), 200)
    const second = expectStatus(await p.admin.agent.post(`/api/v1/orgs/${p.admin.orgId}/projects`).send({ name: 'Second', code: 'SEC' }), 201).body.project.id
    const outsider = await projectMember(ctx, p.admin, { email: 'pm-elsewhere@example.com', role: 'pm', projectId: second })
    for (const url of [D, `${D}/devices`, `${D}/export.csv`]) expectStatus(await outsider.get(url), 404)
    // Another organisation / no member: 404.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    expectStatus(await other.agent.get(D), 404)
    expectStatus(await p.viewer.get(D).query({ level: 'nope' }), 400)
    expectStatus(await p.viewer.get(D).query({ level: 'building' }), 404)
  }, 240000)

  it('the weekly DGUV digest is the reminders by email: each item once, Monday at the local morning time; nothing in the daily digest; in-app as before', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await deliverAll(p)
    const [first, second] = v.devices.filter((x) => x.mainsPowered)
    await install(p, first)
    const pm2 = await projectMember(ctx, p.admin, { email: 'pm2@example.com', role: 'pm', projectId: p.projectId })
    await projectMember(ctx, p.admin, { email: 'pm3@example.com', role: 'pm', projectId: p.projectId })
    // The owner wants DGUV by email, PM 2 as a daily digest; both get the weekly digest.
    await p.admin.agent.put(`/api/v1/orgs/${p.admin.orgId}/notification-preferences`).send({ modes: { dguv_not_inspected: 'email', dguv_expiry: 'email' } }).expect(200)
    await pm2.put(`/api/v1/orgs/${p.admin.orgId}/notification-preferences`).send({ modes: { dguv_not_inspected: 'digest', dguv_expiry: 'digest' } }).expect(200)
    const weekly = () => col('emailoutboxes').find({ kind: 'dguv_weekly' }).sort({ to: 1 }).toArray()
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 1 })
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    let rows = await weekly()
    expect(rows.map((r) => [r.to, r.items.length, r.status])).toEqual([['owner@example.com', 1, 'pending'], ['pm2@example.com', 1, 'pending']])
    // No email per item for this type, and not in the daily digest.
    expect(await col('emailoutboxes').countDocuments({ kind: 'notification', subject: /DGUV|not DGUV-inspected/ })).toBe(0)
    expect((await col('notifications').find({ type: 'dguv_not_inspected' }).toArray()).every((n) => !n.deliveredChannels.includes('digest'))).toBe(true)
    await dailyDigest({ now: new Date(Date.now() + 86400000) })
    expect(await col('emailoutboxes').countDocuments({ kind: 'digest' })).toBe(0)
    // Due next Monday at 07:00 Berlin; a second item the same week joins the same mail.
    const notBefore = rows[0].notBefore
    expect(localDate(notBefore, 'Europe/Berlin')).toBe(rows[0].dedupeKey.split(':').at(-1))
    expect(new Date(`${localDate(notBefore, 'Europe/Berlin')}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(notBefore)).toBe('07:00')
    await install(p, second)
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 1 })
    rows = await weekly()
    expect(rows.map((r) => r.items.length)).toEqual([2, 2])
    expect(rows[0].text).toContain('2 inspection reminder(s)')
    // Not before its time; then one email each, once.
    expect((await deliverOutbox({ mailer: ctx.mailer, now: new Date(notBefore.getTime() - 60000) })).sent).toBe(0)
    expect((await deliverOutbox({ mailer: ctx.mailer, now: notBefore })).sent).toBe(2)
    expect((await deliverOutbox({ mailer: ctx.mailer, now: new Date(notBefore.getTime() + 3600000) })).sent).toBe(0)
    // The reminder job again: what the sent mails held is not queued again.
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    expect((await weekly()).map((r) => [r.status, r.items.length])).toEqual([['sent', 2], ['sent', 2]])
    const mail = ctx.mailer.lastTo('owner@example.com')
    expect(mail.subject).toBe('Rackium: weekly DGUV digest — 2 inspection reminder(s)')
    expect(mail.text.match(/is installed but not DGUV-inspected/g)).toHaveLength(2)
    // In-app as before: PM 2 (digest) and PM 3 (in-app, the default) have the bell
    // notification, the owner (email only) none; PM 3 gets no weekly mail.
    const bell = async (email) => col('notifications').countDocuments({ type: 'dguv_not_inspected', recipientId: (await col('users').findOne({ email }))._id })
    expect(await bell('pm2@example.com')).toBeGreaterThan(0)
    expect(await bell('pm3@example.com')).toBeGreaterThan(0)
    expect(await bell('owner@example.com')).toBe(0)
    expect(await col('emailoutboxes').countDocuments({ kind: 'dguv_weekly', to: 'pm3@example.com' })).toBe(0)
    // The next reminder goes into the following week's mail, never the one already sent.
    await col('deploymentrecords').updateOne({ deviceId: oid(first.id) }, { $set: { 'dguv.lastInspectionDate': '2022-01-01', 'dguv.inspector': 'X' } })
    expect((await dguvReminders()).sent).toBe(1)
    rows = await weekly()
    expect(rows.filter((r) => r.status === 'pending').map((r) => r.items.map((i) => i.title))).toEqual([[expect.stringMatching(/^DGUV inspection of .* overdue since/)], [expect.stringMatching(/overdue since/)]])
    expect(rows.filter((r) => r.status === 'sent').every((r) => r.items.length === 2)).toBe(true)
    // The deployment screen's own view is unchanged.
    expect((await depView(p.fe, p)).devices.find((x) => x.id === first.id).dguv.status).toBe('overdue')
  }, 240000)
})

describe('Weekly DGUV digest and the M6a reminders', () => {
  it('an item the M6a reminders already sent is not emailed again: not in the weekly digest, no immediate mail', async () => {
    const ctx = t()
    const { p } = await deployable(ctx)
    const v = await deliverAll(p)
    const [first] = v.devices.filter((x) => x.mainsPowered)
    await install(p, first)
    await p.admin.agent.put(`/api/v1/orgs/${p.admin.orgId}/notification-preferences`).send({ modes: { dguv_not_inspected: 'email', dguv_expiry: 'email' } }).expect(200)
    // Sent before M7a-2: the reminder's claim is on the record (as the M6a job leaves it).
    await col('deploymentrecords').updateOne({ deviceId: oid(first.id) }, { $set: { 'dguv.remindersSent': ['not_inspected'] } })
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    expect(await col('emailoutboxes').countDocuments({})).toBe(0)
    // An expiry already sent for this due date: likewise.
    await col('deploymentrecords').updateOne({ deviceId: oid(first.id) }, { $set: { 'dguv.lastInspectionDate': '2022-01-01', 'dguv.inspector': 'X', 'dguv.remindersSent': ['not_inspected', 'overdue:2026-01-01'] } })
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    expect(await col('emailoutboxes').countDocuments({})).toBe(0)
    // A new level for the same device is new: once, in the weekly digest.
    await col('deploymentrecords').updateOne({ deviceId: oid(first.id) }, { $set: { 'dguv.lastInspectionDate': '2022-02-01' } })
    expect(await dguvReminders()).toEqual({ sent: 1, notInspected: 0 })
    expect(await dguvReminders()).toEqual({ sent: 0, notInspected: 0 })
    const rows = await col('emailoutboxes').find({}).toArray()
    expect(rows.map((r) => [r.kind, r.items.length])).toEqual([['dguv_weekly', 1]])
  }, 240000)
})

async function jpegWithGps() {
  return sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#336699' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestCam', Model: 'Model X', Copyright: 'Someone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '49/1 35/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '11/1 0/1 0/1' } })
    .toBuffer()
}

describe('Field help (brief v2.2 §18)', () => {
  it('platform defaults are placeholders; the Org Admin edits plain text (audited); every member reads; others are refused', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const o = admin.orgId
    const project = expectStatus(await admin.agent.post(`/api/v1/orgs/${o}/projects`).send({ name: 'P', code: 'P1' }), 201).body.project.id
    const pm = await projectMember(ctx, admin, { email: 'pm@example.com', role: 'pm', projectId: project })
    const fe = await projectMember(ctx, admin, { email: 'fe@example.com', role: 'field_engineer', projectId: project })
    const withHint = SURVEY_HELP_FIELDS.find((f) => f.hint)
    const noHint = SURVEY_HELP_FIELDS.find((f) => !f.hint)
    const list = expectStatus(await fe.get(`/api/v1/orgs/${o}/field-help`), 200).body.fields
    expect(list).toHaveLength(SURVEY_HELP_FIELDS.length)
    expect(list.find((f) => f.key === withHint.key).help).toMatchObject({ meaning: withHint.hint, placeholder: true, overridden: false })
    expect(list.find((f) => f.key === noHint.key).help).toBeNull()
    const put = (agent, key, body) => agent.put(`/api/v1/orgs/${o}/field-help/${key}`).send(body)
    // Org Admin only: every project role is refused, for text and reset.
    const others = [pm, fe]
    for (const role of ['architect', 'reviewer', 'viewer']) others.push(await projectMember(ctx, admin, { email: `${role}@example.com`, role, projectId: project }))
    for (const agent of others) {
      expectStatus(await put(agent, withHint.key, { example: 'x' }), 403)
      expectStatus(await agent.delete(`/api/v1/orgs/${o}/field-help/${withHint.key}`), 403)
    }
    // Plain text: markup is kept as typed (the client shows it as text), control characters go.
    const markup = '<img src=x onerror="alert(1)"><b>bold</b>'
    const saved = expectStatus(await put(admin.agent, withHint.key, { example: `${markup}\u0007`, mistakes: 'Line 1\r\nLine 2' }), 200).body
    expect(saved.help).toMatchObject({ meaning: withHint.hint, example: markup, mistakes: 'Line 1\nLine 2', placeholder: false, overridden: true })
    expect(expectStatus(await put(admin.agent, noHint.key, { meaning: 'Our own words' }), 200).body.help).toMatchObject({ meaning: 'Our own words', placeholder: false })
    expectStatus(await put(admin.agent, 'survey:nope:nope', { meaning: 'x' }), 404)
    expectStatus(await put(admin.agent, withHint.key, { meaning: 'x'.repeat(1001) }), 400)
    expectStatus(await put(admin.agent, withHint.key, { html: '<b>' }), 400)
    expect((await fe.get(`/api/v1/orgs/${o}/field-help`).expect(200)).body.fields.find((f) => f.key === withHint.key).help.example).toBe(markup)
    // Back to the default.
    expect(expectStatus(await admin.agent.delete(`/api/v1/orgs/${o}/field-help/${withHint.key}`), 200).body.help).toMatchObject({ meaning: withHint.hint, example: null, placeholder: true })
    const audits = await col('auditentries').find({ action: /^field_help\./ }).sort({ occurredAt: 1, _id: 1 }).toArray()
    expect(audits.map((a) => a.action)).toEqual(['field_help.updated', 'field_help.updated', 'field_help.reset'])
    expect(audits[0].changes.map((c) => c.field).sort()).toEqual(['example', 'mistakes'])
    // Another organisation's member: not found.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    expectStatus(await other.agent.get(`/api/v1/orgs/${o}/field-help`), 404)
    expectStatus(await put(other.agent, withHint.key, { meaning: 'x' }), 404)
    // Their own organisation sees only the defaults.
    expect((await other.agent.get(`/api/v1/orgs/${other.orgId}/field-help`).expect(200)).body.fields.find((f) => f.key === noHint.key).help).toBeNull()
  }, 120000)

  it('reference photos: JPG, PNG or WebP by their bytes, size-checked, re-encoded with EXIF and GPS stripped; Org Admin only; readable by members', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const o = admin.orgId
    const project = expectStatus(await admin.agent.post(`/api/v1/orgs/${o}/projects`).send({ name: 'P', code: 'P1' }), 201).body.project.id
    const fe = await projectMember(ctx, admin, { email: 'fe@example.com', role: 'field_engineer', projectId: project })
    const key = SURVEY_HELP_FIELDS[0].key
    const upload = (agent, bytes, type = 'image/jpeg', k = key) => agent.post(`/api/v1/orgs/${o}/field-help/${k}/photos`).query({ caption: 'Rack front' }).set('Content-Type', type).send(bytes)
    const original = await jpegWithGps()
    const before = await sharp(original).metadata()
    expect(before.exif).toBeTruthy()
    // The original carries a GPS block (the GPS IFD pointer, tag 0x8825).
    const hasGpsIfd = (b) => b.includes(Buffer.from([0x88, 0x25])) || b.includes(Buffer.from([0x25, 0x88]))
    expect(hasGpsIfd(before.exif)).toBe(true)
    expectStatus(await upload(fe, original), 403)
    const photo = expectStatus(await upload(admin.agent, original), 201).body.photo
    expect(photo).toMatchObject({ mimeType: 'image/jpeg', widthPx: 1600, heightPx: 800, caption: 'Rack front' })
    const served = await fe.get(photo.url).buffer(true).parse((res, cb) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(served.status).toBe(200)
    expect(served.headers['content-type']).toBe('image/jpeg')
    const after = await sharp(served.body).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(served.body.includes(Buffer.from('TestCam'))).toBe(false)
    // The stored file itself: the re-encoded bytes, no EXIF, no GPS, no camera data.
    const row = await col('fieldhelps').findOne({ key })
    const stored = fs.readFileSync(path.resolve(ctx.config.FILE_STORAGE_DIR, row.photos[0].storageKey))
    expect(stored.equals(served.body)).toBe(true)
    expect(original.includes(Buffer.from('TestCam'))).toBe(true)
    const storedMeta = await sharp(stored).metadata()
    expect(storedMeta.exif).toBeUndefined()
    expect(storedMeta.xmp).toBeUndefined()
    expect(storedMeta.iptc).toBeUndefined()
    for (const marker of ['TestCam', 'Model X', 'Someone', 'Exif']) expect(stored.includes(Buffer.from(marker)), marker).toBe(false)
    expect(row.photos[0].sizeBytes).toBe(stored.length)
    // Other roles may not add or remove photos.
    expectStatus(await upload(fe, original), 403)
    // PNG and WebP pass; anything else by its bytes is refused, whatever it claims.
    expectStatus(await upload(admin.agent, await sharp({ create: { width: 10, height: 10, channels: 4, background: '#fff0' } }).png().toBuffer(), 'image/png'), 201)
    expectStatus(await upload(admin.agent, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).webp().toBuffer(), 'image/webp'), 201)
    expectStatus(await upload(admin.agent, Buffer.from('%PDF-1.4 not a photo'), 'image/jpeg'), 415)
    expectStatus(await upload(admin.agent, Buffer.from('GIF89a........'), 'image/gif'), 415)
    expectStatus(await upload(admin.agent, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('broken')]), 'image/jpeg'), 415)
    // Too large (over 10 MB): refused before decoding.
    expectStatus(await upload(admin.agent, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10.5 * 1024 * 1024)]), 'image/jpeg'), 413)
    // At most six per field.
    for (let i = 0; i < 3; i++) expectStatus(await upload(admin.agent, original), 201)
    expect((await upload(admin.agent, original)).body.error.code).toBe('too_many_photos')
    expectStatus(await upload(admin.agent, original, 'image/jpeg', 'survey:nope:nope'), 404)
    // Shown with the field's help; removed by the Org Admin.
    const help = (await fe.get(`/api/v1/orgs/${o}/field-help`).expect(200)).body.fields.find((f) => f.key === key).help
    expect(help.photos).toHaveLength(6)
    expectStatus(await fe.delete(`/api/v1/orgs/${o}/field-help/${key}/photos/${photo.id}`), 403)
    expectStatus(await admin.agent.delete(`/api/v1/orgs/${o}/field-help/${key}/photos/${photo.id}`), 200)
    expectStatus(await fe.get(photo.url), 404)
    // Another organisation cannot read it.
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    expectStatus(await other.agent.get(help.photos[1].url), 404)
    expect((await col('auditentries').find({ action: /^field_help\.photo/ }).toArray()).map((a) => a.action).filter((a) => a === 'field_help.photo_removed')).toHaveLength(1)
  }, 120000)
})
