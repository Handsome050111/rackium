import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §5.10, human-raised blockers only. Calculated blockers (RU
// conflicts, unpriced BOM lines, unassigned CMO devices) are not rows here —
// they arrive with the modules that calculate them (M3+).
const blockerSchema = new mongoose.Schema({
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  phaseKey: { type: String, required: true },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  relatedObjectType: { type: String, default: null },
  relatedObjectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  raisedAt: { type: Date, default: () => new Date(), required: true },
  raisedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
})

blockerSchema.__modelName = 'Blocker'
tenantScope(blockerSchema, { scope: 'project' })

blockerSchema.index({ buildingId: 1, status: 1 })

export const Blocker = mongoose.models.Blocker || mongoose.model('Blocker', blockerSchema)
