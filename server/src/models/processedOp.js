import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// Makes offline replay idempotent: each queued edit carries a client-made
// opId, recorded in the same transaction as the edit. A sync that is retried
// after a dropped connection re-sends ops that already applied; they are
// recognised here and answered with the original outcome, never applied twice.
const processedOpSchema = new mongoose.Schema({
  opId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
  processedAt: { type: Date, default: () => new Date() },
})

processedOpSchema.__modelName = 'ProcessedOp'
tenantScope(processedOpSchema, { scope: 'project' })

processedOpSchema.index({ projectId: 1, opId: 1 }, { unique: true })

export const ProcessedOp = mongoose.models.ProcessedOp || mongoose.model('ProcessedOp', processedOpSchema)
