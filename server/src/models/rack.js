import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.8. heightU is checked against the organisation's
// standardHeightsU/customHeightsU in the service, not here (it depends on
// org settings, not a fixed list). buildingId is denormalised for scoping.
const rackSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 20 },
  heightU: { type: Number, required: true, min: 1 },
})

rackSchema.__modelName = 'Rack'
tenantScope(rackSchema, { scope: 'project' })

rackSchema.index({ roomId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Rack = mongoose.models.Rack || mongoose.model('Rack', rackSchema)
