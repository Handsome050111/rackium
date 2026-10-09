import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.2 [D1]: reserved and blocked RUs, separate from devices. One
// row per RU. Reserved is set and released by the Architect; blocked by PM
// or Org Admin, and the Architect cannot override it. A released row stays
// for the record (releasedAt).
const ruStateSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  rackId: { type: ObjectId, required: true, index: true },
  ru: { type: Number, required: true, min: 1 },
  face: { type: String, enum: ['front', 'rear', 'both'], required: true },
  state: { type: String, enum: ['reserved', 'blocked'], required: true },
  reason: { type: String, default: null },
  setBy: { type: ObjectId, required: true },
  setByRole: { type: String, required: true },
  setAt: { type: Date, default: () => new Date() },
  releasedAt: { type: Date, default: null },
  releasedBy: { type: ObjectId, default: null },
})

ruStateSchema.__modelName = 'RuState'
tenantScope(ruStateSchema, { scope: 'project' })

ruStateSchema.index({ projectId: 1, rackId: 1, ru: 1, face: 1 }, { unique: true, partialFilterExpression: { releasedAt: null } })

export const RuState = mongoose.models.RuState || mongoose.model('RuState', ruStateSchema)
