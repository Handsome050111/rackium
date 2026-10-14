import mongoose from 'mongoose'
import { resolvePreferences, NOTIFICATION_TYPES, DELIVERY_MODES, displayTitle, displayLink } from '@rackium/shared/notifications.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { Notification } from '../models/notification.js'
import { NotificationPreference } from '../models/notificationPreference.js'
import { notFound } from '../http/errors.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))

export const toNotification = (n) => ({
  id: String(n._id),
  type: n.type,
  projectId: n.projectId ? String(n.projectId) : null,
  buildingId: n.buildingId ? String(n.buildingId) : null,
  // A group shows its own title, link and count (M5b review).
  title: displayTitle(n),
  body: (n.count ?? 1) > 1 ? null : n.body ?? null,
  count: n.count ?? 1,
  relatedObjectType: n.relatedObjectType ?? null,
  relatedObjectId: n.relatedObjectId ?? null,
  link: displayLink({ ...n, count: n.count ?? 1 }),
  actorName: n.actorName ?? null,
  read: Boolean(n.readAt),
  readAt: n.readAt ?? null,
  createdAt: n.createdAt,
})

// The bell (M5b): a user's own notifications in the organisation — never
// anyone else's (every query is on recipientId = the caller).
export function createNotificationService() {
  return {
    async list({ userId, organisationId, tab = 'all', before = null, limit = 30 }) {
      const filter = { recipientId: oid(userId) }
      if (tab === 'unread') filter.readAt = null
      if (tab === 'mentions') filter.type = 'mention'
      if (before) filter.createdAt = { $lt: new Date(before) }
      const rows = await Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean()
      const items = rows.slice(0, limit).map(toNotification)
      const unread = await Notification.countDocuments({ recipientId: oid(userId), readAt: null })
      // The organisation's time zone: the bell groups by its local day.
      const { timeZone } = await orgTimeSettings(organisationId)
      return { items, unread, nextBefore: rows.length > limit ? items[items.length - 1].createdAt : null, timeZone }
    },

    async unreadCount({ userId }) {
      return { unread: await Notification.countDocuments({ recipientId: oid(userId), readAt: null }) }
    },

    async markRead({ userId, id }) {
      if (!mongoose.isValidObjectId(id)) throw notFound('Notification not found')
      // Only the first read is stamped.
      await Notification.updateOne({ _id: id, recipientId: oid(userId), readAt: null }, { $set: { readAt: new Date() } })
      const n = await Notification.findOne({ _id: id, recipientId: oid(userId) }).lean()
      if (!n) throw notFound('Notification not found')
      return { notification: toNotification(n) }
    },

    async markAllRead({ userId }) {
      const res = await Notification.updateMany({ recipientId: oid(userId), readAt: null }, { $set: { readAt: new Date() } })
      return { marked: res.modifiedCount }
    },

    async preferences({ userId }) {
      const row = await NotificationPreference.findOne({ userId: oid(userId) }).lean()
      const stored = row?.modes instanceof Map ? Object.fromEntries(row.modes) : row?.modes ?? {}
      return { modes: resolvePreferences(stored), types: NOTIFICATION_TYPES, deliveryModes: DELIVERY_MODES }
    },

    async updatePreferences({ userId, modes }) {
      const row = (await NotificationPreference.findOne({ userId: oid(userId) })) ?? new NotificationPreference({ userId })
      const current = row.modes instanceof Map ? Object.fromEntries(row.modes) : row.modes ?? {}
      row.modes = { ...current, ...modes }
      row.updatedAt = new Date()
      await row.save()
      return this.preferences({ userId })
    },
  }
}
