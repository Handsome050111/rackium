import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { DOCUMENT_TYPE_KEYS, DOCUMENT_FORMATS } from '@rackium/shared/documents/types.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.12 (M6b): one generated document — a queued job until it is
// ready, then a versioned record pointing at its file. Versions count per
// building, type and format. The file id is chosen when the job is queued, so
// a run repeated after a crash writes the same file, never a second one.
const generatedDocumentSchema = new mongoose.Schema({
  // Null for project-level documents (the audit log export).
  buildingId: { type: ObjectId, default: null },
  typeKey: { type: String, enum: DOCUMENT_TYPE_KEYS, required: true },
  format: { type: String, enum: DOCUMENT_FORMATS, required: true },
  version: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['queued', 'generating', 'ready', 'failed'], default: 'queued' },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  step: { type: String, default: null },
  error: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  // What was asked: price mode, label size and connections, audit filters…
  options: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // The same request while one is queued or generating returns that one.
  requestKey: { type: String, required: true },
  // The approved design versions the document was generated from.
  sourceVersionIds: { type: [ObjectId], default: [] },
  // The requester, whose roles and scope the data is read with.
  requestedBy: { type: ObjectId, required: true },
  requestedByName: { type: String, default: null },
  requestedRoles: { type: [String], default: [] },
  requestedScopes: { type: mongoose.Schema.Types.Mixed, default: () => [] },
  requestedAt: { type: Date, default: () => new Date() },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  // The PDF watermark (v2.2 §11.8): organisation, date, user.
  watermark: { type: new mongoose.Schema({ organisation: String, date: String, user: String }, { _id: false }), default: null },
  // Part of a handover package (compile round), if any.
  handover: { type: new mongoose.Schema({ workflowId: ObjectId, round: Number }, { _id: false }), default: null },
  fileId: { type: ObjectId, required: true },
  fileName: { type: String, default: null },
  sizeBytes: { type: Number, default: null },
  sha256: { type: String, default: null },
  pageCount: { type: Number, default: null },
})

generatedDocumentSchema.__modelName = 'GeneratedDocument'
tenantScope(generatedDocumentSchema, { scope: 'project' })
generatedDocumentSchema.index({ projectId: 1, buildingId: 1, typeKey: 1, format: 1, version: -1 }, { unique: true })
generatedDocumentSchema.index({ projectId: 1, status: 1, requestedAt: 1 })
generatedDocumentSchema.index({ projectId: 1, requestKey: 1, status: 1 })

export const GeneratedDocument = mongoose.models.GeneratedDocument || mongoose.model('GeneratedDocument', generatedDocumentSchema)
