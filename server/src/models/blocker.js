import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §5.10. Human-raised blockers, plus (M3a) one system-raised
// blocker per Unassigned CMO device: brief v2.3 §5.1 "each unassigned device
// counts as an open blocker", kept as a row (relatedObjectType 'device') so
// it shows, is owned and is resolved like any other. Those sit at SAL level
// — no building yet — so a blocker belongs to a building or to a SAL.
const blockerSchema = new mongoose.Schema({
  buildingId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  salId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  phaseKey: { type: String, required: true },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  relatedObjectType: { type: String, default: null },
  relatedObjectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  // 'system' blockers are raised and resolved by the module that owns them
  // (e.g. the CMO import and assignment), never by hand.
  source: { type: String, enum: ['user', 'system'], default: 'user' },
  raisedAt: { type: Date, default: () => new Date(), required: true },
  raisedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
})

blockerSchema.pre('validate', function belongsToBuildingOrSal() {
  if (!this.buildingId && !this.salId) this.invalidate('buildingId', 'A blocker belongs to a building or a SAL')
})

blockerSchema.__modelName = 'Blocker'
tenantScope(blockerSchema, { scope: 'project' })

blockerSchema.index({ buildingId: 1, status: 1 })
blockerSchema.index({ salId: 1, status: 1 })
blockerSchema.index({ relatedObjectType: 1, relatedObjectId: 1 })

export const Blocker = mongoose.models.Blocker || mongoose.model('Blocker', blockerSchema)
