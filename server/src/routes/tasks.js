import { z } from 'zod'
import { recordingRouter } from '../http/routeRecorder.js'
import { ACTIONS } from '@rackium/shared/policy.js'
import * as C from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) })
// The caller's roles, so every write's audit entry records the role it was made in.
const loadRoles = async (req, res, next) => {
  if (!req.viewAsActive) req.roles = (await rolesIn(req.user._id, req.org.id, req.project.id)).roles
  next()
}

// /orgs/:orgId/projects/:projectId/tasks (brief v2.2 §8; M5b). Every project
// member reads the tasks of the buildings they may see; a PM or Architect
// creates and assigns; the service checks who may move or change a task.
export function taskRoutes({ config, tasks }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs(), loadRoles]
  const assign = requireAction(ACTIONS.MANAGE_TASKS)

  r.get('/', ...base, validate({ query: C.taskListQuery }), async (req, res) => {
    res.json(await tasks.list(req, req.input.query))
  })
  r.get('/assignees', ...base, validate({ query: z.object({ buildingId: z.string().regex(/^[a-f0-9]{24}$/).optional() }) }), async (req, res) => {
    res.json(await tasks.assignees(req, req.input.query))
  })
  r.post('/', ...base, assign, validate({ body: C.taskCreateBody }), async (req, res) => {
    res.status(201).json(await tasks.create(req, req.input.body, actorOf(req)))
  })
  r.post('/from-resources', ...base, assign, validate({ body: C.tasksFromResourcesBody }), async (req, res) => {
    res.status(201).json(await tasks.fromResources(req, req.input.body, actorOf(req)))
  })
  // Any project member may try (the assignee moves their own task forward).
  r.patch('/:id', ...base, validate({ params: idParam, body: C.taskUpdateBody }), async (req, res) => {
    res.json(await tasks.update(req, req.input.params.id, req.input.body, actorOf(req)))
  })
  r.delete('/:id', ...base, validate({ params: idParam }), async (req, res) => {
    res.json(await tasks.remove(req, req.input.params.id, actorOf(req)))
  })
  return r
}

// /orgs/:orgId — the signed-in user's own things across the organisation:
// "My tasks", the notification bell and notification preferences.
export function meRoutes({ config, tasks, notifications }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]
  const me = (req) => ({ userId: req.user._id })

  r.get('/tasks/mine', ...base, validate({ query: C.myTasksQuery }), async (req, res) => {
    res.json(await tasks.mine(req, req.input.query))
  })
  r.get('/notifications', ...base, validate({ query: C.notificationListQuery }), async (req, res) => {
    res.json(await notifications.list({ ...me(req), ...req.input.query }))
  })
  r.get('/notifications/unread-count', ...base, async (req, res) => {
    res.json(await notifications.unreadCount(me(req)))
  })
  r.post('/notifications/read-all', ...base, async (req, res) => {
    res.json(await notifications.markAllRead(me(req)))
  })
  r.post('/notifications/:id/read', ...base, validate({ params: idParam }), async (req, res) => {
    res.json(await notifications.markRead({ ...me(req), id: req.input.params.id }))
  })
  r.get('/notification-preferences', ...base, async (req, res) => {
    res.json(await notifications.preferences(me(req)))
  })
  r.put('/notification-preferences', ...base, validate({ body: C.notificationPreferencesBody }), async (req, res) => {
    res.json(await notifications.updatePreferences({ ...me(req), modes: req.input.body.modes }))
  })
  return r
}
