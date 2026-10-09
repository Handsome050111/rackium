import { recordingRouter } from '../http/routeRecorder.js'
import { z } from 'zod'
import { ACTIONS } from '@rackium/shared/policy.js'
import { blockerCreateBody, blockerUpdateBody } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { requireBuilding, projectScope } from '../access/scope.js'

const idParam = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) })
const buildingQuery = z.object({ buildingId: z.string().regex(/^[a-f0-9]{24}$/) })

// /orgs/:orgId/projects/:projectId/blockers. Raising is open to any project
// role; assign/resolve/reopen rules are checked in the service (DATA-MODEL §5.10).
// Every call is limited to the caller's membership scope (access/scope.js).
export function blockersRoutes({ config, blockers }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject(), applyViewAs()]

  r.get('/', ...base, validate({ query: buildingQuery }), async (req, res) => {
    await requireBuilding(req, req.input.query.buildingId)
    res.json({ blockers: await blockers.listForBuilding({ buildingId: req.input.query.buildingId, scope: await projectScope(req) }) })
  })

  r.post('/', ...base, requireAction(ACTIONS.RAISE_BLOCKER), validate({ body: blockerCreateBody }), async (req, res) => {
    await requireBuilding(req, req.input.body.buildingId)
    const blocker = await blockers.raise({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req), body: req.input.body })
    res.status(201).json({ blocker })
  })

  // Any project role may attempt an update; the service itself checks who may
  // do what (owner/PM for most transitions, anyone for reopen).
  r.patch('/:id', ...base, requireAction(ACTIONS.RAISE_BLOCKER), validate({ params: idParam, body: blockerUpdateBody }), async (req, res) => {
    const blocker = await blockers.update({
      organisationId: req.org.id,
      projectId: req.project.id,
      actor: actorOf(req),
      actorRoles: req.roles,
      id: req.input.params.id,
      body: req.input.body,
      scope: await projectScope(req),
    })
    res.json({ blocker })
  })

  return r
}
