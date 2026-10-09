import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// An upload in progress. Chunks are appended to a temporary object; the
// client asks how much arrived and carries on from there after an
// interruption. On completion the size and SHA-256 are checked, the content
// type is sniffed, and the File row (same _id as `fileId`) is created.
const uploadSchema = new mongoose.Schema({
  fileId: { type: ObjectId, required: true },
  buildingId: { type: ObjectId, required: true },
  attachedTo: { type: { type: String, required: true }, id: { type: ObjectId, required: true } },
  category: { type: String, required: true },
  fileName: { type: String, required: true },
  declaredMimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  sha256: { type: String, required: true },
  limitBytes: { type: Number, required: true },
  receivedBytes: { type: Number, default: 0 },
  tempKey: { type: String, required: true },
  capturedAt: { type: Date, default: null },
  caption: { type: String, default: null },
  status: { type: String, enum: ['receiving', 'completed'], default: 'receiving' },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

uploadSchema.__modelName = 'Upload'
tenantScope(uploadSchema, { scope: 'project' })

uploadSchema.index({ projectId: 1, fileId: 1 }, { unique: true })

export const Upload = mongoose.models.Upload || mongoose.model('Upload', uploadSchema)
