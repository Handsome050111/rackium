import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.10 (M7a-1): a building's planned dates for one phase, as
// local calendar dates 'YYYY-MM-DD' in the organisation's time zone. A bar
// starts at the previous phase's target unless `startDate` is set.
const phaseTargetSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  phaseKey: { type: String, required: true },
  startDate: { type: String, default: null },
  targetDate: { type: String, default: null },
  // The target date the "phase overdue" alert was sent for (once per date).
  overdueNotifiedFor: { type: String, default: null },
  setBy: { type: ObjectId, required: true },
  setAt: { type: Date, default: () => new Date() },
})

phaseTargetSchema.__modelName = 'PhaseTarget'
tenantScope(phaseTargetSchema, { scope: 'project' })
phaseTargetSchema.index({ projectId: 1, buildingId: 1, phaseKey: 1 }, { unique: true })

export const PhaseTarget = mongoose.models.PhaseTarget || mongoose.model('PhaseTarget', phaseTargetSchema)
