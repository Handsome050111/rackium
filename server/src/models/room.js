import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.7. buildingId is denormalised from floorId for cheap scoping.
// `survey` holds the facts captured in Site Structure (M3b). Photo counts
// are computed from files, never stored.
const roomSchema = new mongoose.Schema({
  floorId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 40 },
  name: { type: String, trim: true, maxlength: 120, default: null },
  isMainRoom: { type: Boolean, default: false },
  survey: {
    access: { type: String, enum: ['verified', 'not_verified'], default: 'not_verified' },
    power: { type: String, enum: ['available', 'not_available', 'unknown'], default: 'unknown' },
    environment: { type: String, enum: ['verified', 'to_verify', 'issue', 'unknown'], default: 'unknown' },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
})

roomSchema.__modelName = 'Room'
tenantScope(roomSchema, { scope: 'project' })

roomSchema.index({ buildingId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Room = mongoose.models.Room || mongoose.model('Room', roomSchema)
