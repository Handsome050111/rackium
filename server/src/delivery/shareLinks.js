import crypto from 'node:crypto'
import mongoose from 'mongoose'
import { ShareLink } from '../models/shareLink.js'
import { ShareLinkIndex } from '../models/shareLinkIndex.js'
import { Approval } from '../models/approval.js'
import { SolutionPackage } from '../models/solutionPackage.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { HandoverWorkflow } from '../models/handoverWorkflow.js'
import { hashPassword, verifyPassword } from '../auth/tokens.js'
import { runWithScope, currentScope } from '../tenancy/scopeContext.js'
import { withTransaction } from '../db/transaction.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, conflict, notFound } from '../http/errors.js'
import { namesOf } from './common.js'
import { requireBuilding } from '../access/scope.js'

// Client approval links (brief v2.3 §5.5; DATA-MODEL §5.5, M5a).
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
export const DAY_MS = 24 * 60 * 60 * 1000

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
// 32 random bytes, base64url: shown once in the link, never stored.
export const newToken = () => crypto.randomBytes(32).toString('base64url')
// A readable generated password (no 0/O/1/l/I).
export function newPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export function linkStatus(link, now = new Date()) {
  if (!link) return 'not_found'
  if (link.revokedAt) return 'revoked'
  if (link.decidedAt) return 'decided'
  if (link.expiresAt <= now) return 'expired'
  if (link.lockedUntil && link.lockedUntil > now) return 'locked'
  return 'active'
}

export function linkView(link, names = new Map()) {
  return {
    id: String(link._id),
    kind: link.kind,
    changeRequestId: link.changeRequestId ? String(link.changeRequestId) : null,
    approvalId: link.approvalId ? String(link.approvalId) : null,
    documentIds: (link.documentIds ?? []).map(String),
    label: link.label ?? null,
    hasPassword: Boolean(link.passwordHash),
    downloads: link.downloads ?? 0,
    status: linkStatus(link),
    createdAt: link.createdAt,
    createdBy: names.get(String(link.createdBy)) ?? null,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    decidedAt: link.decidedAt,
    extensions: link.extensions.map((e) => ({ extendedAt: e.extendedAt, extendedBy: names.get(String(e.extendedBy)) ?? null, newExpiresAt: e.newExpiresAt })),
  }
}

// Creates a link (in the caller's transaction). The password is hashed
// before the transaction (argon2 is slow); token and password are returned
// once and never stored.
// `optional`: a download link may have no password at all (M6b).
export async function prepareSecrets(password, { optional = false } = {}) {
  const token = newToken()
  if (optional && !password) return { token, tokenHash: hashToken(token), password: null, passwordHash: null, generatedPassword: false }
  const plain = password ?? newPassword()
  return { token, tokenHash: hashToken(token), password: plain, passwordHash: await hashPassword(plain), generatedPassword: !password }
}
export async function createLink({ building, kind, approvalId = null, changeRequestId = null, documentIds = [], label = null, secrets, expiryDays, actor, session }) {
  const { organisationId, projectId } = currentScope()
  const [link] = await ShareLink.create(
    [{ buildingId: building.id, kind, approvalId, changeRequestId, documentIds, label, tokenHash: secrets.tokenHash, passwordHash: secrets.passwordHash, createdBy: actor.userId, expiresAt: new Date(Date.now() + expiryDays * DAY_MS) }],
    { session }
  )
  await ShareLinkIndex.create([{ tokenHash: secrets.tokenHash, organisationId, projectId, shareLinkId: link._id }], { session })
  return link
}

export async function linksOf(buildingId, filter = {}) {
  const links = await ShareLink.find({ buildingId, ...filter }).sort({ createdAt: -1 }).lean()
  const names = await namesOf(links.flatMap((l) => [l.createdBy, ...l.extensions.map((e) => e.extendedBy)]))
  return links.map((l) => linkView(l, names))
}

// --- PM actions ----------------------------------------------------------------

export function createShareLinkAdmin() {
  async function load(req, linkId) {
    const link = mongoose.isValidObjectId(linkId) ? await ShareLink.findById(linkId).lean() : null
    if (!link) throw notFound('Share link not found')
    const building = await requireBuilding(req, link.buildingId)
    return { link, building }
  }
  const audit = (req, building, actor, action, comment, session) =>
    recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'solution-package', actor: userActor(actor.userId, actor.role), action, objectType: 'ShareLink', objectId: null, changeType: 'design_intent', source: 'ui', comment, session })

  return {
    // A new expiry 1–30 days from now (DATA-MODEL §5.5: PM can extend).
    async extend(req, linkId, { days }, actor) {
      const { link, building } = await load(req, linkId)
      if (link.revokedAt || link.decidedAt) throw conflict('link_closed', 'This link was revoked or already used for a decision')
      const newExpiresAt = new Date(Date.now() + days * DAY_MS)
      return withTransaction(async (session) => {
        await ShareLink.updateOne({ _id: link._id }, { $set: { expiresAt: newExpiresAt }, $push: { extensions: { extendedBy: actor.userId, extendedAt: new Date(), previousExpiresAt: link.expiresAt, newExpiresAt } } }, { session })
        await audit(req, building, actor, 'share_link.extended', `Link ${link._id} extended to ${newExpiresAt.toISOString().slice(0, 10)}`, session)
        return { expiresAt: newExpiresAt }
      })
    },

    // Revoking withdraws the pending decision: the package (or change
    // request) goes back to where it was before it was sent.
    async revoke(req, linkId, actor) {
      const { link, building } = await load(req, linkId)
      if (link.revokedAt) throw conflict('link_closed', 'This link is already revoked')
      if (link.decidedAt) throw conflict('link_closed', 'The client already decided through this link')
      return withTransaction(async (session) => {
        await ShareLink.updateOne({ _id: link._id }, { $set: { revokedAt: new Date(), revokedBy: actor.userId } }, { session })
        if (link.approvalId) await Approval.updateOne({ _id: link.approvalId, status: 'pending' }, { $set: { status: 'expired' } }, { session })
        if (link.kind === 'solution_package') await SolutionPackage.updateOne({ buildingId: link.buildingId, pendingApprovalId: link.approvalId }, { $set: { state: 'draft', pendingApprovalId: null } }, { session })
        else if (link.kind === 'change_request') await ChangeRequest.updateOne({ _id: link.changeRequestId, status: 'awaiting_client' }, { $set: { status: 'submitted', approvalId: null } }, { session })
        // A handover link withdrawn: the package goes back to Under review (M6b).
        else if (link.kind === 'handover') await HandoverWorkflow.updateOne({ buildingId: link.buildingId, state: 'delivered', approvalId: link.approvalId }, { $set: { state: 'under_review', approvalId: null, updatedAt: new Date() }, $inc: { revision: 1 } }, { session })
        await audit(req, building, actor, 'share_link.revoked', `Link ${link._id} revoked`, session)
        return { revoked: String(link._id) }
      })
    },
  }
}

// --- Public access ----------------------------------------------------------------

// The link behind a presented token, inside its tenant scope. `fn(link,
// scope)` runs in that scope.
export async function withLink(token, fn) {
  const entry = token ? await ShareLinkIndex.findOne({ tokenHash: hashToken(token) }).lean() : null
  if (!entry) throw new AppError(404, 'link_not_found', 'This approval link does not exist')
  const scope = { organisationId: entry.organisationId, projectId: entry.projectId }
  return runWithScope(scope, async () => {
    const link = await ShareLink.findById(entry.shareLinkId).lean()
    if (!link) throw new AppError(404, 'link_not_found', 'This approval link does not exist')
    return fn(link, scope)
  })
}

export function assertUsable(link, { forDecision = false } = {}) {
  const status = linkStatus(link)
  if (status === 'revoked') throw new AppError(410, 'link_revoked', 'This approval link was withdrawn. Please ask your project contact for a new one.')
  if (status === 'decided') throw new AppError(409, 'already_decided', 'A decision was already recorded through this link.')
  if (status === 'expired') throw new AppError(410, 'link_expired', forDecision ? 'This approval link expired before your decision was submitted — nothing was recorded. Please ask your project contact to extend it.' : 'This approval link has expired. Please ask your project contact to extend it.')
}

// Password check with a per-link brute-force lock: after MAX_FAILED_ATTEMPTS
// wrong passwords the link is locked for LOCK_MINUTES, even for the right one.
export async function checkPassword(link, password) {
  // A download link without a password (M6b).
  if (!link.passwordHash) return
  if (!password) throw new AppError(401, 'password_required', 'Enter the password you received with this link.')
  const now = new Date()
  if (link.lockedUntil && link.lockedUntil > now) {
    throw new AppError(429, 'link_locked', `Too many wrong passwords. Try again after ${link.lockedUntil.toISOString().slice(11, 16)} UTC.`, { lockedUntil: link.lockedUntil })
  }
  if (await verifyPassword(link.passwordHash, password)) {
    if (link.failedAttempts) await ShareLink.updateOne({ _id: link._id }, { $set: { failedAttempts: 0, lockedUntil: null } })
    return
  }
  const updated = await ShareLink.findOneAndUpdate({ _id: link._id }, { $inc: { failedAttempts: 1 } }, { returnDocument: 'after' }).lean()
  if (updated.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000)
    await ShareLink.updateOne({ _id: link._id }, { $set: { lockedUntil, failedAttempts: 0 } })
    throw new AppError(429, 'link_locked', `Too many wrong passwords. The link is locked for ${LOCK_MINUTES} minutes.`, { lockedUntil })
  }
  throw new AppError(401, 'wrong_password', `Incorrect password (${MAX_FAILED_ATTEMPTS - updated.failedAttempts} attempt(s) left before the link locks).`)
}
