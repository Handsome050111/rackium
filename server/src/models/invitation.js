import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// An invitation grants a membership once accepted. The token is stored hashed.
const invitationSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true },
  level: { type: String, enum: ['organisation', 'project'], required: true },
  role: { type: String, enum: ['org_admin', 'pm', 'architect', 'reviewer', 'field_engineer', 'viewer'], required: true },
  scopes: { type: [{ type: { type: String, enum: ['country', 'sal', 'building'] }, refId: mongoose.Schema.Types.ObjectId }], default: [] },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], default: 'pending' },
  acceptedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

invitationSchema.__modelName = 'Invitation'
tenantScope(invitationSchema, { scope: 'organisation' })

invitationSchema.index({ organisationId: 1, email: 1, status: 1 })

export const Invitation = mongoose.models.Invitation || mongoose.model('Invitation', invitationSchema)
