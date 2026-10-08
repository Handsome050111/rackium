import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §4.4 [S3]: one row per serial in the project, written in the
// same transaction as its owner. The unique index is the guarantee — a
// duplicate aborts the transaction.
const serialRegistrySchema = new mongoose.Schema({
  serial: { type: String, required: true, trim: true },
  ownerType: { type: String, enum: ['device'], required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  registeredAt: { type: Date, default: () => new Date() },
})

serialRegistrySchema.__modelName = 'SerialRegistry'
tenantScope(serialRegistrySchema, { scope: 'project' })

serialRegistrySchema.index({ projectId: 1, serial: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const SerialRegistry = mongoose.models.SerialRegistry || mongoose.model('SerialRegistry', serialRegistrySchema)
