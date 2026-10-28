import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { TASK_STATUSES, TASK_RELATED_TYPES } from '@rackium/shared/notifications.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.11 (M5b): a piece of work assigned to one project member,
// optionally about one object (building, room, rack, device, phase, blocker
// or change request); `buildingId` is resolved from it for scope checks.
const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  relatedObjectType: { type: String, enum: [...TASK_RELATED_TYPES, null], default: null },
  relatedObjectId: { type: String, default: null },
  relatedLabel: { type: String, default: null },
  buildingId: { type: ObjectId, default: null, index: true },
  phaseKey: { type: String, default: null },
  assignedTo: { type: ObjectId, required: true, index: true },
  assignedBy: { type: ObjectId, required: true },
  // A date: due on that day (UTC midnight), overdue once it has ended.
  deadline: { type: Date, default: null },
  notes: { type: String, default: null, maxlength: 2000 },
  status: { type: String, enum: TASK_STATUSES, default: 'not_started' },
  // Bill of Resources origin (brief §5.5): the task kind and the room it was made for.
  resourceTask: { type: String, default: null },
  // System-created tasks (M7b-2, DATA-MODEL §5.19): 'reprint_labels' — after
  // a change request renamed installed devices, the labels on site are
  // reprinted. Which devices (old → new) and which cables.
  kind: { type: String, enum: ['reprint_labels', null], default: null },
  renames: { type: [new mongoose.Schema({ deviceId: String, from: String, to: String }, { _id: false })], default: undefined },
  connectionIds: { type: [String], default: undefined },
  completedAt: { type: Date, default: null },
  // Reminders are sent once (the scheduled job claims these atomically).
  dueSoonNotifiedAt: { type: Date, default: null },
  overdueNotifiedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

taskSchema.__modelName = 'Task'
tenantScope(taskSchema, { scope: 'project' })
taskSchema.index({ projectId: 1, status: 1, deadline: 1 })
taskSchema.index({ projectId: 1, relatedObjectType: 1, relatedObjectId: 1 })
// One reprint task per change request, however often the approval runs.
taskSchema.index({ projectId: 1, kind: 1, relatedObjectId: 1 }, { unique: true, partialFilterExpression: { kind: { $type: 'string' } } })

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema)
