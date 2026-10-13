import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.5 (M5a): a client approval link. The token (32 random
// bytes, shown once) and the password are never stored: only the token's
// SHA-256 and an argon2id password hash. Wrong passwords count towards a
// lock; expiry is checked again when a decision is submitted.

const extensionSchema = new mongoose.Schema({ extendedBy: ObjectId, extendedAt: Date, previousExpiresAt: Date, newExpiresAt: Date }, { _id: false })

const shareLinkSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  // What the client decides: the Solution Package, or a change request.
  kind: { type: String, enum: ['solution_package', 'change_request'], required: true },
  changeRequestId: { type: ObjectId, default: null },
  approvalId: { type: ObjectId, required: true },
  tokenHash: { type: String, required: true },
  passwordHash: { type: String, required: true },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
  expiresAt: { type: Date, required: true },
  extensions: { type: [extensionSchema], default: [] },
  revokedAt: { type: Date, default: null },
  revokedBy: { type: ObjectId, default: null },
  decidedAt: { type: Date, default: null },
  failedAttempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
})

shareLinkSchema.__modelName = 'ShareLink'
tenantScope(shareLinkSchema, { scope: 'project' })
shareLinkSchema.index({ projectId: 1, tokenHash: 1 }, { unique: true })
shareLinkSchema.index({ projectId: 1, buildingId: 1, createdAt: -1 })

export const ShareLink = mongoose.models.ShareLink || mongoose.model('ShareLink', shareLinkSchema)
