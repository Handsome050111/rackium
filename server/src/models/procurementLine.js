import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.10 (M5a): the procurement facts of one BOM line, keyed by
// the line's stable key (`device:<id>` for a serialised item, the
// consumable's key otherwise). Lines are calculated; only these facts are
// stored. Status transitions: shared/procurement.js.

const procurementLineSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  lineKey: { type: String, required: true },
  lineType: { type: String, enum: ['serialised', 'consumable'], required: true },
  deviceId: { type: ObjectId, default: null },
  status: { type: String, enum: ['not_ordered', 'quotation_requested', 'quoted', 'ordered', 'shipped', 'delivered'], default: 'not_ordered' },
  vendor: { type: String, default: null },
  poNumber: { type: String, default: null },
  expectedDelivery: { type: Date, default: null },
  actualDelivery: { type: Date, default: null },
  notes: { type: String, default: null },
  version: { type: Number, default: 0 },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

procurementLineSchema.__modelName = 'ProcurementLine'
tenantScope(procurementLineSchema, { scope: 'project' })
procurementLineSchema.index({ projectId: 1, buildingId: 1, lineKey: 1 }, { unique: true })

export const ProcurementLine = mongoose.models.ProcurementLine || mongoose.model('ProcurementLine', procurementLineSchema)
