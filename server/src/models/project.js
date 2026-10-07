import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// M2 adds work types, active phases and client-facing identity. Work types
// are embedded (DATA-MODEL §3.10, simplified for M2: the predefined 28 and
// their phase mapping are "pending client confirmation", so M2 does not
// stand up a separate workTypes collection — a project just records which
// ones it picked, by key).
const workTypeSchema = new mongoose.Schema(
  { key: { type: String, required: true }, name: { type: String, required: true }, isPredefined: { type: Boolean, required: true } },
  { _id: false }
)
const activePhaseSchema = new mongoose.Schema({ phaseKey: { type: String, required: true }, position: { type: Number, required: true } }, { _id: false })

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, trim: true, maxlength: 32 },
  clientName: { type: String, trim: true, maxlength: 120, default: null },
  description: { type: String, trim: true, maxlength: 2000, default: null },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  workTypes: { type: [workTypeSchema], default: [] },
  // Non-empty, ordered subset of shared/src/phaseCalculations.js PHASE_KEYS.
  activePhases: { type: [activePhaseSchema], default: [] },
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
