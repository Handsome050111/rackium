import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const buildingParam = z.object({ buildingId: hex })
const roomParam = z.object({ roomId: hex })
const rackParam = z.object({ rackId: hex })
const pathwayParam = z.object({ pathwayId: hex })
const ruStateParam = z.object({ rackId: hex, stateId: hex })
const tabQuery = z.object({ tab: z.string().trim().min(1).max(80) })
const serialQuery = z.object({ buildingId: z.string().regex(/^[a-f0-9]{24}$/), serial: z.string().trim().min(1).max(120) })

// Roles for routes whose rules live in the service (who may edit which
// field, reserve vs block); also what audit entries record as the actor's role.
const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/survey (brief v2.3 §5.2). Every route
// checks the caller's membership scope for the building it touches.
export function surveyRoutes({ config, survey }) {
  const { structure, racks, forms } = survey
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const editStructure = requireAction(ACTIONS.EDIT_SITE_STRUCTURE)
  const fillSurvey = requireAction(ACTIONS.FILL_SURVEY_UPLOAD_PHOTOS)

  // --- Site structure ---
  r.get('/buildings/:buildingId/structure', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await structure.building(req, req.input.params.buildingId))
  })
  r.get('/buildings/:buildingId/campus-structure', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await structure.campus(req, req.input.params.buildingId))
  })
  r.post('/floors', ...base, editStructure, validate({ body: C.floorCreateBody }), async (req, res) => {
    res.status(201).json({ floor: await structure.createFloor(req, req.input.body, actorOf(req)) })
  })
  r.post('/rooms', ...base, editStructure, validate({ body: C.surveyRoomCreateBody }), async (req, res) => {
    res.status(201).json({ room: await structure.createRoom(req, req.input.body, actorOf(req)) })
  })
  r.post('/racks', ...base, editStructure, validate({ body: C.surveyRackCreateBody }), async (req, res) => {
    res.status(201).json({ rack: await structure.createRack(req, req.input.body, actorOf(req)) })
  })
  r.patch('/rooms/:roomId/survey', ...base, editStructure, validate({ params: roomParam, body: C.roomSurveyBody }), async (req, res) => {
    res.json({ room: await structure.updateRoomSurvey(req, req.input.params.roomId, req.input.body, actorOf(req)) })
  })

  // --- Pathways (room-to-room routes, also across buildings) ---
  r.get('/pathways', ...base, async (req, res) => {
    res.json({ pathways: await structure.allPathways() })
  })
  r.post('/pathways', ...base, editStructure, validate({ body: C.pathwayCreateBody }), async (req, res) => {
    res.status(201).json({ pathway: await structure.createPathway(req, req.input.body, actorOf(req)) })
  })
  r.patch('/pathways/:pathwayId', ...base, editStructure, validate({ params: pathwayParam, body: C.pathwayUpdateBody }), async (req, res) => {
    res.json({ pathway: await structure.updatePathway(req, req.input.params.pathwayId, req.input.body, actorOf(req)) })
  })
  r.delete('/pathways/:pathwayId', ...base, editStructure, validate({ params: pathwayParam }), async (req, res) => {
    res.json(await structure.deletePathway(req, req.input.params.pathwayId, actorOf(req)))
  })

  // --- Rack survey ---
  r.get('/racks/:rackId', ...base, validate({ params: rackParam }), async (req, res) => {
    res.json(await racks.get(req, req.input.params.rackId))
  })
  r.patch('/racks/:rackId/placements', ...base, fillSurvey, validate({ params: rackParam, body: C.rackPlacementsBody }), async (req, res) => {
    await racks.savePlacements(req, req.input.params.rackId, req.input.body.placements, actorOf(req))
    res.json(await racks.get(req, req.input.params.rackId))
  })
  r.post('/racks/:rackId/versions', ...base, fillSurvey, validate({ params: rackParam }), async (req, res) => {
    res.status(201).json(await racks.saveVersion(req, req.input.params.rackId, actorOf(req)))
  })
  r.patch('/racks/:rackId/facts', ...base, editStructure, validate({ params: rackParam, body: C.rackFactsBody }), async (req, res) => {
    res.json({ meta: await racks.updateFacts(req, req.input.params.rackId, req.input.body, actorOf(req)) })
  })
  r.post('/racks/:rackId/ru-states', ...base, validate({ params: rackParam, body: C.ruStateBody }), async (req, res) => {
    res.status(201).json({ ruState: await racks.setRuState(req, req.input.params.rackId, req.input.body, actorOf(req)) })
  })
  r.delete('/racks/:rackId/ru-states/:stateId', ...base, validate({ params: ruStateParam }), async (req, res) => {
    res.json(await racks.releaseRuState(req, req.input.params.rackId, req.input.params.stateId, actorOf(req)))
  })

  // --- Survey forms ---
  r.get('/records', ...base, validate({ query: C.surveyRecordQuery }), async (req, res) => {
    res.json({ record: await forms.get(req, { ...req.input.query, roomId: req.input.query.roomId ?? null }) })
  })
  r.post('/records/edits', ...base, validate({ body: C.surveyEditBody }), async (req, res) => {
    const result = await forms.applyEdit(req, req.input.body, actorOf(req))
    res.json({ result, record: await forms.get(req, req.input.body) })
  })
  r.post('/records/transitions', ...base, validate({ body: C.surveyTransitionBody }), async (req, res) => {
    res.json({ record: await forms.transition(req, req.input.body, actorOf(req)) })
  })
  r.get('/buildings/:buildingId/progress', ...base, validate({ params: buildingParam }), async (req, res) => {
    res.json(await forms.progress(req, req.input.params.buildingId))
  })
  r.post('/import', ...base, requireAction(ACTIONS.IMPORT_SURVEY_INTO_HLD), validate({ body: C.surveyImportBody }), async (req, res) => {
    res.json(await forms.importBuilding(req, req.input.body.buildingId, actorOf(req)))
  })
  r.get('/serials/check', ...base, validate({ query: serialQuery }), async (req, res) => {
    res.json(await forms.checkSerial(req, req.input.query.buildingId, req.input.query.serial))
  })
  r.get('/custom-fields', ...base, validate({ query: tabQuery }), async (req, res) => {
    res.json({ customFields: await forms.customFields(req.input.query.tab) })
  })
  r.post('/custom-fields', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), validate({ body: C.surveyCustomFieldBody }), async (req, res) => {
    res.status(201).json({ customField: await forms.addCustomField(req, req.input.body, actorOf(req)) })
  })
  r.post('/sync', ...base, validate({ body: C.surveySyncBody }), async (req, res) => {
    res.json(await forms.sync(req, req.input.body.edits, actorOf(req)))
  })

  return r
}
