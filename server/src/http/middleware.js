import mongoose from 'mongoose'
import { can } from '@rackium/shared/policy.js'
import { User } from '../models/user.js'
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

// Checks one policy action against the roles the user holds in this
// organisation (and in the project named by projectIdFrom, when given).
export function requireAction(action, { projectIdFrom } = {}) {
  return async (req, res, next) => {
    const projectId = projectIdFrom ? projectIdFrom(req) : null
    const { roles } = await rolesIn(req.user._id, req.org.id, projectId)
    if (!can(roles, action)) return next(forbidden())
    req.roles = roles
    return next()
  }
}

export const actorOf = (req) => ({ userId: req.user._id, role: req.roles?.[0] ?? null })
