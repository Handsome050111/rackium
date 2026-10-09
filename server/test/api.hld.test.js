import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { hldProject, hldView, markSurveyVerified } from './helpers/hld.js'
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
const count = (name) => mongoose.connection.db.collection(name).countDocuments()

// Generates the M preset (Fusion + Border in TR-EG-01; Edge + AP in TR-EG-02).
async function generated(opts, existing = null) {
  const p = existing ?? (await hldProject(t(), opts))
  const v0 = await hldView(p.architect, p)
  await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: v0.design.revision }).expect(201)
  const view = await hldView(p.architect, p)
  const byRole = (role) => view.devices.find((d) => d.role === role)
  const uplink = (a, b) => view.connections.find((c) => (c.source.deviceId === byRole(a).id && c.dest.deviceId === byRole(b).id) || (c.source.deviceId === byRole(b).id && c.dest.deviceId === byRole(a).id))
  return { p, view, byRole, uplink }
}
const rev = async (p) => (await hldView(p.architect, p)).design.revision
// A design write with the current revision, read before the request is built.
async function save(p, method, url, body, agent = p.architect) {
  const baseRevision = await rev(p)
  return agent[method](url).send({ ...body, baseRevision })
}
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}

describe('Generate HLD (blueprint + verified survey)', () => {
  it('needs a verified survey; fills the preset with hostnames, optics and surveyed lengths; adds only what is missing', async () => {
    const unverified = await hldProject(t(), { verify: false })
    const refused = await unverified.architect.post(`${unverified.hld}/generate`).send({ buildingId: unverified.b001, preset: 'M', baseRevision: 0 }).expect(409)
    expect(refused.body.error.code).toBe('survey_not_verified')

    await markSurveyVerified(unverified, unverified.b001, [unverified.rooms.main.id, unverified.rooms.second.id])
    const { p, view, byRole, uplink } = await generated(null, unverified)
    expect(view.devices.map((d) => d.hostname).sort()).toEqual(['A-DE-ERL-C01-B001-EG-001', 'B-DE-ERL-C01-B001-EG-001', 'E-DE-ERL-C01-B001-EG-001', 'F-DE-ERL-C01-B001-EG-001'])
    expect(byRole('edge')).toMatchObject({ catalogueKey: 'Cisco C9300-48UX', roomId: p.rooms.second.id, psuConfigured: 2 })
    // Cross-room: OS2 with LR optics, length from the 42 m surveyed pathway (+2 m slack).
    expect(uplink('border', 'edge')).toMatchObject({ media: 'os2', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-LR', length: { lengthM: 44, lengthEstimated: false, suggestedM: 50 } })
    expect(uplink('border', 'fusion')).toMatchObject({ media: 'om4', sourceSfpCode: 'Cisco SFP-10G-SR' })
    expect(uplink('edge', 'ap')).toMatchObject({ media: 'cat6a', speed: '1G', sourceSfpCode: null })
    expect(view.status).toBe('in_progress')

    const again = (await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: view.design.revision }).expect(201)).body
    expect(again).toEqual({ added: { devices: 0, uplinks: 0 }, revision: view.design.revision })
    // Moving up to L adds Distribution between Border and the Edge's floor.
    const l = (await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'L', baseRevision: view.design.revision }).expect(201)).body
    expect(l.added.devices).toBe(1)
  })

  // AC-11 (brief v2.3 §8.2), on the real backend.
  it('AC-11: Template M with redundant distribution produces correct device count, connections and rack assignments', async () => {
    const p = await hldProject(t(), { mainRacks: 2 })
    const [mainR01, secondR01, mainR02] = p.racks.map((r) => r.id)
    expectStatus(await save(p, 'post', `${p.hld}/generate`, { buildingId: p.b001, preset: 'M', variant: 'redundant_distribution' }), 201)
    const view = await hldView(p.architect, p)
    expect(view.design).toMatchObject({ preset: 'M', variant: 'redundant_distribution' })
    const of = (role) => view.devices.filter((d) => d.role === role)
    // Devices: Fusion, Border, a Distribution pair (main room); Edge + AP (the comms room).
    expect(view.devices.map((d) => d.role).sort()).toEqual(['ap', 'border', 'distribution', 'distribution', 'edge', 'fusion'])
    expect(of('distribution').map((d) => d.hostname).sort()).toEqual(['D-DE-ERL-C01-B001-EG-001', 'D-DE-ERL-C01-B001-EG-002'])
    // Connections: Border–Fusion, each Distribution to Border and Fusion, the Edge to both Distributions, AP to Edge = 8.
    expect(view.connections).toHaveLength(8)
    const links = (a, b) => view.connections.filter((c) => (c.source.deviceId === a.id && c.dest.deviceId === b.id) || (c.source.deviceId === b.id && c.dest.deviceId === a.id))
    for (const dist of of('distribution')) {
      expect(links(dist, of('border')[0])).toHaveLength(1)
      expect(links(dist, of('fusion')[0])).toHaveLength(1)
      expect(links(dist, of('edge')[0])).toEqual([expect.objectContaining({ media: 'os2', sourceSfpCode: 'Cisco SFP-10G-LR', length: expect.objectContaining({ lengthM: 44 }) })])
    }
    expect(links(of('border')[0], of('edge')[0])).toHaveLength(0)
    // Racks: core in the main room's first rack, the pair split over its two racks, the Edge in its room's rack, the AP unracked.
    expect(of('border')[0].rackId).toBe(mainR01)
    expect(of('fusion')[0].rackId).toBe(mainR01)
    expect(of('distribution').map((d) => d.rackId).sort()).toEqual([mainR01, mainR02].sort())
    expect(of('edge')[0].rackId).toBe(secondR01)
    expect(of('ap')[0].rackId).toBeNull()
    // A generated design with powered racks has no Critical finding.
    expect((await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).expect(200)).body.summary.critical).toBe(0)
  })

  it('a size/variant pair that does not exist is refused', async () => {
    const p = await hldProject(t())
    const res = await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'S', variant: 'redundant_distribution', baseRevision: 0 }).expect(400)
    expect(JSON.stringify(res.body.error)).toMatch(/no Redundant distribution variant/)
  })

  it('only the Architect edits; every project member reads; scope and organisation are enforced', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    for (const agent of [p.fe, p.viewer, p.reviewer, p.admin.agent]) {
      await agent.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: 0 }).expect(403)
      await hldView(agent, p)
    }
    await p.feB001.get(`${p.hld}/buildings/${p.building('B002').id}`).expect(404)
    await p.feB001.get(`${p.hld}/buildings/${p.b001}`).expect(200)
    const outsider = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other' })
    await outsider.agent.get(`${p.hld}/buildings/${p.b001}`).expect(404)
  })
})

describe('Stale saves (brief §6.10)', () => {
  it('a write based on an older revision is refused and names who changed it', async () => {
    const { p, view, byRole } = await generated()
    await p.architect.patch(`${p.hld}/devices/${byRole('edge').id}`).send({ psuConfigured: 1, baseRevision: view.design.revision }).expect(200)
    const stale = await p.architect.patch(`${p.hld}/devices/${byRole('edge').id}`).send({ psuConfigured: 2, baseRevision: view.design.revision }).expect(409)
    expect(stale.body.error).toMatchObject({ code: 'stale_revision', details: { revision: view.design.revision + 1, lastEditedBy: 'architect' } })
    expect(stale.body.error.message).toMatch(/changed by architect since you loaded it/)
    // Moving a box is not a design change: no revision, no staleness.
    await p.architect.put(`${p.hld}/devices/${byRole('edge').id}/position`).send({ x: 12, y: 40 }).expect(200)
    const after = await hldView(p.architect, p)
    expect(after.design.revision).toBe(view.design.revision + 1)
    expect(after.devices.find((d) => d.role === 'edge').position).toEqual({ x: 12, y: 40 })
    await p.viewer.put(`${p.hld}/devices/${byRole('edge').id}/position`).send({ x: 1, y: 1 }).expect(403)
  })
})

describe('Uplinks: ports and cable IDs are registered in the same transaction', () => {
  it('a port already in use is refused and nothing is written; ports must exist on the model', async () => {
    const { p, byRole } = await generated()
    const base = { buildingId: p.b001, media: 'om4', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-10G-SR' }
    const first = await expectStatus(await save(p, 'post', `${p.hld}/uplinks`, { ...base, source: { deviceId: byRole('border').id, portId: 'te1/1/5' }, dest: { deviceId: byRole('fusion').id, portId: 'Te1/1/5' } }, p.architect), 201)
    expect(first.body.uplink.source.portId).toBe('Te1/1/5') // the model's own spelling
    const before = { connections: await count('connections'), ports: await count('portoccupancies') }
    const clash = await expectStatus(await save(p, 'post', `${p.hld}/uplinks`, { ...base, source: { deviceId: byRole('border').id, portId: 'Te1/1/6' }, dest: { deviceId: byRole('fusion').id, portId: 'TE1/1/5' } }, p.architect), 409)
    expect(clash.body.error).toMatchObject({ code: 'port_in_use' })
    expect(clash.body.error.message).toMatch(/Te1\/1\/5 on F-DE-ERL-C01-B001-EG-001/)
    expect({ connections: await count('connections'), ports: await count('portoccupancies') }).toEqual(before)
    await expectStatus(await save(p, 'post', `${p.hld}/uplinks`, { ...base, source: { deviceId: byRole('border').id, portId: 'Gi9/9/9' }, dest: { deviceId: byRole('fusion').id } }, p.architect), 400)

    // Moving the uplink to another port frees the old one.
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${first.body.uplink.id}`, { dest: { deviceId: byRole('fusion').id, portId: 'Te1/1/7' } }, p.architect), 200)
    await expectStatus(await save(p, 'post', `${p.hld}/uplinks`, { ...base, source: { deviceId: byRole('border').id, portId: 'Te1/1/8' }, dest: { deviceId: byRole('fusion').id, portId: 'Te1/1/5' } }, p.architect), 201)
  })

  it('cable IDs are unique in any letter case and never reused after deletion', async () => {
    const { p, view, byRole, uplink } = await generated()
    await p.architect.patch(`${p.hld}/uplinks/${uplink('border', 'edge').id}`).send({ cableId: 'CBL-001', baseRevision: view.design.revision }).expect(200)
    const dup = await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('border', 'fusion').id}`, { cableId: 'cbl-001' }, p.architect), 409)
    expect(dup.body.error.code).toBe('cable_id_in_use')
    await p.architect.delete(`${p.hld}/uplinks/${uplink('border', 'edge').id}?baseRevision=${await rev(p)}`).expect(200)
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('border', 'fusion').id}`, { cableId: 'CBL-001' }, p.architect), 409)
    // Deleting a device removes its uplinks and frees their ports.
    await p.architect.delete(`${p.hld}/devices/${byRole('ap').id}?baseRevision=${await rev(p)}`).expect(200)
    const after = await hldView(p.architect, p)
    expect(after.devices.map((d) => d.role).sort()).toEqual(['border', 'edge', 'fusion'])
    expect(after.connections.some((c) => c.dest.deviceId === byRole('ap').id || c.source.deviceId === byRole('ap').id)).toBe(false)
  })
})

describe('Validation engine on the server (VAL-001…013)', () => {
  const rules = (body) => body.findings.map((f) => f.rule)

  it('runs the shared rules on the real design: optics, ports, PSUs, lengths', async () => {
    const { p, uplink, byRole } = await generated()
    const validate = async () => (await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).expect(200)).body
    expect((await validate()).summary).toMatchObject({ critical: 0, blocksSubmit: false })

    // VAL-001: an OM4 optic on the OS2 link.
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('border', 'edge').id}`, { destSfpCode: 'Cisco SFP-10G-SR' }, p.architect), 200)
    // VAL-002: an optic on an RJ45 port.
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('edge', 'ap').id}`, { media: 'om4', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-10G-SR', source: { deviceId: byRole('edge').id, portId: 'Gi1/0/1' } }, p.architect), 200)
    // VAL-005: the Border's model (C9500) is flagged requiresDualPsu in the catalogue; one PSU is Critical.
    // The Edge's model (C9300) only supports two: one PSU is a Warning, never VAL-005.
    await expectStatus(await save(p, 'patch', `${p.hld}/devices/${byRole('edge').id}`, { psuConfigured: 1 }, p.architect), 200)
    await expectStatus(await save(p, 'patch', `${p.hld}/devices/${byRole('border').id}`, { psuConfigured: 1 }, p.architect), 200)
    const bad = await validate()
    expect(rules(bad)).toEqual(expect.arrayContaining(['VAL-001', 'VAL-002', 'VAL-005']))
    expect(bad.summary.blocksSubmit).toBe(true)
    expect(bad.findings.filter((f) => f.rule === 'VAL-005').map((f) => [f.objectId, f.severity])).toEqual([[byRole('border').id, 'critical']])
    expect(bad.findings.find((f) => f.rule === 'W-SINGLE-PSU')).toMatchObject({ objectId: byRole('edge').id, severity: 'warning' })
    expect(bad.findings.find((f) => f.rule === 'VAL-001')).toMatchObject({ severity: 'critical', objectType: 'connection', objectId: uplink('border', 'edge').id })
  })

  it('VAL-012 and VAL-011 from a long surveyed distance', async () => {
    const far = await generated({ distanceM: 620 })
    const r1 = rules((await far.p.architect.get(`${far.p.hld}/buildings/${far.p.b001}/validation`)).body)
    expect(r1).toContain('VAL-012') // 622 m: no stock OS2 length that long
    await expectStatus(await save(far.p, 'patch', `${far.p.hld}/uplinks/${far.uplink('border', 'edge').id}`, { media: 'om4', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-10G-SR' }, far.p.architect), 200)
    expect(rules((await far.p.architect.get(`${far.p.hld}/buildings/${far.p.b001}/validation`)).body)).toContain('VAL-011') // over the 400 m OM4 reach
  })

  it('VAL-008: within 90% of the optic reach', async () => {
    const near = await generated({ distanceM: 360 })
    await expectStatus(await save(near.p, 'patch', `${near.p.hld}/uplinks/${near.uplink('border', 'edge').id}`, { media: 'om4', sourceSfpCode: 'Cisco SFP-10G-SR', destSfpCode: 'Cisco SFP-10G-SR' }, near.p.architect), 200)
    expect(rules((await near.p.architect.get(`${near.p.hld}/buildings/${near.p.b001}/validation`)).body)).toContain('VAL-008') // 362 m ≥ 90% of 400 m (360 m)
  })

  it('an unsurveyed route is Info and does not block', async () => {
    const unsurveyed = await generated({ distanceM: null })
    const findings = (await unsurveyed.p.architect.get(`${unsurveyed.p.hld}/buildings/${unsurveyed.p.b001}/validation`)).body
    expect(findings.findings.find((f) => f.rule === 'I-ESTIMATED-PATH')).toMatchObject({ severity: 'info' })
    expect(findings.summary.blocksSubmit).toBe(false)
  })

  it('VAL-003: a planned device in a suggested rack with no PDU is Critical', async () => {
    const { p, byRole } = await generated({ pdus: false })
    const body = (await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).expect(200)).body
    expect(body.findings.filter((f) => f.rule === 'VAL-003').map((f) => f.objectId).sort()).toEqual([byRole('border').id, byRole('fusion').id, byRole('edge').id].sort())
    expect(body.summary.blocksSubmit).toBe(true)
  })

  it('Edit Uplink step 4 checks a draft with the same rules', async () => {
    const { p, byRole } = await generated()
    const draft = { buildingId: p.b001, source: { deviceId: byRole('border').id }, dest: { deviceId: byRole('edge').id }, media: 'os2', speed: '10G', sourceSfpCode: 'Cisco SFP-10G-LR', destSfpCode: 'Cisco SFP-10G-SR' }
    const res = (await p.architect.post(`${p.hld}/uplinks/check`).send(draft).expect(200)).body
    expect(res.blocked).toBe(true)
    expect(res.checks.find((c) => c.id === 'sfp-compatibility')).toMatchObject({ status: 'fail' })
    expect(res.length).toMatchObject({ lengthM: 44 })
    const ok = (await p.architect.post(`${p.hld}/uplinks/check`).send({ ...draft, destSfpCode: 'Cisco SFP-10G-LR' }).expect(200)).body
    expect(ok.blocked).toBe(false)
  })
})

describe('Workflow and approvals (generic Approval record)', () => {
  it('Critical blocks submit; submit locks edits; PM/Reviewer decide with a comment for changes; approval freezes the version', async () => {
    const { p, uplink } = await generated()
    // Blocked by a Critical finding, then fixed.
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('border', 'edge').id}`, { destSfpCode: 'Cisco SFP-10G-SR' }, p.architect), 200)
    const blocked = await expectStatus(await save(p, 'post', `${p.hld}/submit`, { buildingId: p.b001 }, p.architect), 409)
    expect(blocked.body.error).toMatchObject({ code: 'validation_blocked', details: { summary: { critical: 1 } } })
    await expectStatus(await save(p, 'patch', `${p.hld}/uplinks/${uplink('border', 'edge').id}`, { destSfpCode: 'Cisco SFP-10G-LR' }, p.architect), 200)

    await expectStatus(await save(p, 'post', `${p.hld}/submit`, { buildingId: p.b001 }, p.reviewer), 403)
    const submitted = (await expectStatus(await save(p, 'post', `${p.hld}/submit`, { buildingId: p.b001 }, p.architect), 201)).body
    expect(submitted.versionNumber).toBe(1)
    let view = await hldView(p.viewer, p)
    expect(view).toMatchObject({ status: 'awaiting_approval', design: { state: 'awaiting_approval' }, approvals: [{ status: 'pending', versionNumber: 1, submittedBy: 'architect' }] })
    // Locked while awaiting a decision.
    const locked = await p.architect.patch(`${p.hld}/uplinks/${uplink('border', 'edge').id}`).send({ cableId: 'X-1', baseRevision: view.design.revision }).expect(409)
    expect(locked.body.error.code).toBe('hld_submitted')

    // The Architect cannot approve; nor can a Field Engineer. Changes need a comment.
    await p.architect.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(403)
    await p.fe.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(403)
    await p.reviewer.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested' }).expect(400)
    await p.reviewer.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'changes_requested', comment: 'Add a second uplink to the Edge' }).expect(200)
    view = await hldView(p.architect, p)
    expect(view).toMatchObject({ status: 'changes_requested', approvals: [{ status: 'changes_requested', decision: { value: 'changes_requested', comments: 'Add a second uplink to the Edge', decidedBy: 'reviewer' } }] })

    // Fix, resubmit (v2), the PM approves: version frozen, phase approved on the dashboard.
    await p.architect.patch(`${p.hld}/uplinks/${uplink('border', 'edge').id}`).send({ cableId: 'CBL-BE-1', baseRevision: view.design.revision }).expect(200)
    expect((await expectStatus(await save(p, 'post', `${p.hld}/submit`, { buildingId: p.b001 }, p.architect), 201)).body.versionNumber).toBe(2)
    await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
    view = await hldView(p.architect, p)
    expect(view.status).toBe('approved')
    expect(view.versions.map((v) => [v.number, v.frozen])).toEqual([
      [2, true],
      [1, false],
    ])
    const dash = (await p.admin.agent.get(`${p.base}/dashboard/buildings/${p.b001}`).expect(200)).body
    expect(dash.phases.find((x) => x.phaseKey === 'hld').status).toBe('approved')
    // The snapshot is a real, authorised file.
    const snap = await p.viewer.get(`${p.base}/files/${view.versions[0].snapshotFileId}/content`).buffer(true).parse((res, cb) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => cb(null, data))
    }).expect(200)
    expect(JSON.parse(snap.body)).toMatchObject({ designType: 'hld', building: { code: 'B001' }, devices: expect.any(Array) })
    await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(409)

    // An edit after approval starts a new draft; the approved version stays frozen.
    await p.architect.put(`${p.hld}/devices/${view.devices[0].id}/position`).send({ x: 1, y: 1 }).expect(200)
    expect((await hldView(p.architect, p)).status).toBe('approved') // moving is not a design change
    await p.architect.patch(`${p.hld}/uplinks/${uplink('border', 'edge').id}`).send({ cableId: 'CBL-BE-2', baseRevision: view.design.revision }).expect(200)
    view = await hldView(p.architect, p)
    expect(view.status).toBe('in_progress')
    expect(view.versions[0].frozen).toBe(true)
  })

  it('nobody decides on their own submission, even holding an approver role', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    const v0 = await hldView(p.architect, p)
    await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'S', baseRevision: v0.design.revision }).expect(201)
    await expectStatus(await save(p, 'post', `${p.hld}/submit`, { buildingId: p.b001 }, p.architect), 201)
    // The submitting Architect becomes a Reviewer — still not on their own submission.
    const members = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/members`).expect(200)).body.members
    const membership = members.find((m) => m.level === 'project' && m.user?.email === 'architect@example.com')
    await p.admin.agent.patch(`/api/v1/orgs/${p.admin.orgId}/memberships/${membership.id}`).send({ role: 'reviewer' }).expect(200)
    const own = await p.architect.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(403)
    expect(own.body.error.message).toMatch(/You submitted this HLD/)
    await p.reviewer.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
  })
})

describe('Survey changed after import', () => {
  it('the HLD shows each open flag with what changed and who changed it', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    const target = { buildingId: p.b001, roomId: null, tab: 'Storage Area' }
    // Make that tab really filled, then import the (verified) building.
    await p.architect.post(`${p.base}/survey/import`).send({ buildingId: p.b001 }).expect(200)
    await p.fe.post(`${p.base}/survey/records/edits`).send({ ...target, op: { kind: 'setField', sectionIndex: 0, key: 'staging_space', value: 'Basement 2' }, baseLastModifiedAt: null }).expect(200)
    const view = await hldView(p.reviewer, p)
    expect(view.surveyChanges).toEqual([
      expect.objectContaining({ tab: 'Storage Area', roomCode: null, changes: [expect.objectContaining({ field: 'staging_space', before: null, after: 'Basement 2', changedBy: 'field_engineer' })] }),
    ])
  })
})

describe('Naming: role codes are an organisation setting', () => {
  it('defaults with proposed codes; the Org Admin changes them; clashes are refused; new devices use them', async () => {
    const { p, view } = await generated()
    const settings = `/api/v1/orgs/${p.admin.orgId}/settings`
    const lib = (await p.architect.get(`${p.hld}/library`).expect(200)).body
    expect(lib.roles.find((r) => r.role === 'firewall')).toMatchObject({ code: 'FW', codeProposed: true, defaultModel: 'Generic Firewall 1U' })
    expect(lib.roles.find((r) => r.role === 'wan_circuit')).toMatchObject({ code: null })
    await p.architect.patch(settings).send({ namingRoleCodes: { firewall: 'FWL' } }).expect(403)
    await p.admin.agent.patch(settings).send({ namingRoleCodes: { router: 'E' } }).expect(400)
    const updated = (await p.admin.agent.patch(settings).send({ namingRoleCodes: { firewall: 'fwl' } }).expect(200)).body.settings
    expect(updated.namingRoleCodes).toMatchObject({ firewall: 'FWL', edge: 'E' })

    const fw = (await p.architect.post(`${p.hld}/devices`).send({ buildingId: p.b001, role: 'firewall', roomId: p.rooms.main.id, baseRevision: view.design.revision }).expect(201)).body.device
    expect(fw).toMatchObject({ hostname: 'FWL-DE-ERL-C01-B001-EG-001', catalogueKey: 'Generic Firewall 1U', category: 'firewall' })
    const wan = (await expectStatus(await save(p, 'post', `${p.hld}/devices`, { buildingId: p.b001, role: 'wan_circuit', roomId: p.rooms.main.id }, p.architect), 201)).body.device
    expect(wan).toMatchObject({ hostname: null, label: 'WAN/SP connection' })
    await expectStatus(await save(p, 'post', `${p.hld}/devices`, { buildingId: p.b001, role: 'firewall', roomId: p.rooms.main.id, catalogueKey: 'Cisco C9500' }, p.architect), 400)
  })
})

describe('Isolation', () => {
  it('another project of the same organisation cannot reach this HLD’s devices or uplinks', async () => {
    const ctx = t()
    const { p, byRole, uplink } = await generated(null, await hldProject(ctx))
    const other = (await p.admin.agent.post(`/api/v1/orgs/${p.admin.orgId}/projects`).send({ name: 'Other', code: 'OTH' }).expect(201)).body.project.id
    const otherBase = `/api/v1/orgs/${p.admin.orgId}/projects/${other}/hld`
    const arch = await projectMember(ctx, p.admin, { email: 'arch2@example.com', role: 'architect', projectId: other })
    await arch.patch(`${otherBase}/devices/${byRole('edge').id}`).send({ psuConfigured: 1, baseRevision: 0 }).expect(404)
    await arch.patch(`${otherBase}/uplinks/${uplink('border', 'edge').id}`).send({ cableId: 'X', baseRevision: 0 }).expect(404)
    await arch.get(`${otherBase}/buildings/${p.b001}`).expect(404)
  })
})
