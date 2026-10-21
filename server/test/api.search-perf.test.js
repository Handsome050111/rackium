import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { Device } from '../src/models/device.js'
import { DeploymentRecord } from '../src/models/deploymentRecord.js'
import { Connection } from '../src/models/connection.js'
import { ConnectionRecord } from '../src/models/connectionRecord.js'
import { CableIdRegistry } from '../src/models/cableIdRegistry.js'

// M7a-2: global search on a large project — 10,000 devices, 20,000
// connections (and their cable IDs), 3,000 as-built records — measured end
// to end through the API. Target: under 500 ms per search locally. The
// numbers are written to logs/search-perf.json for the report.
let replSet
beforeAll(async () => {
  replSet = await startReplSet()
  await clearAll()
})
afterAll(async () => {
  await stopReplSet(replSet)
})

const BUILDINGS = 20
const DEVICES = 10000
const CONNECTIONS = 20000
const RECORDS = 3000
const pad = (n, w = 2) => String(n).padStart(w, '0')
const oid = () => new mongoose.Types.ObjectId()
const hexMac = (n) => pad(n.toString(16), 12).match(/.{2}/g).join(':')

describe('Global search on a large project', () => {
  it(`${DEVICES} devices and ${CONNECTIONS} connections: every kind of search answers in time, unscoped and scoped`, async () => {
    const ctx = createTestApp()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = (await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'Large', code: 'BIG' }).expect(201)).body.project.id
    const base = `/api/v1/orgs/${admin.orgId}/projects/${projectId}`
    const rows = Array.from({ length: BUILDINGS }, (_, i) => ({ countryCode: 'DE', countryName: 'Germany', salCode: 'ERL', campusCode: 'C01', buildingCode: `B${pad(i + 1, 3)}`, buildingName: `Building ${i + 1}`, wingCode: '', wingName: '' }))
    await admin.agent.post(`${base}/hierarchy/import`).send({ rows }).expect(201)
    const cmo = (await admin.agent.get(`${base}/cmo`).expect(200)).body
    const buildings = [...cmo.buildings].sort((x, y) => x.code.localeCompare(y.code))
    const salId = new mongoose.Types.ObjectId(cmo.sals[0].id)
    const tenant = { organisationId: new mongoose.Types.ObjectId(admin.orgId), projectId: new mongoose.Types.ObjectId(projectId) }
    const db = mongoose.connection.db
    await Promise.all([Device, DeploymentRecord, Connection, ConnectionRecord, CableIdRegistry].map((m) => m.init()))

    // 5 rooms × 5 racks per building.
    const floors = buildings.map((b) => ({ _id: oid(), ...tenant, buildingId: new mongoose.Types.ObjectId(b.id), token: 'EG', name: 'Ground floor', order: 0 }))
    await db.collection('floors').insertMany(floors)
    const rooms = floors.flatMap((f) => Array.from({ length: 5 }, (_, i) => ({ _id: oid(), ...tenant, floorId: f._id, buildingId: f.buildingId, code: `TR-EG-${pad(i + 1)}`, name: null })))
    await db.collection('rooms').insertMany(rooms)
    const racks = rooms.flatMap((r) => Array.from({ length: 5 }, (_, i) => ({ _id: oid(), ...tenant, roomId: r._id, buildingId: r.buildingId, code: `${r.code}-R${pad(i + 1)}`, heightU: 42 })))
    await db.collection('racks').insertMany(racks)

    // Devices: half surveyed/CMO gear (serials, MACs, existing labels), half LLD (panels among them).
    const devices = Array.from({ length: DEVICES }, (_, i) => {
      // Every building gets both kinds (i odd = LLD).
      const b = buildings[Math.floor(i / 2) % BUILDINGS]
      const rack = racks[i % racks.length]
      const lld = i % 2 === 1
      return {
        _id: oid(),
        ...tenant,
        origin: lld ? 'planned' : 'existing',
        salId,
        buildingId: new mongoose.Types.ObjectId(b.id),
        rackId: rack._id,
        roomId: rack.roomId,
        layer: lld ? 'lld' : null,
        hostname: lld && i % 7 !== 3 ? `SW-ERL-${b.code}-ED-${pad(i, 5)}` : null,
        label: lld && i % 7 === 3 ? `PP-${pad(i, 5)}` : '24-port switch',
        existingLabel: lld ? null : `VT-${pad(i, 5)}`,
        status: lld ? 'planned' : 'in_service',
        installation: lld ? {} : { serial: `FOC${pad(i, 6)}X`, mac: hexMac(0x001a2b000000 + i) },
        createdAt: new Date(),
      }
    })
    await db.collection('devices').insertMany(devices)
    const lldDevices = devices.filter((d) => d.layer === 'lld')
    const panels = lldDevices.filter((d) => d.label.startsWith('PP-'))
    await db.collection('deploymentrecords').insertMany(
      lldDevices.slice(0, RECORDS).map((d, i) => ({ _id: oid(), ...tenant, buildingId: d.buildingId, deviceId: d._id, status: 'installed', installation: { serial: `SN${pad(i, 7)}`, mac: hexMac(0x00aa00000000 + i) }, assetTag: `AT-${pad(i, 6)}`, dguv: { remindersSent: [] }, history: [], createdAt: new Date(), updatedAt: new Date() }))
    )
    const connections = Array.from({ length: CONNECTIONS }, (_, i) => {
      const a = lldDevices[i % lldDevices.length]
      const z = lldDevices[(i * 7 + 3) % lldDevices.length]
      const panel = panels[i % panels.length]
      return { _id: oid(), ...tenant, buildingId: a.buildingId, layer: 'lld', source: { deviceId: a._id, portId: `Gi1/0/${(i % 48) + 1}` }, dest: { deviceId: z._id, portId: null }, media: 'cat6a', speed: '1G', cableId: `C-${pad(i, 6)}`, hops: i % 3 ? [] : [{ seq: 1, patchPanelId: panel._id, inPort: pad((i % 24) + 1), outPort: pad(((i + 1) % 24) + 1), segmentCableId: `C-${pad(i, 6)}b` }], lengths: {}, status: 'designed', createdAt: new Date(), updatedAt: new Date() }
    })
    await db.collection('connections').insertMany(connections)
    await db.collection('cableidregistries').insertMany(connections.flatMap((c) => [{ ...tenant, layer: 'lld', cableId: c.cableId, cableKey: c.cableId.toLowerCase(), ownerType: 'connection', connectionId: c._id, hopSeq: null, status: 'reserved', reservedAt: new Date() }, ...c.hops.map((h) => ({ ...tenant, layer: 'lld', cableId: h.segmentCableId, cableKey: h.segmentCableId.toLowerCase(), ownerType: 'hop', connectionId: c._id, hopSeq: 1, status: 'reserved', reservedAt: new Date() }))]))
    await db.collection('connectionrecords').insertMany(connections.slice(0, 5000).map((c) => ({ _id: oid(), ...tenant, buildingId: c.buildingId, connectionId: c._id, status: 'installed', installed: { segments: [{ index: 0, cableId: `AB-${c.cableId}`, installedM: 3, confirmed: true }] }, updatedAt: new Date() })))
    expect(await db.collection('devices').countDocuments({ projectId: tenant.projectId })).toBe(DEVICES)
    expect(await db.collection('connections').countDocuments({ projectId: tenant.projectId })).toBe(CONNECTIONS)

    const viewerB001 = await projectMember(ctx, admin, { email: 'viewer-b001@example.com', role: 'viewer', projectId, scopes: [{ type: 'building', refId: buildings[0].id }] })
    const panel = panels[0]
    const queries = [
      ['hostname, exact', devices[1].hostname ?? lldDevices[2].hostname],
      ['hostname, prefix', `SW-ERL-${buildings[0].code}-ED-0`],
      ['hostname, contains', 'ED-0999'],
      ['existing label', 'VT-00420'],
      ['serial (CMO)', 'FOC000420X'],
      ['serial (as built)', 'SN0001234'],
      ['MAC, colons', hexMac(0x001a2b000000 + 420)],
      ['MAC, Cisco dots', hexMac(0x00aa00000000 + 7).replace(/:/g, '').replace(/(.{4})(?=.)/g, '$1.')],
      ['MAC, prefix', '00-1a-2b-00'],
      ['asset ID', 'AT-000777'],
      ['cable ID, exact', 'C-012345'],
      ['cable ID, prefix', 'C-0123'],
      ['as-built cable ID', 'AB-C-000042'],
      // Panel 0 carries hops of connections 0, 3000, 6000, …: ports 01 and 02.
      ['panel port', `${panel.label} 01`],
      ['building', 'B007'],
      ['rack', 'TR-EG-03-R02'],
      ['no match', 'zz-nothing-zz'],
    ]
    const timings = []
    const RUNS = 5
    for (const [who, agent] of [['Org Admin (unscoped)', admin.agent], ['Viewer scoped to B001', viewerB001]]) {
      for (const [name, q] of queries) {
        await agent.get(`/api/v1/orgs/${admin.orgId}/search`).query({ q }).expect(200) // warm-up
        const ms = []
        let count = 0
        for (let i = 0; i < RUNS; i++) {
          const t0 = process.hrtime.bigint()
          const res = await agent.get(`/api/v1/orgs/${admin.orgId}/search`).query({ q }).expect(200)
          ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
          count = res.body.results.length
        }
        ms.sort((a, b) => a - b)
        timings.push({ who, name, q, results: count, medianMs: Math.round(ms[Math.floor(RUNS / 2)]), maxMs: Math.round(ms.at(-1)) })
      }
    }
    const out = { at: new Date().toISOString(), devices: DEVICES, connections: CONNECTIONS, records: RECORDS, runs: RUNS, ci: Boolean(process.env.CI), timings }
    const dir = path.resolve(process.cwd(), '..', 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'search-perf.json'), JSON.stringify(out, null, 2))
    // Sanity: the right things are found, and the scoped Viewer sees only their building.
    const find = (name, who = 'Org Admin (unscoped)') => timings.find((t) => t.name === name && t.who === who)
    for (const name of ['hostname, exact', 'hostname, prefix', 'existing label', 'serial (CMO)', 'serial (as built)', 'MAC, colons', 'MAC, Cisco dots', 'asset ID', 'cable ID, exact', 'as-built cable ID', 'panel port', 'building', 'rack']) expect(find(name).results, name).toBeGreaterThan(0)
    expect(find('no match').results).toBe(0)
    const scoped = (await viewerB001.get(`/api/v1/orgs/${admin.orgId}/search`).query({ q: `SW-ERL-${buildings[0].code}` }).expect(200)).body.results
    expect(scoped.length).toBeGreaterThan(0)
    expect(scoped.every((r) => r.buildingCode === buildings[0].code)).toBe(true)

    console.table(timings.map((t) => ({ who: t.who, query: t.name, results: t.results, median: t.medianMs, max: t.maxMs })))
    // Under 500 ms locally (the target); CI runners are slower and shared.
    const limit = process.env.CI ? 2000 : 500
    for (const tm of timings) expect(tm.medianMs, `${tm.who}: ${tm.name} (${tm.q})`).toBeLessThan(limit)
  }, 600000)
})
