import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.7. buildingId is denormalised from floorId for cheap scoping.
// `survey` facts arrive with the survey screens (M3); not modelled here.
const roomSchema = new mongoose.Schema({
  floorId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 40 },
  name: { type: String, trim: true, maxlength: 120, default: null },
  isMainRoom: { type: Boolean, default: false },
})

roomSchema.__modelName = 'Room'
tenantScope(roomSchema, { scope: 'project' })

roomSchema.index({ buildingId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Room = mongoose.models.Room || mongoose.model('Room', roomSchema)
