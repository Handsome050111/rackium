import { hldProject, markSurveyVerified } from './hld.js'
import { roomWithRack } from './survey.js'

// An HLD project (helpers/hld.js) with the LLD phase active and the HLD of
// B001 generated (preset M: Fusion + Border in the main room's rack, Edge +
// AP in the second room) and approved by the PM — what the LLD starts from.
export async function lldProject(ctx, opts) {
  const p = await hldProject(ctx, opts)
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld'] }).expect(200)
  p.lld = `${p.base}/lld`
  await approveHld(p, p.b001)
  return p
}

// Generates (if empty), submits and approves a building's HLD.
export async function approveHld(p, buildingId, preset = 'M') {
  const view = async () => (await p.architect.get(`${p.hld}/buildings/${buildingId}`).expect(200)).body
  let v = await view()
  if (!v.devices.some((d) => d.origin === 'planned')) {
    await p.architect.post(`${p.hld}/generate`).send({ buildingId, preset, baseRevision: v.design.revision }).expect(201)
    v = await view()
  }
  const submitted = await p.architect.post(`${p.hld}/submit`).send({ buildingId, baseRevision: v.design.revision })
  if (submitted.status !== 201) throw new Error(`HLD submit failed: ${JSON.stringify(submitted.body)}`)
  await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId, decision: 'approved' }).expect(200)
}

// B002 prepared like B001 (two powered rooms, a surveyed pathway, verified
// survey) with an approved HLD and a started LLD.
export async function secondBuilding(p) {
  const id = p.building('B002').id
  const first = await roomWithRack(p.fe, p.base, id)
  const second = (await p.fe.post(`${p.base}/survey/rooms`).send({ floorId: first.floor.id }).expect(201)).body.room
  const racks = [first.rack, (await p.fe.post(`${p.base}/survey/racks`).send({ roomId: second.id }).expect(201)).body.rack]
  for (const rack of racks) {
    await p.fe
      .patch(`${p.base}/survey/racks/${rack.id}/placements`)
      .send({ placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] })
      .expect(200)
  }
  await p.architect.post(`${p.base}/survey/pathways`).send({ fromRoomId: first.room.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 30 }).expect(201)
  await markSurveyVerified(p, id, [first.room.id, second.id])
  await approveHld(p, id)
  await p.architect.post(`${p.lld}/start`).send({ buildingId: id }).expect(201)
  return id
}

export async function lldView(agent, p, buildingId = p.b001, branchId = null) {
  return (await agent.get(`${p.lld}/buildings/${buildingId}${branchId ? `?branchId=${branchId}` : ''}`).expect(200)).body
}

export const PANEL = 'Generic Cat6A Patch Panel 24-port'

function expectStatus(res, status) {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`)
  return res
}

export function withDesign(p) {
  const d = {
    p,
    view: (branchId = null, agent = p.architect) => lldView(agent, p, p.b001, branchId),
    rev: async (branchId = null) => (await d.view(branchId)).design.revision,
    // A design write with the current revision, read before the request is built.
    save: async (method, url, body = {}, { agent = p.architect, branchId = null } = {}) => {
      const baseRevision = await d.rev(branchId)
      return agent[method](url).send({ ...body, baseRevision })
    },
    device: async (role, branchId = null) => (await d.view(branchId)).devices.find((x) => x.inDesign && x.role === role),
    link: async (a, b, branchId = null) => {
      const v = await d.view(branchId)
      const id = (role) => v.devices.find((x) => x.inDesign && x.role === role).id
      return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === [id(a), id(b)].sort().join())
    },
  }
  return d
}

// Places Border, Fusion and Edge, adds a patch panel in the Edge's rack and
// fills every port and cable ID: an LLD with no Critical finding.
export async function complete(d) {
  const { p, save, device, link } = d
  const [mainRack, secondRack] = p.racks.map((r) => r.id)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('border')).id}/placement`, { rackId: mainRack, ru: 40, face: 'front' }), 200)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('fusion')).id}/placement`, { rackId: mainRack, ru: 38, face: 'front' }), 200)
  expectStatus(await save('put', `${p.lld}/devices/${(await device('edge')).id}/placement`, { rackId: secondRack, ru: 40, face: 'front' }), 200)
  const panel = (await expectStatus(await save('post', `${p.lld}/devices`, { buildingId: p.b001, catalogueKey: PANEL, rackId: secondRack, ru: 42, face: 'front' }), 201)).body.device
  expectStatus(await save('patch', `${p.lld}/connections/${(await link('border', 'fusion')).id}`, { source: { deviceId: (await device('border')).id, portId: 'Te1/1/1' }, dest: { deviceId: (await device('fusion')).id, portId: 'Te1/1/1' }, cableId: 'C-BF-1' }), 200)
  const be = await link('border', 'edge')
  const borderEnd = be.source.deviceId === (await device('border')).id ? 'source' : 'dest'
  expectStatus(await save('patch', `${p.lld}/connections/${be.id}`, { [borderEnd]: { deviceId: (await device('border')).id, portId: 'Te1/1/2' }, [borderEnd === 'source' ? 'dest' : 'source']: { deviceId: (await device('edge')).id, portId: 'Te1/1/1' }, cableId: 'C-BE-1' }), 200)
  const ea = await link('edge', 'ap')
  const edgeEnd = ea.source.deviceId === (await device('edge')).id ? 'source' : 'dest'
  expectStatus(
    await save('patch', `${p.lld}/connections/${ea.id}`, {
      [edgeEnd]: { deviceId: (await device('edge')).id, portId: 'Gi1/0/1' },
      [edgeEnd === 'source' ? 'dest' : 'source']: { deviceId: (await device('ap')).id, portId: 'Eth0' },
      // One panel between two devices: both patch cords land on its front, on two ports.
      hops: [{ patchPanelId: panel.id, inPort: '01', outPort: '02', segmentCableId: 'C-EA-1b' }],
      cableId: 'C-EA-1',
    }),
    200
  )
  return panel
}

// M5a: B001's LLD completed (no Critical finding), submitted by the Architect
// and approved by the PM — what the BOM, Solution Package and change requests start from.
export async function approvedLld(ctx, opts) {
  const p = await lldProject(ctx, opts)
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom'] }).expect(200)
  await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
  const d = withDesign(p)
  const panel = await complete(d)
  expectStatus(await d.save('post', `${p.lld}/submit`, { buildingId: p.b001 }), 201)
  await p.admin.agent.post(`${p.lld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
  return { ...d, panel }
}
