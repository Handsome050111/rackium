import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.10 (M7a-1): a custom milestone (per project or building), or
// — with a standardKey — the due date of a standard milestone moved by the PM.
const milestoneSchema = new mongoose.Schema({
  buildingId: { type: ObjectId, default: null },
  standardKey: { type: String, default: null },
  name: { type: String, trim: true, maxlength: 120, default: null },
  dueDate: { type: String, default: null },
  completedOn: { type: String, default: null },
  createdBy: { type: ObjectId, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

milestoneSchema.__modelName = 'Milestone'
tenantScope(milestoneSchema, { scope: 'project' })
milestoneSchema.index({ projectId: 1, buildingId: 1, standardKey: 1 }, { unique: true, partialFilterExpression: { standardKey: { $type: 'string' } } })

export const Milestone = mongoose.models.Milestone || mongoose.model('Milestone', milestoneSchema)
