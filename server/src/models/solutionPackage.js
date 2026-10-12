import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.5 (M5a): the Solution Package of one building. Sections,
// group status and readiness are calculated (shared/solutionPackage.js); this
// stores the Required Inputs, accepted warnings and the workflow state.

const groupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    ownerId: { type: ObjectId, default: null },
    dueDate: { type: Date, default: null },
    addressingEntries: {
      type: [new mongoose.Schema({ id: String, label: String, vlanId: mongoose.Schema.Types.Mixed, cidr: String, gateway: String }, { _id: false })],
      default: [],
    },
    kvPairs: { type: [new mongoose.Schema({ id: String, key: String, value: String }, { _id: false })], default: [] },
  },
  { _id: false }
)
const acceptedWarningSchema = new mongoose.Schema(
  { areaKey: String, text: String, acceptedBy: ObjectId, acceptedByName: String, acceptedByRole: String, acceptedAt: Date },
  { _id: false }
)

const solutionPackageSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  revision: { type: Number, default: 0 },
  // draft → awaiting_client → approved | changes_requested | rejected.
  state: { type: String, enum: ['draft', 'awaiting_client', 'approved', 'changes_requested', 'rejected'], default: 'draft' },
  groups: { type: [groupSchema], default: [] },
  acceptedWarnings: { type: [acceptedWarningSchema], default: [] },
  pendingApprovalId: { type: ObjectId, default: null },
  latestApprovedVersionId: { type: ObjectId, default: null },
  approvedAt: { type: Date, default: null },
  lastEditedAt: { type: Date, default: null },
  lastEditedBy: { type: ObjectId, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

solutionPackageSchema.__modelName = 'SolutionPackage'
tenantScope(solutionPackageSchema, { scope: 'project' })
solutionPackageSchema.index({ projectId: 1, buildingId: 1 }, { unique: true })

export const SolutionPackage = mongoose.models.SolutionPackage || mongoose.model('SolutionPackage', solutionPackageSchema)
