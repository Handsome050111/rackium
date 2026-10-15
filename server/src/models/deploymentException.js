import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §4.11 (M6a): an installation that differs from the frozen LLD,
// logged by the Field Engineer with a reason (and photos) instead of being
// corrected, then accepted or rejected by a Reviewer or PM. "corrected": the
// installed value was changed back to the design; "superseded": the
// installed value changed again, so this record no longer describes it.
const deploymentExceptionSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true, index: true },
  deviceId: { type: ObjectId, required: true },
  connectionId: { type: ObjectId, default: null },
  field: { type: String, required: true },
  label: { type: String, required: true },
  designedValue: { type: String, default: null },
  installedValue: { type: String, default: null },
  reason: { type: String, required: true },
  photoFileIds: { type: [ObjectId], default: [] },
  status: { type: String, enum: ['open', 'accepted', 'rejected', 'corrected', 'superseded'], default: 'open' },
  loggedBy: { type: ObjectId, required: true },
  loggedByName: { type: String, default: null },
  loggedAt: { type: Date, default: () => new Date() },
  reviewedBy: { type: ObjectId, default: null },
  reviewedByName: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, default: null },
  closedAt: { type: Date, default: null },
})

deploymentExceptionSchema.__modelName = 'DeploymentException'
tenantScope(deploymentExceptionSchema, { scope: 'project' })
deploymentExceptionSchema.index({ projectId: 1, deviceId: 1, status: 1 })

export const DeploymentException = mongoose.models.DeploymentException || mongoose.model('DeploymentException', deploymentExceptionSchema)
