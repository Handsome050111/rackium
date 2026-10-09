import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// The HLD of one building (M4a): its revision (every design write increments
// it, and a write based on an older revision is refused — brief §6.10, no
// stale saves), workflow state and the blueprint it was generated from.
const hldDesignSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  revision: { type: Number, default: 0 },
  // draft → awaiting_approval → approved | changes_requested. An edit after
  // approval starts a new draft; the approved version stays frozen.
  state: { type: String, enum: ['draft', 'awaiting_approval', 'approved', 'changes_requested'], default: 'draft' },
  preset: { type: String, default: null },
  variant: { type: String, default: null },
  pendingApprovalId: { type: ObjectId, default: null },
  latestApprovedVersionId: { type: ObjectId, default: null },
  lastEditedAt: { type: Date, default: null },
  lastEditedBy: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

hldDesignSchema.__modelName = 'HldDesign'
tenantScope(hldDesignSchema, { scope: 'project' })
hldDesignSchema.index({ projectId: 1, buildingId: 1 }, { unique: true })

export const HldDesign = mongoose.models.HldDesign || mongoose.model('HldDesign', hldDesignSchema)
