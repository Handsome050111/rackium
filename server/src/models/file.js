import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §9.1. The bytes live behind the storage interface
// (files/storage.js) under a private key; there is no public URL. A file
// row is created when its upload completes (Upload holds the in-progress
// state). Soft delete keeps the row for the audit trail.
const fileSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  attachedTo: {
    // designVersion: the JSON snapshot of a design version (category data_snapshot, M4a).
    type: { type: String, enum: ['surveyTabRecord', 'room', 'rack', 'pathway', 'designVersion'], required: true },
    id: { type: ObjectId, required: true },
  },
  category: { type: String, required: true },
  fileName: { type: String, required: true },
  storageKey: { type: String, required: true },
  thumbnailKey: { type: String, default: null },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  widthPx: { type: Number, default: null },
  heightPx: { type: Number, default: null },
  capturedAt: { type: Date, default: null },
  capturedBy: { type: ObjectId, default: null },
  caption: { type: String, default: null },
  sortOrder: { type: Number, default: 0 },
  uploadedAt: { type: Date, default: () => new Date() },
  uploadedBy: { type: ObjectId, required: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: ObjectId, default: null },
})

fileSchema.__modelName = 'File'
tenantScope(fileSchema, { scope: 'project' })

fileSchema.index({ 'attachedTo.type': 1, 'attachedTo.id': 1 })
fileSchema.index({ storageKey: 1 }, { unique: true })

export const File = mongoose.models.File || mongoose.model('File', fileSchema)
