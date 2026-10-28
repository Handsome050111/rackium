import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember } from './helpers/app.js'
import { hldProject, hldView } from './helpers/hld.js'
import { deployable } from './helpers/m6a.js'
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

// Preset M: Fusion + Border in TR-EG-01, Edge + AP in TR-EG-02; uplinks
// Border–Fusion, Border–Edge (between the rooms) and Edge–AP.
async function generated(ctx = t()) {
  const p = await hldProject(ctx)
  const v0 = await hldView(p.architect, p)
  await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: v0.design.revision }).expect(201)
  return p
}
const helpers = (p, branchId = null) => {
  const view = (agent = p.architect) => (branchId ? agent.get(`${p.hld}/buildings/${p.b001}`).query({ branchId }).expect(200).then((r) => r.body) : hldView(agent, p))
  return {
    view,
    device: async (role) => (await view()).devices.find((d) => d.role === role),
    uplink: async (a, b) => {
      const v = await view()
      const id = (role) => v.devices.find((d) => d.role === role).id
      return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [id(a), id(b)].sort().join())
    },
    // A design write with the current revision.
    write: async (method, url, body = {}, agent = p.architect) => {
      const baseRevision = (await view()).design.revision
      return agent[method](url).send({ ...body, baseRevision })
    },
    tool: async (url, body = {}, agent = p.architect) => {
      const baseRevision = (await view()).design.revision
      return agent.post(url).send({ ...body, baseRevision })
    },
    validation: async () => (await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).query(branchId ? { branchId } : {}).expect(200)).body,
  }
}
const audit = (action) => col('auditentries').find({ action }).toArray()

describe('Break Uplink (addendum v2.3 Q1; DATA-MODEL §5.20)', () => {
  it('releases both ports and retires the cable ID; the link is archived with its reason, not deleted; both devices get W-UPLINK-NEEDED, a warning that never blocks; relinking clears it', async () => {
    const p = await generated()
    const h = helpers(p)
    const be = await h.uplink('border', 'edge')
    const [border, edge] = [await h.device('border'), await h.device('edge')]
    // Ports and a cable ID first, so there is something to release.
    const ends = be.source.deviceId === border.id ? { source: { deviceId: border.id, portId: 'Te1/1/2' }, dest: { deviceId: edge.id, portId: 'Te1/1/1' } } : { source: { deviceId: edge.id, portId: 'Te1/1/1' }, dest: { deviceId: border.id, portId: 'Te1/1/2' } }
    expectStatus(await h.write('patch', `${p.hld}/uplinks/${be.id}`, { ...ends, cableId: 'C-BE-1' }), 200)
    expect(await col('portoccupancies').countDocuments({ connectionId: oid(be.id) })).toBe(2)

    // A reason is required.
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/break`, {}), 400)
    const res = expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/break`, { reason: 'Edge moves to the new core' }), 200).body
    expect(res).toMatchObject({ broken: be.id })
    // Released and retired; the record kept, archived.
    expect(await col('portoccupancies').countDocuments({ connectionId: oid(be.id) })).toBe(0)
    expect(await col('cableidregistries').findOne({ cableKey: 'c-be-1' })).toMatchObject({ status: 'retired' })
    const raw = await col('connections').findOne({ _id: oid(be.id) })
    expect(raw.archived).toMatchObject({ tool: 'break', reason: 'Edge moves to the new core', byName: 'architect', sourceName: expect.any(String), destName: expect.any(String) })
    // Out of the design: not in the view (listed apart), not in the BOM, a second break 404.
    const view = await h.view()
    expect(view.connections.map((c) => c.id)).not.toContain(be.id)
    expect(view.archivedUplinks).toEqual([expect.objectContaining({ id: be.id, tool: 'break', reason: 'Edge moves to the new core', by: 'architect' })])
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/break`, { reason: 'again' }), 404)
    // Uplink needed: a warning on both devices, never critical.
    const v = await h.validation()
    const needed = v.findings.filter((f) => f.rule === 'W-UPLINK-NEEDED')
    expect(needed.map((f) => f.objectId).sort()).toEqual([border.id, edge.id].sort())
    expect(needed.every((f) => f.severity === 'warning')).toBe(true)
    expect(needed.find((f) => f.objectId === edge.id).message).toMatch(/uplink needed — its uplink to .+ was broken \(Edge moves to the new core\)/)
    expect(v.findings.filter((f) => f.severity === 'critical')).toEqual([])
    const [entry] = await audit('hld.uplink.broken')
    expect(entry).toMatchObject({ objectId: be.id, comment: expect.stringContaining('Edge moves to the new core') })
    // Relinking (a new uplink after the break) clears it.
    expectStatus(await h.tool(`${p.hld}/uplinks`, { buildingId: p.b001, source: { deviceId: border.id }, dest: { deviceId: edge.id }, media: be.media, speed: be.speed }), 201)
    expect((await h.validation()).findings.filter((f) => f.rule === 'W-UPLINK-NEEDED')).toEqual([])
    // Submit is never blocked by it: break again and submit.
    const again = await h.uplink('border', 'edge')
    expectStatus(await h.tool(`${p.hld}/uplinks/${again.id}/break`, { reason: 'Not needed after all' }), 200)
    expectStatus(await h.write('post', `${p.hld}/submit`, { buildingId: p.b001 }), 201)
  }, 180000)
})

describe('Reroute (addendum v2.3 Q1)', () => {
  it('the same ends through another room: the length is the pathways added up; via the patch panel the BOM counts two cables and a patch panel; bad routes are refused', async () => {
    const p = await generated()
    const h = helpers(p)
    // A third room with pathways to both: TR-EG-01 —30 m— third —25 m— TR-EG-02.
    const newRoom = async () => (await p.fe.post(`${p.base}/survey/rooms`).send({ floorId: p.rooms.main.floorId }).expect(201)).body.room
    const third = await newRoom()
    await p.architect.post(`${p.base}/survey/pathways`).send({ fromRoomId: p.rooms.main.id, toRoomId: third.id, routeStatus: 'surveyed', distanceM: 30 }).expect(201)
    await p.architect.post(`${p.base}/survey/pathways`).send({ fromRoomId: third.id, toRoomId: p.rooms.second.id, routeStatus: 'surveyed', distanceM: 25 }).expect(201)
    const be = await h.uplink('border', 'edge')
    const before = be.length.suggestedM
    const bomLine = async () => (await p.admin.agent.get(`${p.base}/bom/buildings/${p.b001}`).expect(200)).body.lines
    const cableKeysBefore = (await bomLine()).filter((l) => l.key.startsWith(`cable:${be.media}`)).map((l) => l.key)

    const res = expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaRoomIds: [third.id] }), 200).body
    expect(res.uplink.route).toEqual({ viaRoomIds: [third.id] })
    expect(res.length.before).toBe(before)
    expect(res.length.after).toBeGreaterThan(before) // 55 m of pathway instead of 42
    expect((await h.uplink('border', 'edge')).length.suggestedM).toBe(res.length.after)
    // The BOM follows: the cable is counted at a stock length that covers the new route.
    const lines = await bomLine()
    const lengthsOf = (keys) => keys.map((k) => Number(k.split(':')[2])).filter(Number.isFinite)
    const cableKeysAfter = lines.filter((l) => l.key.startsWith(`cable:${be.media}`)).map((l) => l.key)
    expect(cableKeysAfter).not.toEqual(cableKeysBefore)
    expect(Math.max(...lengthsOf(cableKeysAfter))).toBeGreaterThanOrEqual(res.length.after)
    expect(Math.max(...lengthsOf(cableKeysAfter))).toBeGreaterThan(Math.max(...lengthsOf(cableKeysBefore)))
    const [entry] = await audit('hld.uplink.rerouted')
    expect(entry.changes.map((c) => [c.field, c.before, c.after])).toEqual(expect.arrayContaining([['route', 'direct', third.code], ['length', before, res.length.after]]))

    // Via the destination room's patch panel: two cables, and a panel (no surveyed panel there).
    const withPanel = expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaPatchPanel: true }), 200).body
    expect(withPanel.uplink).toMatchObject({ viaPatchPanel: true, route: { viaRoomIds: [third.id] } })
    const panelLines = await bomLine()
    const cableCount = (list) => list.filter((l) => l.category === 'Cables').reduce((n, l) => n + l.qty, 0)
    expect(cableCount(panelLines)).toBe(cableCount(lines) + 1)
    const panel = panelLines.find((l) => /patch panel/i.test(l.item) && (l.basis ?? '').includes('via the patch panel'))
    expect(panel).toMatchObject({ qty: 1, source: 'HLD' })
    expect(panel.basis).toMatch(/1 uplink\(s\) via the patch panel in TR-EG-0\d: 1 × 24-port/)
    // Back to direct and the plain pathway: the panel line goes.
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaPatchPanel: false, viaRoomIds: [] }), 200)
    expect((await bomLine()).find((l) => (l.basis ?? '').includes('via the patch panel'))).toBeUndefined()
    expect((await h.uplink('border', 'edge')).length.suggestedM).toBe(before)

    // Refused: no pathway on a leg, a link within one room, the link's own room, nothing to change.
    const lonely = await newRoom()
    expect(expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaRoomIds: [lonely.id] }), 400).body.error.message).toMatch(/^No pathway between/)
    const bf = await h.uplink('border', 'fusion')
    expectStatus(await h.tool(`${p.hld}/uplinks/${bf.id}/reroute`, { viaRoomIds: [third.id] }), 400)
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaRoomIds: [p.rooms.main.id] }), 400)
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, {}), 400)
  }, 180000)
})

describe('Replace Endpoint (addendum v2.3 Q1)', () => {
  it('moves one end to another device: the old port released, the new one taken; a new cable ID by default, the old one kept on request', async () => {
    const p = await generated()
    const h = helpers(p)
    const ea = await h.uplink('edge', 'ap')
    const [edge, ap] = [await h.device('edge'), await h.device('ap')]
    const apEnd = ea.source.deviceId === ap.id ? 'source' : 'dest'
    const edgeEnd = apEnd === 'source' ? 'dest' : 'source'
    expectStatus(await h.write('patch', `${p.hld}/uplinks/${ea.id}`, { [edgeEnd]: { deviceId: edge.id, portId: 'Gi1/0/1' }, [apEnd]: { deviceId: ap.id, portId: 'Eth0' }, cableId: 'C-EA-1' }), 200)
    const ap2 = expectStatus(await h.tool(`${p.hld}/devices`, { buildingId: p.b001, role: 'ap', roomId: p.rooms.second.id }), 201).body.device

    const res = expectStatus(await h.tool(`${p.hld}/uplinks/${ea.id}/replace-endpoint`, { end: apEnd, deviceId: ap2.id, portId: 'Eth0' }), 200).body
    expect(res.uplink[apEnd]).toEqual({ deviceId: ap2.id, portId: 'Eth0' })
    expect(res.cableId.before).toBe('C-EA-1')
    expect(res.cableId.after).not.toBe('C-EA-1')
    expect(await col('cableidregistries').findOne({ cableKey: 'c-ea-1' })).toMatchObject({ status: 'retired' })
    expect(await col('cableidregistries').findOne({ cableKey: res.cableId.after.toLowerCase(), status: 'reserved' })).toBeTruthy()
    // The old AP's port is free, the new one's taken.
    expect(await col('portoccupancies').countDocuments({ deviceId: oid(ap.id) })).toBe(0)
    expect(await col('portoccupancies').countDocuments({ deviceId: oid(ap2.id), connectionId: oid(ea.id) })).toBe(1)
    const [entry] = await audit('hld.uplink.endpoint_replaced')
    expect(entry.changes.map((c) => c.field).sort()).toEqual(['cableId', `${apEnd} end`].sort())
    // Back, keeping the cable ID this time.
    const kept = expectStatus(await h.tool(`${p.hld}/uplinks/${ea.id}/replace-endpoint`, { end: apEnd, deviceId: ap.id, portId: 'Eth0', keepCableId: true }), 200).body
    expect(kept.cableId).toEqual({ before: res.cableId.after, after: res.cableId.after })
    // Refused: the other end's device; the same end again.
    expectStatus(await h.tool(`${p.hld}/uplinks/${ea.id}/replace-endpoint`, { end: apEnd, deviceId: edge.id }), 400)
    expectStatus(await h.tool(`${p.hld}/uplinks/${ea.id}/replace-endpoint`, { end: apEnd, deviceId: ap.id, portId: 'Eth0' }), 400)
  }, 180000)
})

describe('Split and Merge (addendum v2.3 Q1)', () => {
  it('Split checks the inserted device has free ports before anything is written; A–B becomes A–X–B (A–B archived, new cable IDs); Merge joins them back with a new cable ID and leaves X in place, unlinked', async () => {
    const p = await generated()
    const h = helpers(p)
    const be = await h.uplink('border', 'edge')
    expectStatus(await h.write('patch', `${p.hld}/uplinks/${be.id}`, { cableId: 'C-BE-1' }), 200)
    const devicesBefore = (await h.view()).devices.length

    // An AP cannot take a fibre link twice: refused, nothing written.
    const refused = expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/split`, { newDevice: { role: 'ap', roomId: p.rooms.second.id } }), 409).body.error
    expect(refused).toMatchObject({ code: 'no_free_ports' })
    expect(refused.message).toMatch(/has \d free port\(s\) for (OS2|OM4); splitting an uplink needs two/)
    expect((await h.view()).devices).toHaveLength(devicesBefore)
    expect((await h.view()).connections.map((c) => c.id)).toContain(be.id)
    expect(await col('connections').countDocuments({ archived: { $ne: null } })).toBe(0)

    // A new Distribution goes in.
    const split = expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/split`, { newDevice: { role: 'distribution', roomId: p.rooms.main.id } }), 201).body
    expect(split).toMatchObject({ device: { created: true }, archived: be.id })
    const x = split.device.id
    const view = await h.view()
    expect(view.devices.map((d) => d.id)).toContain(x)
    expect(view.connections.map((c) => c.id)).not.toContain(be.id)
    expect(view.archivedUplinks).toEqual([expect.objectContaining({ id: be.id, tool: 'split', reason: expect.stringMatching(/^Split: .+ inserted$/) })])
    const [ax, xb] = split.uplinks
    for (const u of [ax, xb]) {
      expect(u).toMatchObject({ media: be.media, speed: be.speed })
      expect([u.source.deviceId, u.dest.deviceId]).toContain(x)
      expect(u.cableId).toBeTruthy()
      expect(u.cableId).not.toBe('C-BE-1')
    }
    expect(ax.cableId).not.toBe(xb.cableId)
    // Named ports: one X already uses for A–X is refused (before anything is written).
    const dist = view.devices.find((d) => d.id === x)
    const xEnd = ax.source.deviceId === x ? 'source' : 'dest'
    const otherEnd = xEnd === 'source' ? 'dest' : 'source'
    expectStatus(await h.write('patch', `${p.hld}/uplinks/${ax.id}`, { [xEnd]: { deviceId: x, portId: dist.ports[0] }, [otherEnd]: ax[otherEnd] }), 200)
    const bf = await h.uplink('border', 'fusion')
    const inUse = expectStatus(await h.tool(`${p.hld}/uplinks/${bf.id}/split`, { deviceId: x, ports: { towardSource: dist.ports[0], towardDest: dist.ports[1] } }), 409).body.error
    expect(inUse).toMatchObject({ code: 'no_free_ports' })
    expect((await h.view()).connections.map((c) => c.id)).toContain(bf.id)

    // Merge at X: A–B again with a new cable ID; X stays, unlinked; both links archived.
    const links = (await h.view()).connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(x))
    expect(links).toHaveLength(2)
    const merged = expectStatus(await h.tool(`${p.hld}/devices/${x}/merge`, {}), 201).body
    expect(merged.archived.sort()).toEqual(links.map((l) => l.id).sort())
    expect(merged.uplink.cableId).toBeTruthy()
    expect([...links.map((l) => l.cableId), 'C-BE-1']).not.toContain(merged.uplink.cableId)
    expect([merged.uplink.source.deviceId, merged.uplink.dest.deviceId].sort()).toEqual([be.source.deviceId, be.dest.deviceId].sort())
    const after = await h.view()
    expect(after.devices.map((d) => d.id)).toContain(x)
    expect(after.connections.filter((c) => [c.source.deviceId, c.dest.deviceId].includes(x))).toEqual([])
    expect(after.archivedUplinks.filter((a) => a.tool === 'merge')).toHaveLength(2)
    expect((await audit('hld.device.merged'))[0].comment).toMatch(/stays, unlinked$/)
    // X keeps no port.
    expect(await col('portoccupancies').countDocuments({ deviceId: oid(x) })).toBe(0)
    // Merge needs exactly two uplinks.
    const ap = await h.device('ap')
    expect(expectStatus(await h.tool(`${p.hld}/devices/${ap.id}/merge`, {}), 409).body.error.code).toBe('merge_needs_two_uplinks')
  }, 180000)
})

describe('The tools follow the HLD rules', () => {
  it('Architect only; out of scope 404; a submitted HLD is locked; a frozen one needs a change request, on whose branch the tools work and show in its impact', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    p.hld = `${p.base}/hld`
    const h = helpers(p)
    const be = await h.uplink('border', 'edge')
    // Frozen by the Solution Package approval.
    expect(expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/break`, { reason: 'x' }), 409).body.error.code).toBe('change_request_required')
    // Not an Architect.
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/break`, { reason: 'x' }, p.fe), 403)
    expectStatus(await h.tool(`${p.hld}/uplinks/${be.id}/reroute`, { viaPatchPanel: true }, p.admin.agent), 403)
    // Out of scope: an Architect scoped to B002 does not see B001's uplink.
    const scoped = await projectMember(ctx, p.admin, { email: 'architect-b002@example.com', role: 'architect', projectId: p.projectId, scopes: [{ type: 'building', refId: p.building('B002').id }] })
    expectStatus(await scoped.post(`${p.hld}/uplinks/${be.id}/break`).send({ reason: 'x', baseRevision: 0 }), 404)

    // On a change request's branch: the tool works there and the change shows in its impact.
    const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Rework the core uplink', reason: 'Design review' }), 201).body.changeRequest
    const b = helpers(p, cr.branchId)
    const onBranch = await b.uplink('border', 'edge')
    expectStatus(await b.tool(`${p.hld}/uplinks/${onBranch.id}/break`, { reason: 'Replaced by a new route' }), 200)
    expect((await b.view()).archivedUplinks.map((a) => a.reason)).toEqual(['Replaced by a new route'])
    // The main HLD is untouched.
    expect((await h.view()).connections.map((c) => c.id)).toContain(be.id)
    const impact = (await p.admin.agent.get(`${p.base}/change-requests/${cr.id}`).expect(200)).body.changeRequest.impact
    expect(JSON.stringify(impact.design.hld)).toContain(be.id)
  }, 300000)

  it('a submitted HLD refuses every tool until it is decided', async () => {
    const p = await generated()
    const h = helpers(p)
    expectStatus(await h.write('post', `${p.hld}/submit`, { buildingId: p.b001 }), 201)
    const be = await h.uplink('border', 'edge')
    const edge = await h.device('edge')
    for (const [url, body] of [
      [`${p.hld}/uplinks/${be.id}/break`, { reason: 'x' }],
      [`${p.hld}/uplinks/${be.id}/reroute`, { viaPatchPanel: true }],
      [`${p.hld}/uplinks/${be.id}/replace-endpoint`, { end: 'dest', deviceId: edge.id }],
      [`${p.hld}/uplinks/${be.id}/split`, { newDevice: { role: 'distribution', roomId: p.rooms.main.id } }],
      [`${p.hld}/devices/${edge.id}/merge`, {}],
    ]) {
      expect(expectStatus(await h.tool(url, body), 409).body.error.code, url).toBe('hld_submitted')
    }
  }, 180000)
})
