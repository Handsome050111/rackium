import mongoose from 'mongoose'

// Refresh tokens are opaque random values. Only their SHA-256 hash is stored.
// A rotated token keeps its family id, so reuse of an old token can revoke the
// whole family (see auth/service.js).
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  familyId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
  userAgent: { type: String, default: null },
  ip: { type: String, default: null },
})

// One-time tokens for email verification and password reset.
const emailTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  purpose: { type: String, enum: ['verify_email', 'reset_password'], required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

export const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema)
export const EmailToken = mongoose.models.EmailToken || mongoose.model('EmailToken', emailTokenSchema)
