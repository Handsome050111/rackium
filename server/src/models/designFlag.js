import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.4 [D2, F3]: raised when an imported survey tab is edited, so
// the HLD (M4) can show "survey changed after import". It resolves when the
// tab is verified and imported again. It never changes a phase status.
const designFlagSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  designType: { type: String, enum: ['hld'], default: 'hld' },
  kind: { type: String, enum: ['survey_changed_after_import'], required: true },
  surveyTabRecordId: { type: ObjectId, required: true },
  raisedAt: { type: Date, default: () => new Date() },
  raisedBy: { type: ObjectId, default: null },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: ObjectId, default: null },
})

designFlagSchema.__modelName = 'DesignFlag'
tenantScope(designFlagSchema, { scope: 'project' })

// One open flag per tab record.
designFlagSchema.index({ buildingId: 1, kind: 1, surveyTabRecordId: 1 }, { unique: true, partialFilterExpression: { resolvedAt: null } })

export const DesignFlag = mongoose.models.DesignFlag || mongoose.model('DesignFlag', designFlagSchema)
