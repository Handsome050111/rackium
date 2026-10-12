import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// Change requests (M5a; brief §5.5, DATA-MODEL §5.9): after the design is
// approved, a change is drafted on its own LLD branch, submitted by the
// Architect and decided by the client through the share-link flow. Approval
// applies the branch to the frozen LLD; history stays against the package.

const changeRequestSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  number: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 4000 },
  reason: { type: String, default: '', maxlength: 2000 },
  affectedItems: { type: [String], default: [] },
  // draft → submitted → awaiting_client → approved | changes_requested (→ submitted again) | rejected; withdrawn.
  status: { type: String, enum: ['draft', 'submitted', 'awaiting_client', 'approved', 'changes_requested', 'rejected', 'withdrawn'], default: 'draft' },
  branchId: { type: ObjectId, required: true },
  baseLldVersionId: { type: ObjectId, default: null },
  // Captured at submit: the design diff and the BOM impact the client decides on.
  impact: { type: mongoose.Schema.Types.Mixed, default: null },
  approvalId: { type: ObjectId, default: null },
  resultingVersionId: { type: ObjectId, default: null },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
  submittedBy: { type: ObjectId, default: null },
  submittedAt: { type: Date, default: null },
  decidedAt: { type: Date, default: null },
})

changeRequestSchema.__modelName = 'ChangeRequest'
tenantScope(changeRequestSchema, { scope: 'project' })
changeRequestSchema.index({ projectId: 1, buildingId: 1, number: 1 }, { unique: true })

export const ChangeRequest = mongoose.models.ChangeRequest || mongoose.model('ChangeRequest', changeRequestSchema)
