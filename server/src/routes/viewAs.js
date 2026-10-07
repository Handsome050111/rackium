import { Router } from 'express'
import { z } from 'zod'
import { ACTIONS } from '@rackium/shared/policy.js'
import { viewAsStartBody } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, actorOf } from '../http/middleware.js'

const sessionIdParam = z.object({ sessionId: z.string().regex(/^[a-f0-9]{24}$/) })

// /orgs/:orgId/projects/:projectId/view-as. Deliberately not behind
// applyViewAs — these two routes validate the session themselves (start has
// none yet to check; end must find one even past its TTL, to close it out).
export function viewAsRoutes({ config, viewAs }) {
  const r = Router({ mergeParams: true })
  const base = [requireUser(config), requireOrg(), requireProject()]

  r.post('/', ...base, requireAction(ACTIONS.VIEW_AS), validate({ body: viewAsStartBody }), async (req, res) => {
    const session = await viewAs.start({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req) }, req.input.body)
    res.status(201).json({ session })
  })

  r.post('/:sessionId/end', ...base, validate({ params: sessionIdParam }), async (req, res) => {
    const result = await viewAs.end({ organisationId: req.org.id, projectId: req.project.id, actor: actorOf(req) }, { sessionId: req.input.params.sessionId })
    res.json(result)
  })

  return r
}
