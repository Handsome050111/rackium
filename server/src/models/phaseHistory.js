import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.10 (M7a-1): when a building's phase was completed (or
// reopened). Append-only — every update and delete is refused by the model.
// `dateKnown: false` (backfill without evidence): no date is invented.
const phaseHistorySchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  phaseKey: { type: String, required: true },
  event: { type: String, enum: ['completed', 'reopened'], required: true },
  at: { type: Date, default: null },
  on: { type: String, default: null },
  dateKnown: { type: Boolean, required: true },
  source: { type: String, enum: ['live', 'derived'], required: true },
  evidence: { type: new mongoose.Schema({ auditEntryId: ObjectId, action: String }, { _id: false }), default: null },
  recordedAt: { type: Date, default: () => new Date() },
})

phaseHistorySchema.__modelName = 'PhaseHistory'
tenantScope(phaseHistorySchema, { scope: 'project' })
phaseHistorySchema.index({ projectId: 1, buildingId: 1, phaseKey: 1, recordedAt: 1 })

const refuse = function refuse() {
  throw new Error('Phase history is append-only')
}
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) phaseHistorySchema.pre(op, refuse)
phaseHistorySchema.pre('save', function onlyNew() {
  if (!this.isNew) throw new Error('Phase history is append-only')
})

export const PhaseHistory = mongoose.models.PhaseHistory || mongoose.model('PhaseHistory', phaseHistorySchema, 'phasehistory')
