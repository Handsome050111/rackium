import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// What the HLD decides for an existing (CMO) device in the future design
// (M7b-4a, DATA-MODEL §5.21; addendum v2.3 Q5). Existing gear is shared by
// every design layer, so the decision is a design record of its own, per HLD
// layer ('hld' or a change request's 'hld:<branchId>'): copied into a branch,
// promoted with it, discarded with it. The LLD reads it from the HLD.
// Keep is written onto the device itself (future state, the new name, the old
// one in legacyHostname) when the LLD is approved, or by a change request.
const cmoDecisionSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  layer: { type: String, required: true },
  deviceId: { type: ObjectId, required: true },
  decision: { type: String, enum: ['keep', 'replace', 'remove'], required: true },
  // Keep: the role in the future design and the name it gives (the naming
  // pattern; null for a role without one — the device keeps its name).
  role: { type: String, default: null },
  hostname: { type: String, default: null },
  // Replace: the device of this layer's design that takes over.
  replacedById: { type: ObjectId, default: null },
  decidedBy: { type: ObjectId, default: null },
  decidedAt: { type: Date, default: () => new Date() },
})

cmoDecisionSchema.__modelName = 'CmoDecision'
tenantScope(cmoDecisionSchema, { scope: 'project' })
cmoDecisionSchema.index({ projectId: 1, layer: 1, deviceId: 1 }, { unique: true })
cmoDecisionSchema.index({ projectId: 1, buildingId: 1, layer: 1 })

export const CmoDecision = mongoose.models.CmoDecision || mongoose.model('CmoDecision', cmoDecisionSchema)
