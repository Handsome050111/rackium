import mongoose from 'mongoose'
import { ORG_ROLE } from '@rackium/shared/policy.js'
import { User } from '../models/user.js'
import { Organisation } from '../models/organisation.js'
import { Membership } from '../models/membership.js'
import { Invitation } from '../models/invitation.js'
import { RefreshToken, EmailToken } from '../models/tokens.js'
import { withTransaction } from '../db/transaction.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor, systemActor } from '../audit/audit.js'
import { AppError, conflict, unauthorised } from '../http/errors.js'
import { hashToken, randomToken, hashPassword, verifyPassword, dummyPasswordHash, signAccessToken, REFRESH_TOKEN_TTL_DAYS } from './tokens.js'

const { ObjectId } = mongoose.Types
const DAY_MS = 24 * 3600 * 1000
const MAX_FAILED_LOGINS = 10
const LOCK_MS = 15 * 60 * 1000
const VERIFY_TTL_MS = 24 * 3600 * 1000
const RESET_TTL_MS = 60 * 60 * 1000
const INVITE_TTL_MS = 7 * DAY_MS

export const ACCEPTED = Object.freeze({ message: 'If that request can be completed, we have sent an email with the next step.' })

const invalidCredentials = () => new AppError(401, 'invalid_credentials', 'Email or password is not correct')
const invalidLink = () => new AppError(400, 'link_invalid', 'This link is invalid or has expired')

// Memberships of an identity, read with the identity scope (userId only).
export async function membershipsForUser(userId, { session } = {}) {
  return runWithScope({ identityUserId: userId }, () => Membership.find({ active: true }).session(session ?? null).sort({ createdAt: 1 }).lean())
}

// The organisation an identity-level event (sign-in, reset) is filed under.
export async function primaryOrganisationId(userId, { session } = {}) {
  const rows = await membershipsForUser(userId, { session })
  const org = rows.find((r) => r.level === 'organisation') ?? rows[0]
  return org ? org.organisationId : null
}

export function createAuthService({ config, mailer, logger }) {
  const link = (path, params) => {
    const url = new URL(path, config.PUBLIC_APP_URL)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return url.toString()
  }

  async function issueSession({ userId, familyId, meta, session }) {
    const refresh = randomToken()
    const doc = new RefreshToken({
      userId,
      familyId: familyId ?? randomToken(12),
      tokenHash: hashToken(refresh),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    })
    await doc.save({ session })
    const access = await signAccessToken(userId, config.JWT_SECRET, doc.familyId)
    return { access, refresh, familyId: doc.familyId, refreshId: doc._id }
  }

  async function revokeFamily(familyId, now = new Date()) {
    await RefreshToken.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: now } })
  }

  return {
    async signUp({ organisationName, name, email, password }) {
      if (await User.exists({ email })) {
        await dummyPasswordHash()
        await recordAudit({ actor: systemActor(), action: 'auth.signup_rejected', objectType: 'User', changeType: 'system', source: 'ui', comment: 'email already registered' })
        return ACCEPTED
      }
      const passwordHash = await hashPassword(password)
      const verifyToken = randomToken()
      const orgId = new ObjectId()
      const userId = new ObjectId()

      await withTransaction(async (session) => {
        await Organisation.create([{ _id: orgId, name: organisationName }], { session })
        await User.create([{ _id: userId, email, name, passwordHash, status: 'pending_verification' }], { session })
        await runWithScope({ organisationId: orgId }, () =>
          Membership.create([{ userId, level: 'organisation', role: ORG_ROLE, invitedBy: null }], { session })
        )
        await EmailToken.create([{ userId, purpose: 'verify_email', tokenHash: hashToken(verifyToken), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) }], { session })
        await recordAudit({ organisationId: orgId, actor: userActor(userId, ORG_ROLE), action: 'organisation.created', objectType: 'Organisation', objectId: orgId, changeType: 'design_intent', source: 'ui', session })
        await recordAudit({ organisationId: orgId, actor: userActor(userId, ORG_ROLE), action: 'auth.signup', objectType: 'User', objectId: userId, changeType: 'system', source: 'ui', session })
      })

      await mailer.send({
        to: email,
        subject: 'Confirm your Rackium account',
        text: `Confirm your email to start using Rackium:\n\n${link('/verify-email', { token: verifyToken })}\n\nThis link expires in 24 hours.`,
      })
      return ACCEPTED
    },

    async verifyEmail({ token }) {
      const record = await EmailToken.findOne({ tokenHash: hashToken(token), purpose: 'verify_email', usedAt: null, expiresAt: { $gt: new Date() } })
      if (!record) throw invalidLink()
      await withTransaction(async (session) => {
        const user = await User.findOneAndUpdate(
          { _id: record.userId, status: 'pending_verification' },
          { $set: { status: 'active', emailVerifiedAt: new Date() } },
          { returnDocument: 'after', session }
        )
        await EmailToken.updateOne({ _id: record._id }, { $set: { usedAt: new Date() } }, { session })
        if (user) {
          const orgId = await primaryOrganisationId(user._id, { session })
          await recordAudit({ organisationId: orgId, actor: userActor(user._id), action: 'auth.email_verified', objectType: 'User', objectId: user._id, changeType: 'system', source: 'ui', session })
        }
      })
      return { ok: true }
    },

    // Issues a fresh link and retires every earlier unused one. The reply is the
    // same whether or not the address has a pending account.
    async resendVerification({ email }) {
      const user = await User.findOne({ email, status: 'pending_verification' })
      if (user) {
        const now = new Date()
        await EmailToken.updateMany({ userId: user._id, purpose: 'verify_email', usedAt: null }, { $set: { usedAt: now } })
        const token = randomToken()
        await EmailToken.create({ userId: user._id, purpose: 'verify_email', tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + VERIFY_TTL_MS) })
        const orgId = await primaryOrganisationId(user._id)
        await recordAudit({ organisationId: orgId, actor: userActor(user._id), action: 'auth.verification_resent', objectType: 'User', objectId: user._id, changeType: 'system', source: 'ui', comment: 'previous links invalidated' })
        await mailer.send({
          to: user.email,
          subject: 'Confirm your Rackium account',
          text: `Confirm your email to start using Rackium:\n\n${link('/verify-email', { token })}\n\nThis link expires in 24 hours. Any earlier link no longer works.`,
        })
      }
      return ACCEPTED
    },

    async login({ email, password, meta }) {
      const user = await User.findOne({ email }).select('+passwordHash')
      if (!user) {
        await verifyPassword(await dummyPasswordHash(), password)
        await recordAudit({ actor: systemActor(), action: 'auth.login_failed', objectType: 'User', changeType: 'system', source: 'ui', comment: 'unknown account' })
        throw invalidCredentials()
      }
      const orgId = await primaryOrganisationId(user._id)
      const audit = (action, comment = null) =>
        recordAudit({ organisationId: orgId, actor: userActor(user._id), action, objectType: 'User', objectId: user._id, changeType: 'system', source: 'ui', comment })

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await audit('auth.login_blocked', 'account temporarily locked')
        throw invalidCredentials()
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        user.failedLoginCount += 1
        if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
          user.lockedUntil = new Date(Date.now() + LOCK_MS)
          user.failedLoginCount = 0
        }
        await user.save()
        await audit('auth.login_failed', 'wrong password')
        throw invalidCredentials()
      }
      if (user.status === 'disabled') {
        await audit('auth.login_blocked', 'account disabled')
        throw invalidCredentials()
      }
      if (user.status === 'pending_verification') {
        await audit('auth.login_unverified', 'email not verified')
        throw new AppError(403, 'email_not_verified', 'Confirm your email address before signing in')
      }

      user.failedLoginCount = 0
      user.lockedUntil = null
      user.lastLoginAt = new Date()
      await user.save()
      const session = await issueSession({ userId: user._id, meta })
      await audit('auth.login')
      return { user, tokens: session }
    },

    async refresh({ refreshToken, meta }) {
      if (!refreshToken) throw unauthorised('Sign in again')
      const hash = hashToken(refreshToken)
      const now = new Date()
      // Atomic claim: only one caller can move a live token to revoked.
      const claimed = await RefreshToken.findOneAndUpdate(
        { tokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { revokedAt: now } },
        { returnDocument: 'before' }
      )
      if (!claimed) {
        const seen = await RefreshToken.findOne({ tokenHash: hash })
        if (seen?.replacedBy) {
          // A token that was already rotated is being presented again: treat the
          // whole family as compromised and end it.
          await revokeFamily(seen.familyId, now)
          const orgId = await primaryOrganisationId(seen.userId)
          await recordAudit({ organisationId: orgId, actor: userActor(seen.userId), action: 'auth.refresh_reuse_detected', objectType: 'User', objectId: seen.userId, changeType: 'system', source: 'ui', comment: 'family revoked' })
        }
        throw unauthorised('Sign in again')
      }
      const user = await User.findById(claimed.userId)
      if (!user || user.status !== 'active') {
        await revokeFamily(claimed.familyId, now)
        throw unauthorised('Sign in again')
      }
      const next = await issueSession({ userId: user._id, familyId: claimed.familyId, meta })
      await RefreshToken.updateOne({ _id: claimed._id }, { $set: { replacedBy: next.refreshId } })
      return { user, tokens: next }
    },

    async logout({ refreshToken }) {
      if (!refreshToken) return
      const doc = await RefreshToken.findOne({ tokenHash: hashToken(refreshToken) })
      if (!doc) return
      await revokeFamily(doc.familyId)
      const orgId = await primaryOrganisationId(doc.userId)
      await recordAudit({ organisationId: orgId, actor: userActor(doc.userId), action: 'auth.logout', objectType: 'User', objectId: doc.userId, changeType: 'system', source: 'ui' })
    },

    async requestPasswordReset({ email }) {
      const user = await User.findOne({ email })
      if (user && user.status === 'active') {
        const token = randomToken()
        await EmailToken.create({ userId: user._id, purpose: 'reset_password', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) })
        const orgId = await primaryOrganisationId(user._id)
        await recordAudit({ organisationId: orgId, actor: userActor(user._id), action: 'auth.password_reset_requested', objectType: 'User', objectId: user._id, changeType: 'system', source: 'ui' })
        await mailer.send({
          to: user.email,
          subject: 'Reset your Rackium password',
          text: `Reset your password using this link:\n\n${link('/password-reset/confirm', { token })}\n\nThis link expires in one hour. If you did not ask for this, ignore this email.`,
        })
      }
      return ACCEPTED
    },

    async confirmPasswordReset({ token, password }) {
      const record = await EmailToken.findOne({ tokenHash: hashToken(token), purpose: 'reset_password', usedAt: null, expiresAt: { $gt: new Date() } })
      if (!record) throw invalidLink()
      const passwordHash = await hashPassword(password)
      await withTransaction(async (session) => {
        const user = await User.findByIdAndUpdate(
          record.userId,
          { $set: { passwordHash, failedLoginCount: 0, lockedUntil: null } },
          { session }
        )
        await EmailToken.updateOne({ _id: record._id }, { $set: { usedAt: new Date() } }, { session })
        await RefreshToken.updateMany({ userId: record.userId, revokedAt: null }, { $set: { revokedAt: new Date() } }, { session })
        const orgId = user ? await primaryOrganisationId(user._id, { session }) : null
        await recordAudit({ organisationId: orgId, actor: userActor(record.userId), action: 'auth.password_reset', objectType: 'User', objectId: record.userId, changeType: 'system', source: 'ui', comment: 'all sessions ended', session })
      })
      return { ok: true }
    },

    // Invitations are tenant data, so the accept request names the organisation
    // and the lookup runs inside that scope. Nothing searches across tenants.
    async acceptInvitation({ organisationId, token, name, password, meta }) {
      const invitation = await runWithScope({ organisationId }, () =>
        Invitation.findOne({ tokenHash: hashToken(token), status: 'pending', expiresAt: { $gt: new Date() } })
      )
      if (!invitation) throw invalidLink()

      let user = await User.findOne({ email: invitation.email }).select('+passwordHash')
      if (user) {
        if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials()
      } else {
        if (!name || !password || password.length < 12) {
          throw new AppError(400, 'details_required', 'Enter your name and a password of at least 12 characters to accept')
        }
      }

      const isDuplicate = user && (await membershipsForUser(user._id)).some(
        (m) => String(m.organisationId) === String(organisationId) && m.level === invitation.level && String(m.projectId ?? '') === String(invitation.projectId ?? '') && m.active
      )
      if (isDuplicate) throw conflict('already_member', 'You already have access to this')

      await withTransaction(async (session) => {
        if (!user) {
          const passwordHash = await hashPassword(password)
          const [created] = await User.create([{ email: invitation.email, name, passwordHash, status: 'active', emailVerifiedAt: new Date() }], { session })
          user = created
        }
        await runWithScope({ organisationId, projectId: invitation.projectId }, () =>
          Membership.create([{ userId: user._id, level: invitation.level, projectId: invitation.projectId ?? null, role: invitation.role, scopes: invitation.scopes, invitedBy: invitation.invitedBy }], { session })
        )
        await runWithScope({ organisationId }, () =>
          Invitation.updateOne({ _id: invitation._id }, { $set: { status: 'accepted', acceptedAt: new Date() } }, { session })
        )
        await recordAudit({
          organisationId,
          projectId: invitation.projectId,
          actor: userActor(user._id, invitation.role),
          action: 'invitation.accepted',
          objectType: 'Invitation',
          objectId: invitation._id,
          changeType: 'design_intent',
          source: 'ui',
          session,
        })
      })

      // The invitation was sent to this address, so accepting it proves ownership.
      if (user.status === 'pending_verification') {
        user.status = 'active'
        user.emailVerifiedAt = new Date()
      }
      user.lastLoginAt = new Date()
      await user.save()
      const tokens = await issueSession({ userId: user._id, meta })
      return { user, tokens }
    },

    inviteLink(organisationId, token) {
      return link('/invite', { org: String(organisationId), token })
    },

    INVITE_TTL_MS,
    logger,
  }
}
