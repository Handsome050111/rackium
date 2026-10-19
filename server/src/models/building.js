import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §3.4. siteSize: only 'S' is defined until other sizes are specified.
const buildingSchema = new mongoose.Schema({
  campusId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  code: { type: String, required: true, trim: true, maxlength: 10 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  siteSize: { type: String, enum: ['S'], default: 'S' },
  // M7a-1 (v2.2 §21.5): the building's primary Architect and Field Engineer.
  primaryArchitectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  primaryFieldEngineerId: { type: mongoose.Schema.Types.ObjectId, default: null },
})

buildingSchema.__modelName = 'Building'
tenantScope(buildingSchema, { scope: 'project' })

// Unique per project, not per campus (brief §4.1): building codes are unique
// across the whole project, e.g. "B001".
buildingSchema.index({ projectId: 1, code: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } })

export const Building = mongoose.models.Building || mongoose.model('Building', buildingSchema)
