import { Router } from 'express'
import { z } from 'zod'
import { ACTIONS } from '@rackium/shared/policy.js'
import { inviteCreateBody, membershipUpdateBody, projectCreateBody, projectUpdateBody, auditQuery } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'
import { Invitation } from '../models/invitation.js'
import { authLimiter } from '../http/rateLimits.js'
import { notFound } from '../http/errors.js'

const idParam = z.object({ membershipId: z.string().regex(/^[a-f0-9]{24}$/) })

// Every route here sits under /orgs/:orgId. The chain is always:
// signed in -> member of this organisation -> policy action -> validated input.
export function organisationRoutes({ config, org, rateLimits }) {
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

  r.get('/invitations', ...base, async (req, res) => {
    const isOrgAdmin = (await rolesIn(req.user._id, req.org.id)).organisationMembership?.role === 'org_admin'
    res.json({ invitations: await org.listPendingInvitations({ organisationId: req.org.id, userId: req.user._id, isOrgAdmin }) })
  })

  // Loads the invitation inside the organisation scope, so an id from another
  // organisation is simply not found. Only pending invitations can be resent.
  const loadPendingInvitation = async (req, res, next) => {
    const invitation = await Invitation.findOne({ _id: req.input.params.invitationId, status: 'pending' })
    if (!invitation) return next(notFound('Invitation not found or no longer pending'))
    req.invitation = invitation
    return next()
  }

  // An Org Admin may resend any invitation; a PM only a project invitation for a
  // project they lead. The policy is checked against the invitation's own project.
  const resendGate = (req, res, next) => {
    const projectId = req.invitation.projectId ? String(req.invitation.projectId) : null
    const action = projectId ? ACTIONS.INVITE_PROJECT_MEMBERS : ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE
    return requireAction(action, { projectIdFrom: () => projectId })(req, res, next)
  }

  r.post(
    '/invitations/:invitationId/resend',
    ...base,
    authLimiter({ ...rateLimits.resendInvite, enabled: rateLimits.enabled }),
    validate({ params: z.object({ invitationId: z.string().regex(/^[a-f0-9]{24}$/) }) }),
    loadPendingInvitation,
    resendGate,
    async (req, res) => {
      const result = await org.resendInvitation({ organisationId: req.org.id, invitation: req.invitation, actor: actorOf(req) })
      res.json({ invitation: result })
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

  // Single-project read/update, used by Project Settings and the project home
  // page. applyViewAs so a write attempted during a View As session 403s even
  // for the real Org Admin.
  const projectBase = [...base, requireProject(), applyViewAs()]

  r.get('/projects/:projectId', ...projectBase, async (req, res) => {
    res.json({ project: await org.getProject({ organisationId: req.org.id, projectId: req.project.id }) })
  })

  r.patch(
    '/projects/:projectId',
    ...projectBase,
    requireAction(ACTIONS.MANAGE_PROJECT_SETTINGS),
    validate({ body: projectUpdateBody }),
    async (req, res) => {
      const project = await org.updateProject({ organisationId: req.org.id, actor: actorOf(req), projectId: req.project.id, body: req.input.body })
      res.json({ project })
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
