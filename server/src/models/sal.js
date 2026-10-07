import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.3. No `name` field, per the brief.
const salSchema = new mongoose.Schema({
  countryId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 10 },
})

salSchema.__modelName = 'Sal'
tenantScope(salSchema, { scope: 'project' })

salSchema.index({ countryId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Sal = mongoose.models.Sal || mongoose.model('Sal', salSchema)
