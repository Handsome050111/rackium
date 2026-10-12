import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// The LLD of one building (M4b): its revision (stale saves are refused, as
// in the HLD), workflow state and the approved HLD version it is based on
// (brief §5.4; DATA-MODEL §5.6 basedOnVersionId).
const lldDesignSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  revision: { type: Number, default: 0 },
  state: { type: String, enum: ['draft', 'awaiting_approval', 'approved', 'changes_requested'], default: 'draft' },
  basedOnHldVersionId: { type: ObjectId, required: true },
  basedOnHldNumber: { type: Number, required: true },
  pendingApprovalId: { type: ObjectId, default: null },
  latestApprovedVersionId: { type: ObjectId, default: null },
  lastEditedAt: { type: Date, default: null },
  lastEditedBy: { type: ObjectId, default: null },
  startedBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

lldDesignSchema.__modelName = 'LldDesign'
tenantScope(lldDesignSchema, { scope: 'project' })
lldDesignSchema.index({ projectId: 1, buildingId: 1 }, { unique: true })

export const LldDesign = mongoose.models.LldDesign || mongoose.model('LldDesign', lldDesignSchema)
