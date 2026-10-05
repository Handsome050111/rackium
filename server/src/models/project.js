import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// Minimal project record for M1: enough to hang project memberships on.
// Hierarchy, phases and the rest of the project model arrive in M2.
const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, trim: true, maxlength: 32 },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

projectSchema.__modelName = 'Project'
tenantScope(projectSchema, { scope: 'organisation' })

// Project codes are unique within an organisation, case-insensitively.
projectSchema.index(
  { organisationId: 1, code: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { code: { $exists: true } } }
)

export const Project = mongoose.models.Project || mongoose.model('Project', projectSchema)
