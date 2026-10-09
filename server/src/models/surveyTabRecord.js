import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId, Mixed } = mongoose.Schema.Types

// DATA-MODEL §5.4. One record per (building, room, tab); roomId null for
// building-scope tabs. Field values carry who last set them and when, so an
// offline conflict report can say who made the other change. `value` is
// string | number | boolean | null, or { fileIds } for photo/file fields —
// checked against the template field's type by shared/src/surveyForm.js
// before it is written, so it is stored as Mixed.
const fieldValueSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: Mixed, default: null },
    confirmed: { type: Boolean, default: false },
    updatedBy: { type: ObjectId, default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
)
const rowSchema = new mongoose.Schema(
  {
    rowId: { type: ObjectId, default: null },
    rackId: { type: ObjectId, default: null },
    rowKey: { type: String, default: null },
    fieldValues: { type: [fieldValueSchema], default: [] },
  },
  { _id: false }
)
const sectionSchema = new mongoose.Schema(
  {
    sectionIndex: { type: Number, required: true },
    layout: { type: String, required: true },
    fieldValues: { type: [fieldValueSchema], default: [] },
    rows: { type: [rowSchema], default: [] },
  },
  { _id: false }
)
const stamp = new mongoose.Schema({ at: Date, by: ObjectId, reason: String }, { _id: false })

const surveyTabRecordSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  roomId: { type: ObjectId, default: null },
  tab: { type: String, required: true },
  templateVersion: { type: String, required: true },
  sections: { type: [sectionSchema], default: [] },
  status: { type: String, enum: ['draft', 'submitted', 'verified', 'rejected', 'imported'], default: 'draft' },
  submitted: { type: stamp, default: null },
  verified: { type: stamp, default: null },
  rejected: { type: stamp, default: null },
  imported: { type: stamp, default: null },
  hasData: { type: Boolean, default: false },
  lastModifiedAt: { type: Date, default: () => new Date() },
  lastModifiedBy: { type: ObjectId, default: null },
  version: { type: Number, default: 0 },
})

surveyTabRecordSchema.__modelName = 'SurveyTabRecord'
tenantScope(surveyTabRecordSchema, { scope: 'project' })

surveyTabRecordSchema.index({ projectId: 1, buildingId: 1, roomId: 1, tab: 1 }, { unique: true })

export const SurveyTabRecord = mongoose.models.SurveyTabRecord || mongoose.model('SurveyTabRecord', surveyTabRecordSchema)
