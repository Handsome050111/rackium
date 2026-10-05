import { Router } from 'express'
import { z } from 'zod'
import { ACTIONS } from '@rackium/shared/policy.js'
import { inviteCreateBody, membershipUpdateBody, projectCreateBody, auditQuery } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireAction, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'

const idParam = z.object({ membershipId: z.string().regex(/^[a-f0-9]{24}$/) })

// Every route here sits under /orgs/:orgId. The chain is always:
// signed in -> member of this organisation -> policy action -> validated input.
export function organisationRoutes({ config, org }) {
  const r = Router({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]

  r.get('/members', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), async (req, res) => {
    res.json({ members: await org.listMembers({ organisationId: req.org.id }) })
  })

  // Organisation invitations need Org Admin. Project invitations also allow a PM,
  // checked against the project named in the body. Validation runs first so the
  // project id is known when the policy is checked.
  const inviteGate = (req, res, next) => {
    const projectId = req.input.body.projectId ?? null
    const action = projectId ? ACTIONS.INVITE_PROJECT_MEMBERS : ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE
    return requireAction(action, { projectIdFrom: () => projectId })(req, res, next)
  }

  r.post(
    '/invitations',
    ...base,
    validate({ body: inviteCreateBody }),
    inviteGate,
    async (req, res) => {
      const invitation = await org.createInvitation({ organisationId: req.org.id, actor: actorOf(req), body: req.input.body })
      res.status(201).json({ invitation })
    }
  )

  r.patch(
    '/memberships/:membershipId',
    ...base,
    requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE),
    validate({ params: idParam, body: membershipUpdateBody }),
    async (req, res) => {
      const membership = await org.updateMembership({
        organisationId: req.org.id,
        membershipId: req.input.params.membershipId,
        actor: actorOf(req),
        body: req.input.body,
      })
      res.json({ membership })
    }
  )

  r.delete(
    '/memberships/:membershipId',
    ...base,
    requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE),
    validate({ params: idParam }),
    async (req, res) => {
      const result = await org.revokeMembership({ organisationId: req.org.id, membershipId: req.input.params.membershipId, actor: actorOf(req) })
      res.json(result)
    }
  )

  r.get('/projects', ...base, async (req, res) => {
    const isOrgAdmin = (await rolesIn(req.user._id, req.org.id)).organisationMembership?.role === 'org_admin'
    res.json({ projects: await org.listProjects({ organisationId: req.org.id, userId: req.user._id, isOrgAdmin }) })
  })

  r.post(
    '/projects',
    ...base,
    requireAction(ACTIONS.CREATE_PROJECTS),
    validate({ body: projectCreateBody }),
    async (req, res) => {
      const project = await org.createProject({ organisationId: req.org.id, actor: actorOf(req), body: req.input.body })
      res.status(201).json({ project })
    }
  )

  r.get(
    '/audit',
    ...base,
    validate({ query: auditQuery }),
    requireAction(ACTIONS.VIEW_AUDIT_LOG, { projectIdFrom: (req) => req.input.query.projectId ?? null }),
    async (req, res) => {
      const entries = await org.listAudit({ organisationId: req.org.id, projectId: req.input.query.projectId, limit: req.input.query.limit })
      res.json({ entries })
    }
  )

  return r
}
