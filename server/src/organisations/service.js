import mongoose from 'mongoose'
import { PROJECT_ROLES } from '@rackium/shared/policy.js'
import { computeOverallProgress } from '@rackium/shared/phaseCalculations.js'
import { Membership } from '../models/membership.js'
import { Invitation } from '../models/invitation.js'
import { Project } from '../models/project.js'
import { AuditEntry } from '../models/auditEntry.js'
import { User } from '../models/user.js'
import { Country } from '../models/country.js'
import { Sal } from '../models/sal.js'
import { Building } from '../models/building.js'
import { PhaseStatus } from '../models/phaseStatus.js'
import { Blocker } from '../models/blocker.js'
import { Device } from '../models/device.js'
import { cmoStatusByBuilding } from '../cmo/service.js'
import { applyActivePhases } from '@rackium/shared/phaseGating.js'
import { withTransaction } from '../db/transaction.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { recordAudit, diffChanges, userActor } from '../audit/audit.js'
import { badRequest, conflict, notFound } from '../http/errors.js'
import { randomToken, hashToken } from '../auth/tokens.js'
import { membershipsForUser } from '../auth/service.js'
import { applyHierarchyPlan } from '../hierarchy/service.js'

const { ObjectId } = mongoose.Types
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000
const HIERARCHY_MODEL_BY_SCOPE_TYPE = { country: Country, sal: Sal, building: Building }

// A scope must name a country, SAL or building that exists in this project
// (DATA-MODEL §1.6). Clearing scopes (an empty list) is always allowed.
async function assertScopesExist(organisationId, projectId, scopes) {
  if (!scopes?.length) return
  if (!projectId) throw badRequest('Scopes apply to project memberships only')
  await runWithScope({ organisationId, projectId }, async () => {
    for (const scope of scopes) {
      const Model = HIERARCHY_MODEL_BY_SCOPE_TYPE[scope.type]
      if (!(await Model.exists({ _id: scope.refId }))) {
        throw badRequest(`Scope refers to a ${scope.type} that does not exist in this project`, { type: scope.type, refId: String(scope.refId) })
      }
    }
  })
}

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

      await assertScopesExist(organisationId, projectId, body.scopes)
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
        await assertScopesExist(organisationId, membership.projectId, body.scopes)
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

    // The wizard's three steps (Identity+Scope, Structure, Team) all land in
    // one transaction: the project, its hierarchy, the creator's PM
    // membership, and the team's invitation rows. Invitation emails are
    // side effects that must not repeat on a transaction retry (db/transaction.js),
    // so they are sent only after this resolves, never inside it — a
    // transaction that does not commit sends nothing.
    async createProject({ organisationId, actor, body }) {
      const activePhases = body.activePhaseKeys.map((phaseKey, position) => ({ phaseKey, position }))
      // body.hierarchy is already the grouped plan shape (manual entry builds it
      // directly; CSV import validates with shared's buildHierarchyImportPlan
      // client-side and sends its output) — applyHierarchyPlan checks that every
      // reference inside it resolves before creating anything.

      const { project, pendingInvites } = await withTransaction(async (session) => {
        const [project] = await runWithScope({ organisationId }, () =>
          Project.create(
            [{ name: body.name, code: body.code, clientName: body.clientName ?? null, description: body.description ?? null, workTypes: body.workTypes, activePhases, createdBy: actor.userId }],
            { session }
          )
        )
        return runWithScope({ organisationId, projectId: project._id }, async () => {
          await Membership.create([{ userId: actor.userId, level: 'project', projectId: project._id, role: 'pm', invitedBy: null }], { session })
          await applyHierarchyPlan(body.hierarchy, session)

          const pendingInvites = []
          for (const member of body.team) {
            const token = randomToken()
            await Invitation.create(
              [{ email: member.email, level: 'project', role: member.role, scopes: member.scopes, invitedBy: actor.userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), projectId: project._id }],
              { session }
            )
            pendingInvites.push({ email: member.email, role: member.role, token })
          }

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
          return { project, pendingInvites }
        })
      })

      for (const invite of pendingInvites) {
        await mailer
          .send({
            to: invite.email,
            subject: 'You have been invited to Rackium',
            text: `You have been invited to join a Rackium project as ${invite.role}.\n\nAccept the invitation:\n\n${auth.inviteLink(organisationId, invite.token)}\n\nThis invitation expires in seven days.`,
          })
          .catch(() => {}) // best effort — the project and the invitation row are already committed
      }

      return { id: String(project._id), name: project.name, code: project.code ?? null }
    },

    // Pending invitations the caller may act on: an Org Admin sees all of them; a
    // PM sees the project invitations for projects where they are PM.
    async listPendingInvitations({ organisationId, userId, isOrgAdmin }) {
      const rows = await Invitation.find({ status: 'pending' }).sort({ createdAt: -1 }).lean()
      let visible = rows
      if (!isOrgAdmin) {
        const memberships = await membershipsForUser(userId)
        const pmProjects = new Set(
          memberships
            .filter((m) => m.level === 'project' && m.role === 'pm' && String(m.organisationId) === String(organisationId))
            .map((m) => String(m.projectId))
        )
        visible = rows.filter((r) => r.projectId && pmProjects.has(String(r.projectId)))
      }
      const now = Date.now()
      return visible.map((i) => ({
        id: String(i._id),
        email: i.email,
        role: i.role,
        level: i.level,
        projectId: i.projectId ? String(i.projectId) : null,
        expiresAt: i.expiresAt,
        expired: new Date(i.expiresAt).getTime() < now,
      }))
    },

    // The old link stops working at once: the stored hash is replaced. The
    // invitation's own expiry restarts from now.
    async resendInvitation({ organisationId, invitation, actor }) {
      const before = invitation.expiresAt
      const token = randomToken()
      invitation.tokenHash = hashToken(token)
      invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS)
      await invitation.save()
      await recordAudit({
        organisationId,
        projectId: invitation.projectId,
        actor: userActor(actor.userId, actor.role),
        action: 'invitation.resent',
        objectType: 'Invitation',
        objectId: invitation._id,
        changeType: 'design_intent',
        source: 'ui',
        comment: 'previous link invalidated',
        changes: [{ objectType: 'Invitation', objectId: String(invitation._id), field: 'expiresAt', before, after: invitation.expiresAt }],
      })
      await mailer.send({
        to: invitation.email,
        subject: 'You have been invited to Rackium',
        text: `You have been invited to join a Rackium organisation as ${invitation.role}.\n\nAccept the invitation:\n\n${auth.inviteLink(organisationId, token)}\n\nThis invitation expires in seven days. Any earlier link no longer works.`,
      })
      return { id: String(invitation._id), expiresAt: invitation.expiresAt }
    },

    // Org Admins see every project in the organisation. Everyone else sees only the
    // projects they hold a membership in.
    async listProjects({ organisationId, userId, isOrgAdmin }) {
      const filter = {}
      if (!isOrgAdmin) {
        const memberships = await membershipsForUser(userId)
        const ids = memberships
          .filter((m) => m.level === 'project' && String(m.organisationId) === String(organisationId))
          .map((m) => m.projectId)
        filter._id = { $in: ids }
      }
      const rows = await Project.find(filter).sort({ createdAt: 1 }).lean()

      // Each project's buildings and their progress, for the list screen and
      // the org-level summary (item 2). Progress uses only the project's own
      // active phases, same math as the real dashboard.
      const result = []
      for (const p of rows) {
        const activePhases = p.activePhases ?? []
        const buildings = await runWithScope({ organisationId, projectId: p._id }, async () => {
          const [buildingRows, statusRows, cmoStatuses] = await Promise.all([Building.find().lean(), PhaseStatus.find().lean(), cmoStatusByBuilding()])
          const statusByBuilding = new Map()
          for (const s of statusRows) {
            const key = String(s.buildingId)
            if (!statusByBuilding.has(key)) statusByBuilding.set(key, new Map())
            statusByBuilding.get(key).set(s.phaseKey, s.status)
          }
          // CMO is computed from imported devices, not stored (same as the dashboard).
          for (const [buildingId, status] of cmoStatuses) {
            if (!statusByBuilding.has(buildingId)) statusByBuilding.set(buildingId, new Map())
            statusByBuilding.get(buildingId).set('cmo', status)
          }
          return buildingRows.map((b) => {
            const byPhase = statusByBuilding.get(String(b._id)) ?? new Map()
            const phaseEntries = activePhases.map((ap) => ({ status: byPhase.get(ap.phaseKey) ?? 'not_started' }))
            return { id: String(b._id), code: b.code, name: b.name, progress: computeOverallProgress(phaseEntries) }
          })
        })
        result.push({
          id: String(p._id),
          name: p.name,
          code: p.code ?? null,
          clientName: p.clientName ?? null,
          status: p.status,
          workTypes: p.workTypes ?? [],
          activePhases: activePhases.map((ap) => ap.phaseKey),
          organisationId: String(organisationId),
          buildings,
        })
      }
      return result
    },

    async getProject({ organisationId, projectId }) {
      const p = await Project.findById(projectId).lean()
      if (!p) throw notFound('Project not found')
      const buildings = await Building.find().lean()
      return {
        id: String(p._id),
        name: p.name,
        code: p.code ?? null,
        clientName: p.clientName ?? null,
        description: p.description ?? null,
        status: p.status,
        workTypes: p.workTypes ?? [],
        activePhases: p.activePhases ?? [],
        organisationId: String(organisationId),
        buildings: buildings.map((b) => ({ id: String(b._id), code: b.code, name: b.name })),
      }
    },

    // General, work types, active phases (gated by shared/src/phaseGating.js)
    // and status (Danger zone: archive). Hierarchy and members have their own endpoints.
    async updateProject({ organisationId, actor, projectId, body }) {
      const project = await Project.findById(projectId)
      if (!project) throw notFound('Project not found')
      const before = { name: project.name, clientName: project.clientName, description: project.description, status: project.status, activePhases: project.activePhases.map((a) => a.phaseKey) }

      if (body.name !== undefined) project.name = body.name
      if (body.clientName !== undefined) project.clientName = body.clientName
      if (body.description !== undefined) project.description = body.description
      if (body.workTypes !== undefined) project.workTypes = body.workTypes
      if (body.status !== undefined) project.status = body.status

      if (body.activePhaseKeys !== undefined) {
        // PhaseStatus and Blocker are project-scoped by the tenant plugin, so this
        // already reads only this project's rows — no need to join via buildings.
        const [statusRows, blockerRows, hasCmoDevices] = await Promise.all([
          PhaseStatus.find({ status: { $ne: 'not_started' } }).select('phaseKey').lean(),
          Blocker.find({}).select('phaseKey').lean(),
          Device.exists({ origin: 'existing' }),
        ])
        const phasesWithData = new Set([...statusRows.map((r) => r.phaseKey), ...blockerRows.map((r) => r.phaseKey)])
        // Imported CMO devices are the CMO phase's data (its status is computed from them).
        if (hasCmoDevices) phasesWithData.add('cmo')
        const result = applyActivePhases({
          currentActivePhases: project.activePhases.map((a) => a.phaseKey),
          nextPhaseKeys: body.activePhaseKeys,
          phaseHasData: (phaseKey) => phasesWithData.has(phaseKey),
        })
        if (!result.ok) throw badRequest(result.error)
        project.activePhases = result.activePhases
      }

      await project.save()
      const changes = diffChanges({
        objectType: 'Project',
        objectId: project._id,
        before,
        after: { name: project.name, clientName: project.clientName, description: project.description, status: project.status, activePhases: project.activePhases.map((a) => a.phaseKey) },
        fields: ['name', 'clientName', 'description', 'status', 'activePhases'],
      })
      if (changes.length) {
        await recordAudit({
          organisationId,
          projectId: project._id,
          actor: userActor(actor.userId, actor.role),
          action: 'project.updated',
          objectType: 'Project',
          objectId: project._id,
          changeType: 'design_intent',
          source: 'ui',
          changes,
        })
      }
      return this.getProject({ organisationId, projectId: project._id })
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
