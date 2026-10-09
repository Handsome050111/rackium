import mongoose from 'mongoose'
import { BUILDING_TABS, ROOM_TABS, SURVEY_TEMPLATE_VERSION } from '@rackium/shared/surveyForm.js'
import { runWithScope } from '../../src/tenancy/scopeContext.js'
import { SurveyTabRecord } from '../../src/models/surveyTabRecord.js'
import { projectMember } from './app.js'
import { surveyProject, roomWithRack, fillTab, transition } from './survey.js'

// A survey project (helpers/survey.js) whose building B001 has two comms
// rooms with racks on floor EG, a surveyed pathway between them and every
// survey tab Verified — what Generate HLD needs. Adds a Reviewer.
export async function hldProject(ctx, { distanceM = 42, verify = true } = {}) {
  const p = await surveyProject(ctx)
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld'] }).expect(200)
  const b001 = p.building('B001').id
  const first = await roomWithRack(p.fe, p.base, b001)
  const second = (await p.fe.post(`${p.base}/survey/rooms`).send({ floorId: first.floor.id }).expect(201)).body.room
  await p.fe.post(`${p.base}/survey/racks`).send({ roomId: second.id }).expect(201)
  if (distanceM != null) {
    await p.architect.post(`${p.base}/survey/pathways`).send({ fromRoomId: first.room.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM }).expect(201)
  }
  if (verify) await markSurveyVerified(p, b001, [first.room.id, second.id])
  p.reviewer = await projectMember(ctx, p.admin, { email: 'reviewer@example.com', role: 'reviewer', projectId: p.projectId })
  p.b001 = b001
  p.rooms = { main: first.room, second }
  p.hld = `${p.base}/hld`
  return p
}

// Marks every survey tab of a building Verified straight in the database —
// the survey workflow has its own tests; HLD tests only need its result.
export async function markSurveyVerified(p, buildingId, roomIds) {
  const now = new Date()
  const docs = [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...roomIds.flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))].map((t) => ({
    buildingId: new mongoose.Types.ObjectId(buildingId),
    roomId: t.roomId ? new mongoose.Types.ObjectId(t.roomId) : null,
    tab: t.tab,
    templateVersion: SURVEY_TEMPLATE_VERSION,
    status: 'verified',
    hasData: true,
    lastModifiedAt: now,
  }))
  await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => SurveyTabRecord.create(docs))
}

export async function verifyBuilding(p, buildingId, roomIds) {
  const targets = [...BUILDING_TABS.map((tab) => ({ buildingId, roomId: null, tab })), ...roomIds.flatMap((roomId) => ROOM_TABS.map((tab) => ({ buildingId, roomId, tab })))]
  for (const target of targets) {
    await fillTab(p.fe, p.base, target)
    await transition(p.fe, p.base, target, 'submit').expect(200)
    await transition(p.architect, p.base, target, 'verify').expect(200)
  }
}

export async function hldView(agent, p, buildingId = p.b001) {
  return (await agent.get(`${p.hld}/buildings/${buildingId}`).expect(200)).body
}
