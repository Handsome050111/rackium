import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.6. token is the displayed form (e.g. "1.OG"); its hostname
// form strips dots and spaces (shared/src/hierarchyImport.js#floorHostnameToken).
const floorSchema = new mongoose.Schema({
  buildingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  wingId: { type: mongoose.Schema.Types.ObjectId, default: null },
  token: { type: String, required: true, trim: true, maxlength: 20 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  order: { type: Number, required: true, min: 0 },
})

floorSchema.__modelName = 'Floor'
tenantScope(floorSchema, { scope: 'project' })

floorSchema.index({ buildingId: 1, token: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })
floorSchema.index({ buildingId: 1, order: 1 }, { unique: true })

export const Floor = mongoose.models.Floor || mongoose.model('Floor', floorSchema)
