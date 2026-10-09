import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.6 `branches` [B §6.10]: an alternative working copy of a
// building's LLD, in its own design layer ('lld:<branchId>'). Promotion makes
// it the main design; discard is terminal; there is no merge.
const designBranchSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  designType: { type: String, enum: ['lld'], default: 'lld' },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  // The version it started from (null = the main design as it was).
  parentVersionId: { type: ObjectId, default: null },
  status: { type: String, enum: ['open', 'promoted', 'discarded'], default: 'open' },
  revision: { type: Number, default: 0 },
  lastEditedAt: { type: Date, default: null },
  lastEditedBy: { type: ObjectId, default: null },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
  resolvedBy: { type: ObjectId, default: null },
  resolvedAt: { type: Date, default: null },
})

designBranchSchema.__modelName = 'DesignBranch'
tenantScope(designBranchSchema, { scope: 'project' })
designBranchSchema.index({ projectId: 1, buildingId: 1, status: 1 })

export const DesignBranch = mongoose.models.DesignBranch || mongoose.model('DesignBranch', designBranchSchema)
