import mongoose from 'mongoose'
import { PROJECT_ROLES } from '@rackium/shared/policy.js'
import { Membership } from '../models/membership.js'
import { Invitation } from '../models/invitation.js'
import { Project } from '../models/project.js'
import { AuditEntry } from '../models/auditEntry.js'
import { User } from '../models/user.js'
import { withTransaction } from '../db/transaction.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { recordAudit, diffChanges, userActor } from '../audit/audit.js'
import { badRequest, conflict, notFound } from '../http/errors.js'
import { randomToken, hashToken } from '../auth/tokens.js'
import { membershipsForUser } from '../auth/service.js'

const { ObjectId } = mongoose.Types
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000

const scopeOf = (m) => (m.scopes ?? []).map((s) => ({ type: s.type, refId: String(s.refId) }))
const membershipSnapshot = (m) => ({ role: m.role, scopes: scopeOf(m) })

// Roles an identity holds in an organisation, and in one project of it.
// Organisation-level roles grant only what the policy table gives them.
export async function rolesIn(userId, organisationId, projectId = null) {
  const memberships = await membershipsForUser(userId)
  const org = memberships.find((m) => m.level === 'organisation' && String(m.organisationId) === String(organisationId))
  const project = projectId
    ? memberships.find((m) => m.level === 'project' && String(m.projectId) === String(projectId) && String(m.organisationId) === String(organisationId))
    : null
  const inOrg = memberships.some((m) => String(m.organisationId) === String(organisationId))
  return {
    hasAnyInOrg: inOrg,
    organisationMembership: org ?? null,
    roles: [org?.role, project?.role].filter(Boolean),
  }
}

export function createOrganisationService({ mailer, auth }) {
  return {
    async listMembers({ organisationId }) {
      const rows = await Membership.find({ active: true }).sort({ createdAt: 1 }).lean()
      const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('email name emailVerifiedAt').lean()
      const byId = new Map(users.map((u) => [String(u._id), u]))
      return rows.map((m) => {
        const u = byId.get(String(m.userId))
        return {
          id: String(m._id),
          organisationId: String(organisationId),
          projectId: m.projectId ? String(m.projectId) : null,
          level: m.level,
          role: m.role,
          scopes: scopeOf(m),
          user: u ? { id: String(u._id), email: u.email, name: u.name, emailVerified: Boolean(u.emailVerifiedAt) } : null,
        }
      })
    },

    async createInvitation({ organisationId, actor, body }) {
      const level = body.projectId ? 'project' : 'organisation'
      const projectId = body.projectId ?? null
      if (projectId) {
        const project = await Project.exists({ _id: projectId })
        if (!project) throw notFound('Project not found')
      }
      const existing = await User.findOne({ email: body.email }).lean()
      if (existing) {
        const memberships = await membershipsForUser(existing._id)
        const already = memberships.some(
          (m) => m.level === level && String(m.projectId ?? '') === String(projectId ?? '') && String(m.organisationId) === String(organisationId)
        )
        if (already) throw conflict('already_member', 'That person already has access here')
      }
      const pending = await Invitation.exists({ email: body.email, level, projectId, status: 'pending' })
      if (pending) throw conflict('invitation_pending', 'An invitation to this address is already waiting')

      const token = randomToken()
      const invitation = await Invitation.create({
        email: body.email,
        level,
        role: body.role,
        scopes: body.scopes,
        invitedBy: actor.userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        projectId,
      })

      await recordAudit({
        organisationId,
        projectId,
        actor: userActor(actor.userId, actor.role),
        action: 'invitation.created',
        objectType: 'Invitation',
        objectId: invitation._id,
        changeType: 'design_intent',
        source: 'ui',
        changes: [
          { objectType: 'Invitation', objectId: String(invitation._id), field: 'email', before: null, after: body.email },
          { objectType: 'Invitation', objectId: String(invitation._id), field: 'role', before: null, after: body.role },
        ],
      })

      await mailer.send({
        to: body.email,
        subject: 'You have been invited to Rackium',
        text: `You have been invited to join a Rackium organisation as ${body.role}.\n\nAccept the invitation:\n\n${auth.inviteLink(organisationId, token)}\n\nThis invitation expires in seven days.`,
      })

      return { id: String(invitation._id), email: body.email, role: body.role, level, projectId, expiresAt: invitation.expiresAt }
    },

    async updateMembership({ organisationId, membershipId, actor, body }) {
      const membership = await Membership.findById(membershipId)
      if (!membership || !membership.active) throw notFound('Membership not found')
      const before = membershipSnapshot(membership)

      if (body.role !== undefined) {
        const allowed = membership.level === 'organisation' ? ['org_admin'] : PROJECT_ROLES
        if (!allowed.includes(body.role)) throw badRequest(`Role ${body.role} is not valid for this membership`)
        membership.role = body.role
      }
      if (body.scopes !== undefined) {
        if (membership.level !== 'project') throw badRequest('Scopes apply to project memberships only')
        membership.scopes = body.scopes
      }
      await membership.save()

      const changes = diffChanges({
        objectType: 'Membership',
        objectId: membership._id,
        before,
        after: membershipSnapshot(membership),
        fields: ['role', 'scopes'],
      })
      if (changes.length) {
        await recordAudit({
          organisationId,
          projectId: membership.projectId,
          actor: userActor(actor.userId, actor.role),
          action: 'membership.updated',
          objectType: 'Membership',
          objectId: membership._id,
          changeType: 'design_intent',
          source: 'ui',
          changes,
        })
      }
      return { id: String(membership._id), role: membership.role, scopes: scopeOf(membership) }
    },

    async revokeMembership({ organisationId, membershipId, actor }) {
      const membership = await Membership.findById(membershipId)
      if (!membership || !membership.active) throw notFound('Membership not found')
      if (membership.level === 'organisation') {
        const admins = await Membership.countDocuments({ level: 'organisation', active: true })
        if (admins <= 1) throw conflict('last_org_admin', 'An organisation must keep at least one Org Admin')
      }
      membership.active = false
      membership.revokedAt = new Date()
      await membership.save()
      await recordAudit({
        organisationId,
        projectId: membership.projectId,
        actor: userActor(actor.userId, actor.role),
        action: 'membership.revoked',
        objectType: 'Membership',
        objectId: membership._id,
        changeType: 'design_intent',
        source: 'ui',
        changes: [{ objectType: 'Membership', objectId: String(membership._id), field: 'active', before: true, after: false }],
      })
      return { id: String(membership._id), revoked: true }
    },

    // The creator becomes the project's PM, in the same transaction as the project.
    async createProject({ organisationId, actor, body }) {
      return withTransaction(async (session) => {
        const [project] = await runWithScope({ organisationId }, () =>
          Project.create([{ name: body.name, code: body.code, createdBy: actor.userId }], { session })
        )
        await runWithScope({ organisationId, projectId: project._id }, () =>
          Membership.create([{ userId: actor.userId, level: 'project', projectId: project._id, role: 'pm', invitedBy: null }], { session })
        )
        await recordAudit({
          organisationId,
          projectId: project._id,
          actor: userActor(actor.userId, actor.role),
          action: 'project.created',
          objectType: 'Project',
          objectId: project._id,
          changeType: 'design_intent',
          source: 'ui',
          changes: [{ objectType: 'Project', objectId: String(project._id), field: 'name', before: null, after: body.name }],
          session,
        })
        return { id: String(project._id), name: project.name, code: project.code ?? null }
      })
    },

    async listProjects({ organisationId }) {
      const rows = await Project.find({}).sort({ createdAt: 1 }).lean()
      return rows.map((p) => ({ id: String(p._id), name: p.name, code: p.code ?? null, status: p.status, organisationId: String(organisationId) }))
    },

    async listAudit({ organisationId, projectId, limit }) {
      const filter = projectId ? { projectId: new ObjectId(projectId) } : {}
      const rows = await AuditEntry.find(filter).sort({ occurredAt: -1 }).limit(limit).lean()
      return rows.map((e) => ({
        id: String(e._id),
        occurredAt: e.occurredAt,
        action: e.action,
        objectType: e.objectType,
        objectId: e.objectId,
        actor: { type: e.actor.type, userId: e.actor.userId ? String(e.actor.userId) : null, role: e.actor.role ?? null },
        changeType: e.changeType,
        comment: e.comment ?? null,
        changes: e.changes,
      }))
    },
  }
}
