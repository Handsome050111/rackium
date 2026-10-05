import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// Append-only record of user actions (DATA-MODEL §8.1). One entry per action,
// with field-level changes embedded so the action is one atomic write. Updates
// and deletes are refused at the query level; only the GDPR purge job (M-later)
// may remove entries, and it would do so through a separate, audited path.
const changeSchema = new mongoose.Schema(
  {
    objectType: { type: String, required: true },
    objectId: { type: String, required: true },
    field: { type: String, required: true },
    // Field values are arbitrary by design; the audit must record whatever the
    // field held. This is the one deliberate use of Mixed in the data model.
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
)

const auditSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  occurredAt: { type: Date, default: () => new Date(), required: true },
  actor: {
    type: { type: String, enum: ['user', 'client_link', 'system', 'rackium_team'], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, default: null },
    role: { type: String, default: null },
    clientName: { type: String, default: null },
    clientRole: { type: String, default: null },
    shareLinkId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  viewAsSessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  action: { type: String, required: true },
  objectType: { type: String, required: true },
  objectId: { type: String, default: null },
  buildingId: { type: mongoose.Schema.Types.ObjectId, default: null },
  phaseKey: { type: String, default: null },
  changeType: {
    type: String,
    enum: ['design_intent', 'operational_change', 'system', 'client_decision', 'import', 'view_as_access', 'platform_access'],
    required: true,
  },
  source: { type: String, enum: ['ui', 'import', 'client_link', 'system', 'offline_sync'], required: true },
  offlineQueuedAt: { type: Date, default: null },
  conflict: { type: Boolean, default: false },
  comment: { type: String, default: null },
  changes: { type: [changeSchema], default: [] },
  batchId: { type: mongoose.Schema.Types.ObjectId, default: null },
})

auditSchema.__modelName = 'AuditEntry'
// Organisation may be null for system events (failed logins for unknown emails).
// Those rows are written under the system scope and never readable through a
// tenant query.
tenantScope(auditSchema, { scope: 'organisation', nullableOrganisation: true })

const refuse = (name) =>
  function refuseMutation() {
    throw new Error(`AuditEntry is append-only: ${name} is not allowed`)
  }
for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditSchema.pre(hook, refuse(hook))
}
auditSchema.pre('save', function refuseResave() {
  if (!this.isNew) throw new Error('AuditEntry is append-only: updates are not allowed')
})

auditSchema.index({ organisationId: 1, projectId: 1, occurredAt: -1 })
auditSchema.index({ objectType: 1, objectId: 1, occurredAt: -1 })

export const AuditEntry = mongoose.models.AuditEntry || mongoose.model('AuditEntry', auditSchema)
