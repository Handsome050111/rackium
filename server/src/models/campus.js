import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.3.
const campusSchema = new mongoose.Schema({
  salId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 10 },
})

campusSchema.__modelName = 'Campus'
tenantScope(campusSchema, { scope: 'project' })

campusSchema.index({ salId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Campus = mongoose.models.Campus || mongoose.model('Campus', campusSchema)
