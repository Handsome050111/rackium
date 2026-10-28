import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.12 (M6b): one per building. Stored states: pending →
// compiling → compiled → under_review → delivered → accepted, side state
// changes_requested. "Ready" is calculated (pending with the checklist green).
const handoverWorkflowSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, required: true },
  state: { type: String, enum: ['pending', 'compiling', 'compiled', 'under_review', 'delivered', 'changes_requested', 'accepted'], default: 'pending' },
  // Each compile is a round; its documents carry the round number.
  round: { type: Number, default: 0 },
  // The round whose package is being built (claimed once, so it is built once).
  packagingRound: { type: Number, default: null },
  compiledAt: { type: Date, default: null },
  compiledBy: { type: ObjectId, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: ObjectId, default: null },
  deliveredAt: { type: Date, default: null },
  deliveredBy: { type: ObjectId, default: null },
  approvalId: { type: ObjectId, default: null },
  acceptedAt: { type: Date, default: null },
  baselineId: { type: ObjectId, default: null },
  // The handover package ZIP of the accepted round (permanently downloadable).
  packageDocumentId: { type: ObjectId, default: null },
  // CMO gear marked Replace or Remove the PM keeps on site at handover, with
  // the reason (M7b-4b, DATA-MODEL §5.22) — in the handover package.
  oldGearOverride: {
    type: new mongoose.Schema({ reason: String, by: ObjectId, byName: String, at: Date, devices: { type: [new mongoose.Schema({ id: String, name: String }, { _id: false })], default: [] } }, { _id: false }),
    default: null,
  },
  lastDecision: { type: new mongoose.Schema({ value: String, by: String, role: String, comments: String, at: Date }, { _id: false }), default: null },
  revision: { type: Number, default: 0 },
  updatedAt: { type: Date, default: () => new Date() },
})

handoverWorkflowSchema.__modelName = 'HandoverWorkflow'
tenantScope(handoverWorkflowSchema, { scope: 'project' })
handoverWorkflowSchema.index({ projectId: 1, buildingId: 1 }, { unique: true })

export const HandoverWorkflow = mongoose.models.HandoverWorkflow || mongoose.model('HandoverWorkflow', handoverWorkflowSchema)
