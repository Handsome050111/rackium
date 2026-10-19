import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const hex = z.string().regex(/^[a-f0-9]{24}$/)
const idParam = z.object({ id: hex })
const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// M7a-1 (brief v2.2 §21): the schedule. Every project member reads it within
// their scope; the Org Admin and PM set targets, milestones, dependencies,
// SLAs, settings and building assignees (DATA-MODEL §5.10 as built).
export function scheduleRoutes({ config, schedule }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const plan = requireAction(ACTIONS.CREATE_BUILDINGS_SET_TARGETS)

  r.get('/', ...base, async (req, res) => {
    res.json(await schedule.view(req))
  })
  r.put('/targets', ...base, plan, validate({ body: C.scheduleTargetsBody }), async (req, res) => {
    res.json(await schedule.setTargets(req, req.input.body, actorOf(req)))
  })
  r.put('/settings', ...base, plan, validate({ body: C.scheduleSettingsBody }), async (req, res) => {
    res.json(await schedule.updateSettings(req, req.input.body, actorOf(req)))
  })
  r.post('/milestones', ...base, plan, validate({ body: C.milestoneCreateBody }), async (req, res) => {
    res.status(201).json(await schedule.addMilestone(req, req.input.body, actorOf(req)))
  })
  r.put('/milestones/standard', ...base, plan, validate({ body: C.standardMilestoneDueBody }), async (req, res) => {
    res.json(await schedule.setStandardDue(req, req.input.body, actorOf(req)))
  })
  r.patch('/milestones/:id', ...base, plan, validate({ params: idParam, body: C.milestoneUpdateBody }), async (req, res) => {
    res.json(await schedule.updateMilestone(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/milestones/:id', ...base, plan, validate({ params: idParam }), async (req, res) => {
    res.json(await schedule.removeMilestone(req, req.input.params.id, actorOf(req)))
  })
  r.post('/dependencies', ...base, plan, validate({ body: C.dependencyCreateBody }), async (req, res) => {
    res.status(201).json(await schedule.addDependency(req, req.input.body, actorOf(req)))
  })
  r.delete('/dependencies/:id', ...base, plan, validate({ params: idParam }), async (req, res) => {
    res.json(await schedule.removeDependency(req, req.input.params.id, actorOf(req)))
  })
  r.post('/slas', ...base, plan, validate({ body: C.slaCreateBody }), async (req, res) => {
    res.status(201).json(await schedule.createSla(req, req.input.body, actorOf(req)))
  })
  r.patch('/slas/:id', ...base, plan, validate({ params: idParam, body: C.slaUpdateBody }), async (req, res) => {
    res.json(await schedule.updateSla(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/slas/:id', ...base, plan, validate({ params: idParam }), async (req, res) => {
    res.json(await schedule.removeSla(req, req.input.params.id, actorOf(req)))
  })
  r.get('/slas/:id/burndown', ...base, validate({ params: idParam }), async (req, res) => {
    res.json(await schedule.burndown(req, req.input.params.id))
  })
  r.patch('/buildings/:id/assignees', ...base, plan, validate({ params: idParam, body: C.buildingAssigneesBody }), async (req, res) => {
    res.json(await schedule.setAssignees(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  return r
}
