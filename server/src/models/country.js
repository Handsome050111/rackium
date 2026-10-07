import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.3. Hierarchy root under a project.
const countrySchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, maxlength: 10 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
})

countrySchema.__modelName = 'Country'
tenantScope(countrySchema, { scope: 'project' })

countrySchema.index({ projectId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Country = mongoose.models.Country || mongoose.model('Country', countrySchema)
