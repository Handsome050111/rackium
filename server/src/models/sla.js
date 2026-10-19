import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.10 (M7a-1): a contractual deadline (v2.2 §21.8) over the
// buildings × phases in its scope; local calendar dates.
const slaSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, default: null },
  phaseKey: { type: String, default: null },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  startDate: { type: String, required: true },
  dueDate: { type: String, required: true },
  atRiskNotifiedAt: { type: Date, default: null },
  breachedNotifiedAt: { type: Date, default: null },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

slaSchema.__modelName = 'Sla'
tenantScope(slaSchema, { scope: 'project' })

export const Sla = mongoose.models.Sla || mongoose.model('Sla', slaSchema)
