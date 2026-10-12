import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.9: one record per approval gate. Internal design gates: the
// Architect submits, a PM or Reviewer decides, and never the submitter
// (brief §4.3). Approving a design gate freezes its version (§10).
const decisionSchema = new mongoose.Schema(
  {
    value: { type: String, enum: ['approved', 'changes_requested', 'rejected'], required: true },
    decidedAt: { type: Date, required: true },
    // A user for internal gates; null for a client decision (see client).
    decidedBy: { type: ObjectId, default: null },
    decidedByRole: { type: String, default: null },
    comments: { type: String, default: null },
    // Client gates (M5a): the acceptance checkbox and the optional drawn signature.
    termsAccepted: { type: Boolean, default: null },
    signatureFileId: { type: ObjectId, default: null },
  },
  { _id: false }
)

const approvalSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  phaseKey: { type: String, enum: ['hld', 'lld', 'solution-package', 'bom', 'deployment', 'handover'], required: true },
  gate: { type: String, enum: ['hld_internal', 'lld_internal', 'sp_internal', 'sp_client', 'bom_pm', 'deployment_acceptance', 'handover_client', 'change_request'], required: true },
  designVersionId: { type: ObjectId, default: null },
  submittedBy: { type: ObjectId, required: true },
  submittedAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'approved', 'changes_requested', 'rejected', 'expired'], default: 'pending' },
  reviewerId: { type: ObjectId, default: null },
  decision: { type: decisionSchema, default: null },
  // Client gates: who decided through which share link (a client is not a user).
  client: {
    type: new mongoose.Schema({ name: String, role: { type: String, default: null }, shareLinkId: ObjectId }, { _id: false }),
    default: null,
  },
  // change_request gate: the change request it decides (DATA-MODEL §5.9 changeRequestOf).
  changeRequestId: { type: ObjectId, default: null },
})

approvalSchema.__modelName = 'Approval'
tenantScope(approvalSchema, { scope: 'project' })
approvalSchema.index({ projectId: 1, buildingId: 1, phaseKey: 1, submittedAt: -1 })
// At most one pending approval per building and gate.
approvalSchema.index({ projectId: 1, buildingId: 1, gate: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } })

export const Approval = mongoose.models.Approval || mongoose.model('Approval', approvalSchema)
