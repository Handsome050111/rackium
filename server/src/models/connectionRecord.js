import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// The as-built record of one designed connection (DATA-MODEL §5.3; M6a):
// what was patched, per end and per cable segment (cable ID, Installed
// length), the link test and acceptance. Keyed by the main LLD connection id,
// which survives a change request's promotion.
const segmentSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true },
    cableId: { type: String, default: null },
    installedM: { type: Number, default: null },
    confirmed: { type: Boolean, default: false },
  },
  { _id: false }
)

const connectionRecordSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  connectionId: { type: ObjectId, required: true },
  status: { type: String, enum: ['draft', 'installed', 'tested', 'faulty', 'accepted', 'retired'], default: 'draft' },
  retiredAt: { type: Date, default: null },
  installed: {
    sourcePort: { type: String, default: null },
    destPort: { type: String, default: null },
    media: { type: String, default: null },
    sourceSfpCode: { type: String, default: null },
    destSfpCode: { type: String, default: null },
    segments: { type: [segmentSchema], default: [] },
  },
  installedBy: { type: ObjectId, default: null },
  installedByName: { type: String, default: null },
  installedAt: { type: Date, default: null },
  test: {
    result: { type: String, enum: ['pass', 'fail', null], default: null },
    note: { type: String, default: null },
    by: { type: ObjectId, default: null },
    byName: { type: String, default: null },
    at: { type: Date, default: null },
  },
  acceptedBy: { type: ObjectId, default: null },
  acceptedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

connectionRecordSchema.__modelName = 'ConnectionRecord'
tenantScope(connectionRecordSchema, { scope: 'project' })
connectionRecordSchema.index({ projectId: 1, connectionId: 1 }, { unique: true })

export const ConnectionRecord = mongoose.models.ConnectionRecord || mongoose.model('ConnectionRecord', connectionRecordSchema)
