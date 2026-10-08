import { recordingRouter } from '../http/routeRecorder.js'
import { z } from 'zod'
import { ACTIONS, canCreateProjects } from '@rackium/shared/policy.js'
import { inviteCreateBody, membershipUpdateBody, projectCreateBody, projectUpdateBody, auditQuery, projectCreationBody, organisationSettingsBody } from '@rackium/shared/contracts.js'
import { validate } from '../http/validate.js'
import { requireUser, requireOrg, requireProject, requireAction, applyViewAs, actorOf } from '../http/middleware.js'
import { rolesIn } from '../organisations/service.js'
import { Invitation } from '../models/invitation.js'
import { authLimiter } from '../http/rateLimits.js'
import { notFound, forbidden } from '../http/errors.js'

const idParam = z.object({ membershipId: z.string().regex(/^[a-f0-9]{24}$/) })
const userIdParam = z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/) })

// Every route here sits under /orgs/:orgId. The chain is always:
// signed in -> member of this organisation -> policy action -> validated input.
export function organisationRoutes({ config, org, rateLimits }) {
  const r = recordingRouter({ mergeParams: true })
  const base = [requireUser(config), requireOrg()]

  r.get('/members', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), async (req, res) => {
    res.json({ members: await org.listMembers({ organisationId: req.org.id }) })
  })

  // Org Admin grants or revokes project creation for any member (M3a review).
  r.patch(
    '/members/:userId/project-creation',
    ...base,
    requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE),
    validate({ params: userIdParam, body: projectCreationBody }),
    async (req, res) => {
      res.json(await org.setProjectCreation({ organisationId: req.org.id, userId: req.input.params.userId, allowed: req.input.body.allowed, actor: actorOf(req) }))
    }
  )

  // Organisation settings. Readable by any member (the UI shows what applies);
  // only an Org Admin changes them.
  r.get('/settings', ...base, async (req, res) => {
    res.json({ settings: await org.getSettings({ organisationId: req.org.id }) })
  })
  r.patch('/settings', ...base, requireAction(ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE), validate({ body: organisationSettingsBody }), async (req, res) => {
    res.json({ settings: await org.updateSettings({ organisationId: req.org.id, actor: actorOf(req), body: req.input.body }) })
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

  // Project creation is an organisation-level permission (shared/policy.js
  // canCreateProjects): Org Admin, or a member it has been granted to.
  const requireProjectCreation = async (req, res, next) => {
    const { organisationMembership, roles } = await rolesIn(req.user._id, req.org.id)
    if (!canCreateProjects(organisationMembership)) return next(forbidden('You do not have permission to create projects in this organisation'))
    req.roles = roles
    return next()
  }

  r.post(
    '/projects',
    ...base,
    requireProjectCreation,
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
