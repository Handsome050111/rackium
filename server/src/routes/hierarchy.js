import { recordingRouter } from '../http/routeRecorder.js'
import { z } from 'zod'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) })

// Country/SAL/Campus/Building/Wing are planning-level (Org Admin, PM).
// Floor/Room/Rack also allow the Architect, who pre-creates them for design
// (brief v2.3 §4.1; Field Engineer creation arrives with the survey in M3).
const TOP = ACTIONS.MANAGE_HIERARCHY_TOP
const DETAIL = ACTIONS.MANAGE_HIERARCHY_DETAIL

// Every route sits under /orgs/:orgId/projects/:projectId/hierarchy.
export function hierarchyRoutes({ config, hierarchy }) {
  const r = recordingRouter({ mergeParams: true })
  // applyViewAs runs on every route here (not just reads): a write attempted
  // while a View As session is active must 403 even if the real actor (an
  // Org Admin) would otherwise have permission — View As is view-only.
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]

  r.get('/', ...base, async (req, res) => {
    res.json({ tree: await hierarchy.listTree() })
  })

  function entity(path, { createBody, updateBody, action, create, update, del }) {
    r.post(`/${path}`, ...base, requireAction(action), validate({ body: createBody }), async (req, res) => {
      const result = await create({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req), body: req.input.body })
      res.status(201).json({ [path]: result })
    })
    if (update) {
      r.patch(`/${path}/:id`, ...base, requireAction(action), validate({ params: idParam, body: updateBody }), async (req, res) => {
        const result = await update({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req), id: req.input.params.id, body: req.input.body })
        res.json({ [path]: result })
      })
    }
    r.delete(`/${path}/:id`, ...base, requireAction(action), validate({ params: idParam }), async (req, res) => {
      res.json(await del({ id: req.input.params.id }))
    })
  }

  entity('countries', { createBody: C.countryCreateBody, updateBody: C.countryUpdateBody, action: TOP, create: hierarchy.createCountry, update: hierarchy.updateCountry, del: hierarchy.deleteCountry })
  entity('sals', { createBody: C.salCreateBody, action: TOP, create: hierarchy.createSal, del: hierarchy.deleteSal })
  entity('campuses', { createBody: C.campusCreateBody, action: TOP, create: hierarchy.createCampus, del: hierarchy.deleteCampus })
  entity('buildings', { createBody: C.buildingCreateBody, updateBody: C.buildingUpdateBody, action: TOP, create: hierarchy.createBuilding, update: hierarchy.updateBuilding, del: hierarchy.deleteBuilding })
  entity('wings', { createBody: C.wingCreateBody, action: TOP, create: hierarchy.createWing, del: hierarchy.deleteWing })
  entity('floors', { createBody: C.floorCreateBody, updateBody: C.floorUpdateBody, action: DETAIL, create: hierarchy.createFloor, update: hierarchy.updateFloor, del: hierarchy.deleteFloor })
  entity('rooms', { createBody: C.roomCreateBody, updateBody: C.roomUpdateBody, action: DETAIL, create: hierarchy.createRoom, update: hierarchy.updateRoom, del: hierarchy.deleteRoom })
  entity('racks', { createBody: C.rackCreateBody, updateBody: C.rackUpdateBody, action: DETAIL, create: hierarchy.createRack, update: hierarchy.updateRack, del: hierarchy.deleteRack })

  r.post('/import', ...base, requireAction(TOP), validate({ body: C.hierarchyImportBody }), async (req, res) => {
    const result = await hierarchy.bulkImport({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req), rows: req.input.body.rows })
    res.status(201).json({ imported: result })
  })

  return r
}
