import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// Organisation custom survey fields (brief §5.2: "Organisations may add
// custom fields; these are stored and exported but do not feed
// calculations"). Organisation-level, authored by the Org Admin; shown in
// section 0 of the tab, requirement always 'unspecified', so never counted
// for completeness. The key is immutable.
const surveyCustomFieldSchema = new mongoose.Schema({
  tab: { type: String, required: true },
  key: { type: String, required: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: ['text', 'number', 'yes_no'], default: 'text' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

surveyCustomFieldSchema.__modelName = 'SurveyCustomField'
tenantScope(surveyCustomFieldSchema, { scope: 'organisation' })

surveyCustomFieldSchema.index({ organisationId: 1, key: 1 }, { unique: true })
surveyCustomFieldSchema.index({ organisationId: 1, tab: 1 })

export const SurveyCustomField = mongoose.models.SurveyCustomField || mongoose.model('SurveyCustomField', surveyCustomFieldSchema)
