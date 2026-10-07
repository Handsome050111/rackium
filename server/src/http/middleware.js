import mongoose from 'mongoose'
import { can } from '@rackium/shared/policy.js'
import { User } from '../models/user.js'
import { Project } from '../models/project.js'
import { ViewAsSession, VIEW_AS_SESSION_TTL_MS } from '../models/viewAsSession.js'
import { verifyAccessToken } from '../auth/tokens.js'
import { RefreshToken } from '../models/tokens.js'
import { ACCESS_COOKIE } from './cookies.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { rolesIn } from '../organisations/service.js'
import { unauthorised, notFound, forbidden } from './errors.js'

// Resolves the signed-in user from the access cookie. Anything that fails to
// verify is the same 401, so the response never says why.
export function requireUser(config) {
  return async (req, res, next) => {
    const token = req.cookies?.[ACCESS_COOKIE]
    const claims = token ? await verifyAccessToken(token, config.JWT_SECRET) : null
    if (!claims || !mongoose.isValidObjectId(claims.userId)) return next(unauthorised())
    // The session is live only while its refresh-token family has a usable token.
    const liveSession = await RefreshToken.exists({ familyId: claims.sid, revokedAt: null, expiresAt: { $gt: new Date() } })
    if (!liveSession) return next(unauthorised())
    const user = await User.findById(claims.userId).lean()
    if (!user || user.status !== 'active') return next(unauthorised())
    req.user = user
    return next()
  }
}

// Requires some active membership in the organisation named by :orgId, then
// opens that organisation's tenant scope for the rest of the request. Anyone
// else gets a 404, which does not reveal whether the organisation exists.
export function requireOrg() {
  return async (req, res, next) => {
    const organisationId = req.params.orgId
    if (!mongoose.isValidObjectId(organisationId)) return next(notFound())
    const { hasAnyInOrg } = await rolesIn(req.user._id, organisationId)
    if (!hasAnyInOrg) return next(notFound())
    req.org = { id: organisationId }
    return runWithScope({ organisationId }, () => next())
  }
}

// Requires the organisation already open (requireOrg) and :projectId to name
// a project inside it, then extends the tenant scope to that project. requireOrg
// only checked membership in the organisation as a whole (any role, in any
// project) — a member of a different project in the same org must not reach
// this one, so this also requires some role here: the org's Org Admin, or a
// membership on this exact project. Like requireOrg, anything else is simply
// not found, never a 403 that would confirm the project exists.
export function requireProject() {
  return async (req, res, next) => {
    const projectId = req.params.projectId
    if (!mongoose.isValidObjectId(projectId)) return next(notFound())
    const project = await runWithScope({ organisationId: req.org.id }, () => Project.findById(projectId).lean())
    if (!project) return next(notFound())
    const { roles } = await rolesIn(req.user._id, req.org.id, projectId)
    if (roles.length === 0) return next(notFound())
    req.project = { id: projectId, doc: project }
    return runWithScope({ organisationId: req.org.id, projectId }, () => next())
  }
}

// Checks one policy action against the roles the user holds in this
// organisation (and in the project named by projectIdFrom, or req.project
// when a route sits under requireProject and names nothing else). A View-As
// session already resolved by applyViewAs (req.viewAsActive) is checked
// against the viewed role instead of recomputing the caller's own roles.
export function requireAction(action, { projectIdFrom } = {}) {
  return async (req, res, next) => {
    if (req.viewAsActive) {
      if (!can(req.roles, action)) return next(forbidden())
      return next()
    }
    const resolveProjectId = projectIdFrom ?? ((r) => r.project?.id ?? null)
    const projectId = resolveProjectId(req)
    const { roles } = await rolesIn(req.user._id, req.org.id, projectId)
    if (!can(roles, action)) return next(forbidden())
    req.roles = roles
    return next()
  }
}

export const actorOf = (req) => ({ userId: req.user._id, role: req.roles?.[0] ?? null })

const VIEW_AS_HEADER = 'x-view-as-session'

// Sits after requireProject, before validate/requireAction, on every
// project-scoped read/write route except the View-As start/end routes
// themselves. No header: a no-op. A present header must name a live,
// unexpired session started by this exact user for this exact project
// (M2 approval: bound to the Org Admin who started it, 1 hour TTL) — anything
// else is refused outright, never silently ignored. A GET with a valid
// session substitutes the viewed role for requireAction; any other method
// is refused, because View As is view-only.
export function applyViewAs() {
  return async (req, res, next) => {
    const sessionId = req.get(VIEW_AS_HEADER)
    if (!sessionId) return next()
    if (!mongoose.isValidObjectId(sessionId)) return next(forbidden('View As session is invalid or has expired'))
    const session = await ViewAsSession.findOne({ _id: sessionId, actorUserId: req.user._id, endedAt: null }).lean()
    const live = session && String(session.projectId) === String(req.project?.id) && Date.now() - session.startedAt.getTime() < VIEW_AS_SESSION_TTL_MS
    if (!live) return next(forbidden('View As session is invalid or has expired'))
    if (req.method !== 'GET') return next(forbidden('View As is view-only'))
    req.viewAsActive = true
    req.viewAsSessionId = session._id
    req.roles = [session.viewedRole]
    return next()
  }
}
