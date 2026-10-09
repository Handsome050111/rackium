import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.4 [S3, F4]: cable IDs and hop segment IDs share one
// namespace per project, case-insensitive. A retired ID keeps its row, so it
// is never reused.
const cableIdRegistrySchema = new mongoose.Schema({
  // Per design layer (M4b): a branch carries the same cables as its main design.
  layer: { type: String, default: 'hld' },
  cableId: { type: String, required: true, trim: true },
  cableKey: { type: String, required: true },
  ownerType: { type: String, enum: ['connection', 'hop'], required: true },
  connectionId: { type: ObjectId, required: true },
  hopSeq: { type: Number, default: null },
  status: { type: String, enum: ['reserved', 'retired'], default: 'reserved' },
  reservedAt: { type: Date, default: () => new Date() },
})

cableIdRegistrySchema.__modelName = 'CableIdRegistry'
tenantScope(cableIdRegistrySchema, { scope: 'project' })
cableIdRegistrySchema.index({ projectId: 1, layer: 1, cableKey: 1 }, { unique: true })

export const CableIdRegistry = mongoose.models.CableIdRegistry || mongoose.model('CableIdRegistry', cableIdRegistrySchema)
