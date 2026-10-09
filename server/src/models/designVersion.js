import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.6: a numbered version of a building's design. The full
// design state is a JSON snapshot in `files` (category data_snapshot). An
// approval freezes its version in the same transaction (§10); a frozen
// version never changes.
const designVersionSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  designType: { type: String, enum: ['hld', 'lld', 'solution_package', 'bom'], required: true },
  number: { type: Number, required: true, min: 1 },
  label: { type: String, default: null },
  basedOnVersionId: { type: ObjectId, default: null },
  // The LLD branch the version was saved on (null = the main design).
  branchId: { type: ObjectId, default: null },
  frozen: { type: Boolean, default: false },
  frozenAt: { type: Date, default: null },
  changeSummaries: { type: [String], default: [] },
  snapshotFileId: { type: ObjectId, required: true },
  counts: { devices: { type: Number, default: 0 }, connections: { type: Number, default: 0 } },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

designVersionSchema.__modelName = 'DesignVersion'
tenantScope(designVersionSchema, { scope: 'project' })
designVersionSchema.index({ projectId: 1, buildingId: 1, designType: 1, number: 1 }, { unique: true })

export const DesignVersion = mongoose.models.DesignVersion || mongoose.model('DesignVersion', designVersionSchema)
