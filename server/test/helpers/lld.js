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
