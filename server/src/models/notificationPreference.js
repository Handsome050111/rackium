import mongoose from 'mongoose'
import { tenantScope } from '../tenancy/tenantScope.js'

// DATA-MODEL §5.11 as built in M5b: one row per user per organisation —
// notification type → delivery mode (in_app / email / both / digest). Only
// the types a user changed are stored; the rest use the default (in_app).
const notificationPreferenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  modes: { type: Map, of: String, default: {} },
  updatedAt: { type: Date, default: () => new Date() },
})

notificationPreferenceSchema.__modelName = 'NotificationPreference'
tenantScope(notificationPreferenceSchema, { scope: 'organisation' })
notificationPreferenceSchema.index({ organisationId: 1, userId: 1 }, { unique: true })

export const NotificationPreference = mongoose.models.NotificationPreference || mongoose.model('NotificationPreference', notificationPreferenceSchema)
