import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §3.9 (M5a subset): one per project. The PM's commercial and
// resource standards: margin %, Bill of Resources minutes per task, and the
// customer power-cord standard (brief §6.7).

const projectSettingsSchema = new mongoose.Schema({
  marginPercent: { type: Number, default: 15, min: 0, max: 500 },
  // taskKey → standard minutes (shared/billOfResources.js RESOURCE_TASKS).
  resourceMinutes: { type: Map, of: Number, default: {} },
  powerCordStandard: {
    type: new mongoose.Schema({ label: String, connectorPair: String }, { _id: false }),
    default: null,
  },
  // Cable schedule column headings (M6b): the client's SC headings, by column
  // key (shared/documents/assemble.js); placeholders until they are supplied.
  cableScheduleHeadings: { type: Map, of: String, default: {} },
  // The client's logo on generated documents (M6b): stored bytes, no public URL.
  clientLogo: { type: new mongoose.Schema({ storageKey: String, mimeType: String, updatedAt: Date }, { _id: false }), default: null },
  // Schedule (M7a-1): risk thresholds, phases allowed to run in parallel with
  // the previous one, and when live phase history tracking started.
  schedule: {
    type: new mongoose.Schema(
      { riskElapsedPct: { type: Number, default: 80 }, riskProgressPct: { type: Number, default: 50 }, parallelPhases: { type: [String], default: [] }, historySince: { type: Date, default: null } },
      { _id: false }
    ),
    default: () => ({}),
  },
  updatedBy: { type: ObjectId, default: null },
  updatedAt: { type: Date, default: () => new Date() },
})

projectSettingsSchema.__modelName = 'ProjectSettings'
tenantScope(projectSettingsSchema, { scope: 'project' })
projectSettingsSchema.index({ organisationId: 1, projectId: 1 }, { unique: true })

export const ProjectSettings = mongoose.models.ProjectSettings || mongoose.model('ProjectSettings', projectSettingsSchema)
