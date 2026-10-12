import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// The procurement BOM of one building (M5a; brief §5.6): approved by the PM
// after the Solution Package approval. The BOM lines themselves are always
// calculated; an approval stores a frozen BOM version to compare against.

const bomDesignSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  approvedVersionId: { type: ObjectId, default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: ObjectId, default: null },
  approvalId: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

bomDesignSchema.__modelName = 'BomDesign'
tenantScope(bomDesignSchema, { scope: 'project' })
bomDesignSchema.index({ projectId: 1, buildingId: 1 }, { unique: true })

export const BomDesign = mongoose.models.BomDesign || mongoose.model('BomDesign', bomDesignSchema)
