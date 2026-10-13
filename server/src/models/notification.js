import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'
import { NOTIFICATION_TYPE_KEYS } from '@rackium/shared/notifications.js'

const { ObjectId } = mongoose.Schema.Types

// DATA-MODEL §5.11 (M5b): one in-app notification for one recipient.
// Organisation-scoped (the bell lists a user's notifications across the
// organisation's projects); `projectId` says which project it is about.
const notificationSchema = new mongoose.Schema({
  recipientId: { type: ObjectId, required: true },
  type: { type: String, enum: NOTIFICATION_TYPE_KEYS, required: true },
  title: { type: String, required: true, maxlength: 300 },
  body: { type: String, default: null, maxlength: 2000 },
  relatedObjectType: { type: String, default: null },
  relatedObjectId: { type: String, default: null },
  buildingId: { type: ObjectId, default: null },
  // The client path of the source object (computed when the event happens).
  link: { type: String, default: null },
  actorName: { type: String, default: null },
  readAt: { type: Date, default: null },
  // 'digest': also goes into the recipient's daily summary email.
  deliveredChannels: { type: [String], default: ['in_app'] },
  digestedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
})

notificationSchema.__modelName = 'Notification'
tenantScope(notificationSchema, { scope: 'organisation' })
notificationSchema.index({ organisationId: 1, recipientId: 1, createdAt: -1 })
notificationSchema.index({ organisationId: 1, recipientId: 1, readAt: 1 })
notificationSchema.index({ organisationId: 1, deliveredChannels: 1, digestedAt: 1 })

export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema)
