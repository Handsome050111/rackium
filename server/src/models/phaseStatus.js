import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §5.1. Stored only for approval-driven phases (hld, lld,
// solution-package, bom, handover); cmo/survey/deployment/cmdb are computed
// from their own records elsewhere and never stored here. For M2 this model
// exists so phase gating and the dashboard have something to read — nothing
// writes a non-not_started status yet (that arrives with each phase's module).
const phaseStatusSchema = new mongoose.Schema({
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  phaseKey: { type: String, required: true },
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'awaiting_approval', 'changes_requested', 'blocked', 'approved', 'completed'],
    default: 'not_started',
  },
  subLabel: { type: String, default: null },
  updatedAt: { type: Date, default: () => new Date() },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
})

phaseStatusSchema.__modelName = 'PhaseStatus'
tenantScope(phaseStatusSchema, { scope: 'project' })

phaseStatusSchema.index({ buildingId: 1, phaseKey: 1 }, { unique: true })

export const PhaseStatus = mongoose.models.PhaseStatus || mongoose.model('PhaseStatus', phaseStatusSchema)
