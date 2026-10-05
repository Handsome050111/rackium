import mongoose from 'mongoose'

// Identity, global: one person can belong to several organisations through
// memberships. Credentials live here and never leave the auth service.
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  passwordHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['pending_verification', 'active', 'disabled'], default: 'pending_verification' },
  accountType: { type: String, enum: ['customer', 'rackium_team'], default: 'customer' },
  emailVerifiedAt: { type: Date, default: null },
  failedLoginCount: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  mfaEnabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
})

// Unique and case-insensitive. Emails are also lower-cased on write.
userSchema.index({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const User = mongoose.models.User || mongoose.model('User', userSchema)
