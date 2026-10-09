import mongoose from 'mongoose'
import { PROJECT_ROLES, ORG_ROLE, ORG_MEMBER_ROLE, canCreateProjects } from '@rackium/shared/policy.js'
import { computeOverallProgress } from '@rackium/shared/phaseCalculations.js'
import { Membership } from '../models/membership.js'
import { Invitation } from '../models/invitation.js'
import { Project } from '../models/project.js'
import { AuditEntry } from '../models/auditEntry.js'
import { User } from '../models/user.js'
import { Organisation } from '../models/organisation.js'
import { Country } from '../models/country.js'
import { Sal } from '../models/sal.js'
import { Building } from '../models/building.js'
import { PhaseStatus } from '../models/phaseStatus.js'
import { Blocker } from '../models/blocker.js'
import { Device } from '../models/device.js'
import { cmoStatusByBuilding } from '../cmo/service.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { hldStatusByBuilding } from '../hld/service.js'
import { lldStatusByBuilding } from '../lld/service.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { LldDesign } from '../models/lldDesign.js'
import { applyActivePhases } from '@rackium/shared/phaseGating.js'
import { withTransaction } from '../db/transaction.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { recordAudit, diffChanges, userActor } from '../audit/audit.js'
import { badRequest, conflict, notFound } from '../http/errors.js'
import { randomToken, hashToken } from '../auth/tokens.js'
import { membershipsForUser } from '../auth/service.js'
import { applyHierarchyPlan } from '../hierarchy/service.js'
import { buildingsWithSal } from '../hierarchy/lookup.js'
import { DEFAULT_ROLE_CODES, PROPOSED_ROLE_CODE_KEYS, resolveRoleCodes, duplicateRoleCodes } from '@rackium/shared/hldRoles.js'
import { DEFAULT_STOCK_LENGTHS } from '@rackium/shared/cableLength.js'
import { scopeView, membershipScopes } from '../access/scope.js'

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
    // A 'member' organisation membership carries permissions, not a policy
    // role, so only an Org Admin's organisation role is listed here.
    roles: [org?.role === ORG_ROLE ? org.role : null, project?.role].filter(Boolean),
  }
}

// Organisation settings as the API shows them: hostname role codes resolved
// over the defaults, plus which codes are still proposals (M4a).
function settingsView(org) {
  const raw = org.settings?.namingRoleCodes
  const stored = raw instanceof Map ? Object.fromEntries(raw) : raw ?? {}
  return {
    architectsSeePrices: Boolean(org.settings?.architectsSeePrices),
    namingRoleCodes: resolveRoleCodes(stored),
    defaultRoleCodes: DEFAULT_ROLE_CODES,
    proposedRoleCodeKeys: PROPOSED_ROLE_CODE_KEYS,
    stockLengths: org.settings?.stockLengths ?? DEFAULT_STOCK_LENGTHS,
    defaultStockLengths: DEFAULT_STOCK_LENGTHS,
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
          // Organisation rows only: the effective permission (always true for an Org Admin).
          canCreateProjects: m.level === 'organisation' ? canCreateProjects(m) : null,
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
        // A 'member' organisation row may still be invited to become Org Admin
        // (accepting upgrades the row; auth/service.js acceptInvitation).
        const already = memberships.some(
          (m) =>
            m.level === level &&
            String(m.projectId ?? '') === String(projectId ?? '') &&
            String(m.organisationId) === String(organisationId) &&
            !(m.level === 'organisation' && m.role === ORG_MEMBER_ROLE)
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
      if (membership.level === 'organisation' && membership.role === ORG_ROLE) {
        const admins = await Membership.countDocuments({ level: 'organisation', role: ORG_ROLE, active: true })
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

    // Grant or revoke project creation for a member of this organisation
    // (Org Admin only, checked at the route). The permission lives on the
    // organisation membership; a member who only has project memberships so
    // far gets an organisation 'member' row here. Org Admins always have it.
    async setProjectCreation({ organisationId, userId, allowed, actor }) {
      if (!mongoose.isValidObjectId(userId)) throw notFound('Member not found')
      const rows = await Membership.find({ userId, active: true })
      if (rows.length === 0) throw notFound('Member not found')
      let orgRow = rows.find((m) => m.level === 'organisation')
      if (orgRow?.role === ORG_ROLE) throw conflict('org_admin', 'An Org Admin can always create projects')

      const before = Boolean(orgRow?.canCreateProjects)
      if (before === allowed) return { userId: String(userId), canCreateProjects: allowed }
      await withTransaction(async (session) => {
        if (orgRow) {
          orgRow.canCreateProjects = allowed
          await orgRow.save({ session })
        } else {
          ;[orgRow] = await Membership.create([{ userId, level: 'organisation', role: ORG_MEMBER_ROLE, canCreateProjects: allowed, invitedBy: actor.userId }], { session })
        }
        await recordAudit({
          organisationId,
          actor: userActor(actor.userId, actor.role),
          action: allowed ? 'membership.project_creation.granted' : 'membership.project_creation.revoked',
          objectType: 'Membership',
          objectId: orgRow._id,
          changeType: 'design_intent',
          source: 'ui',
          changes: [{ objectType: 'Membership', objectId: String(orgRow._id), field: 'canCreateProjects', before, after: allowed }],
          session,
        })
      })
      return { userId: String(userId), canCreateProjects: allowed }
    },

    async getSettings({ organisationId }) {
      const org = await Organisation.findById(organisationId).lean()
      if (!org) throw notFound()
      return settingsView(org)
    },

    async updateSettings({ organisationId, actor, body }) {
      const org = await Organisation.findById(organisationId)
      if (!org) throw notFound()
      const before = settingsView(org.toObject())
      if (body.architectsSeePrices !== undefined) org.set('settings.architectsSeePrices', body.architectsSeePrices)
      if (body.namingRoleCodes !== undefined) {
        const merged = { ...Object.fromEntries(org.settings?.namingRoleCodes ?? []), ...body.namingRoleCodes }
        // Checked against the codes already stored, not only this request's.
        const clashes = duplicateRoleCodes(resolveRoleCodes(merged))
        if (clashes.length) throw badRequest(clashes.join('; '))
        org.set('settings.namingRoleCodes', merged)
      }
      if (body.stockLengths !== undefined) {
        org.set('settings.stockLengths', body.stockLengths)
        org.markModified('settings.stockLengths')
      }
      await org.save()
      const after = settingsView(org.toObject())
      const changes = [
        ...diffChanges({ objectType: 'Organisation', objectId: org._id, before, after, fields: ['architectsSeePrices'] }),
        ...Object.keys(after.namingRoleCodes)
          .filter((role) => before.namingRoleCodes[role] !== after.namingRoleCodes[role])
          .map((role) => ({ objectType: 'Organisation', objectId: String(org._id), field: `namingRoleCodes.${role}`, before: before.namingRoleCodes[role], after: after.namingRoleCodes[role] })),
        ...(JSON.stringify(before.stockLengths) !== JSON.stringify(after.stockLengths) ? [{ objectType: 'Organisation', objectId: String(org._id), field: 'stockLengths', before: before.stockLengths, after: after.stockLengths }] : []),
      ]
      if (changes.length) {
        await recordAudit({
          organisationId,
          actor: userActor(actor.userId, actor.role),
          action: 'organisation.settings.updated',
          objectType: 'Organisation',
          objectId: org._id,
          changeType: 'design_intent',
          source: 'ui',
          changes,
        })
      }
      return after
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
      const memberships = isOrgAdmin ? [] : await membershipsForUser(userId)
      if (!isOrgAdmin) {
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
        // A scoped member lists only the buildings of their scope (access/scope.js).
        const membership = memberships.find((m) => m.level === 'project' && String(m.projectId) === String(p._id))
        const scopes = membershipScopes(membership, isOrgAdmin)
        const buildings = await runWithScope({ organisationId, projectId: p._id }, async () => {
          const view = scopeView(scopes, await buildingsWithSal())
          const [buildingRows, statusRows, cmoStatuses, surveyStatuses, hldStatuses, lldStatuses] = await Promise.all([Building.find().lean(), PhaseStatus.find().lean(), cmoStatusByBuilding(), surveyStatusByBuilding(), hldStatusByBuilding(), lldStatusByBuilding()])
          const statusByBuilding = new Map()
          for (const s of statusRows) {
            const key = String(s.buildingId)
            if (!statusByBuilding.has(key)) statusByBuilding.set(key, new Map())
            statusByBuilding.get(key).set(s.phaseKey, s.status)
          }
          // CMO is computed from imported devices, not stored (same as the dashboard).
          for (const [phaseKey, statuses] of [['cmo', cmoStatuses], ['survey', surveyStatuses], ['hld', hldStatuses], ['lld', lldStatuses]]) {
            for (const [buildingId, status] of statuses) {
              if (!statusByBuilding.has(buildingId)) statusByBuilding.set(buildingId, new Map())
              statusByBuilding.get(buildingId).set(phaseKey, status)
            }
          }
          return buildingRows.filter((b) => view.coversBuilding(b._id)).map((b) => {
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

    // `scope` (access/scope.js): a scoped member sees only their buildings.
    async getProject({ organisationId, projectId, scope = null }) {
      const p = await Project.findById(projectId).lean()
      if (!p) throw notFound('Project not found')
      const buildings = (await Building.find().lean()).filter((b) => !scope || scope.coversBuilding(b._id))
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
    async updateProject({ organisationId, actor, projectId, body, scope = null }) {
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
        const [statusRows, blockerRows, hasCmoDevices, hasSurveyData, hasHldDevices, hasLld] = await Promise.all([
          PhaseStatus.find({ status: { $ne: 'not_started' } }).select('phaseKey').lean(),
          Blocker.find({}).select('phaseKey').lean(),
          Device.exists({ origin: 'existing' }),
          SurveyTabRecord.exists({ hasData: true }),
          Device.exists({ origin: 'planned' }),
          LldDesign.exists({}),
        ])
        const phasesWithData = new Set([...statusRows.map((r) => r.phaseKey), ...blockerRows.map((r) => r.phaseKey)])
        // Imported CMO devices are the CMO phase's data (its status is computed from them).
        if (hasCmoDevices) phasesWithData.add('cmo')
        // Survey tab records are the survey phase's data.
        if (hasSurveyData) phasesWithData.add('survey')
        // Planned devices are the HLD's data (M4a).
        if (hasHldDevices) phasesWithData.add('hld')
        // A started LLD is the LLD's data (M4b).
        if (hasLld) phasesWithData.add('lld')
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
      return this.getProject({ organisationId, projectId: project._id, scope })
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
        source: e.source,
        offlineQueuedAt: e.offlineQueuedAt ?? null,
        conflict: Boolean(e.conflict),
        comment: e.comment ?? null,
        changes: e.changes,
      }))
    },
  }
}
