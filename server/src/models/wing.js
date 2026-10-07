import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.5. Optional; a floor may reference one.
const wingSchema = new mongoose.Schema({
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 10 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  order: { type: Number, required: true, min: 0, default: 0 },
})

wingSchema.__modelName = 'Wing'
tenantScope(wingSchema, { scope: 'project' })

wingSchema.index({ buildingId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Wing = mongoose.models.Wing || mongoose.model('Wing', wingSchema)
