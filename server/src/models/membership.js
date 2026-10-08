import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// Organisation-level rows have projectId null. Project-level rows name a
// project. Scopes limit a project membership to countries, SALs or buildings;
// an empty list means the whole project (DATA-MODEL §1.6, D5).
const scopeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['country', 'sal', 'building'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
)

const membershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  level: { type: String, enum: ['organisation', 'project'], required: true },
  // Organisation level: 'org_admin', or 'member' (no admin rights; holds
  // organisation-level permissions). Project level: the five project roles.
  role: { type: String, enum: ['org_admin', 'member', 'pm', 'architect', 'reviewer', 'field_engineer', 'viewer'], required: true },
  // Organisation level only. Org Admin can always create projects regardless
  // (shared/policy.js canCreateProjects); this flag is for everyone else.
  canCreateProjects: { type: Boolean, default: false },
  scopes: { type: [scopeSchema], default: [] },
  active: { type: Boolean, default: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
  revokedAt: { type: Date, default: null },
})

membershipSchema.__modelName = 'Membership'

// Identity lookups (listing a user's memberships at sign-in) are permitted by
// userId only; every other read needs the organisation scope.
tenantScope(membershipSchema, { scope: 'organisation', identityLookup: true })

membershipSchema.index(
  { organisationId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { level: 'organisation', active: true } }
)
membershipSchema.index(
  { projectId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { level: 'project', active: true } }
)

export const Membership = mongoose.models.Membership || mongoose.model('Membership', membershipSchema)
