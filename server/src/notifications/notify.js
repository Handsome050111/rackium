import mongoose from 'mongoose'
import { scopeCoversBuilding } from '@rackium/shared/scope.js'
import { channelsFor, resolvePreferences, typeLabel, groupKeyOf, groupedTitle, GROUP_WINDOW_MS, EMAIL_GROUP_HOLD_MS } from '@rackium/shared/notifications.js'
import { Membership } from '../models/membership.js'
import { User } from '../models/user.js'
import { Notification } from '../models/notification.js'
import { NotificationPreference } from '../models/notificationPreference.js'
import { EmailOutbox } from '../models/emailOutbox.js'
import { buildingWithScopeIds } from '../access/scope.js'
import { currentScope } from '../tenancy/scopeContext.js'

// Notifications (brief v2.2 §9; DATA-MODEL §5.11; M5b). One call per event:
// the recipients are worked out here — by project role and/or named users,
// only active project members whose scope covers the building, never the
// person who acted — and each recipient's preference decides the channels
// (in-app row, an email in the outbox, or the daily digest). Runs in the
// caller's tenant scope and, given a session, in the caller's transaction.

const settings = { appUrl: 'http://localhost:5173', onOutbox: null }
// createApp sets the public app URL (links in emails); the scheduler sets
// onOutbox so queued mail goes out promptly.
export function configureNotifications({ appUrl, onOutbox } = {}) {
  if (appUrl) settings.appUrl = appUrl.replace(/\/$/, '')
  if (onOutbox !== undefined) settings.onOutbox = onOutbox
}
export const appUrl = () => settings.appUrl

// Client paths of the objects notifications point at.
export const paths = {
  building: (o, p, b, page = '') => `/orgs/${o}/projects/${p}/buildings/${b}${page ? `/${page}` : ''}`,
  tasks: (o, p, taskId = null) => `/orgs/${o}/projects/${p}/tasks${taskId ? `?task=${taskId}` : ''}`,
}

// Active project members (by role and/or user id) whose scope covers the building.
export async function projectMembers({ projectId, roles = null, userIds = null, building = null, session = null }) {
  if (userIds && !userIds.length) return []
  const filter = { level: 'project', projectId: new mongoose.Types.ObjectId(String(projectId)), active: true }
  if (roles) filter.role = { $in: roles }
  if (userIds) filter.userId = { $in: userIds.filter(Boolean).map((u) => new mongoose.Types.ObjectId(String(u))) }
  const rows = await Membership.find(filter).session(session).lean()
  return [...new Set(rows.filter((m) => !building || scopeCoversBuilding(m.scopes ?? [], building)).map((m) => String(m.userId)))]
}

export async function actorNameOf(userId, session = null) {
  if (!userId) return null
  const u = await User.findById(userId, { name: 1, email: 1 }).session(session).lean()
  return u?.name || u?.email || null
}

// The mail for one event, or for a group of `count`.
function mailOf({ type, title, body, actorName, link, groupLink, buildingCode, count }) {
  const grouped = count > 1
  const subject = `Rackium: ${grouped ? groupedTitle(type, count, buildingCode) : title}`
  const open = grouped ? groupLink ?? link : link
  const text = [grouped ? groupedTitle(type, count, buildingCode) : title, grouped ? null : body, actorName ? `By ${actorName}.` : null, open ? `Open: ${settings.appUrl}${open}` : null, '', `You receive "${typeLabel(type)}" by email — change it in your notification preferences.`].filter((x) => x !== null).join('\n')
  return { subject, text }
}

// `to`: { roles: [...], userIds: [...] } — the union, filtered as above.
// `groupLink`: where a group of these events points (default: `link`).
export async function notify({ type, projectId = null, buildingId = null, title, body = null, relatedObjectType = null, relatedObjectId = null, link = null, groupLink = null, actorId = null, to = {}, session = null }) {
  const { organisationId } = currentScope() ?? {}
  if (!organisationId) throw new Error('notify needs a tenant scope')
  const pid = projectId ?? currentScope().projectId
  const building = buildingId ? await buildingWithScopeIds(buildingId, session) : null
  const byRole = to.roles?.length ? await projectMembers({ projectId: pid, roles: to.roles, building, session }) : []
  const named = to.userIds?.length ? await projectMembers({ projectId: pid, userIds: to.userIds, building, session }) : []
  const recipients = [...new Set([...byRole, ...named])].filter((u) => !actorId || u !== String(actorId))
  if (!recipients.length) return []

  const prefs = new Map((await NotificationPreference.find({ userId: { $in: recipients.map((u) => new mongoose.Types.ObjectId(u)) } }).session(session).lean()).map((p) => [String(p.userId), p.modes instanceof Map ? Object.fromEntries(p.modes) : p.modes ?? {}]))
  const users = new Map((await User.find({ _id: { $in: recipients } }, { email: 1, name: 1 }).session(session).lean()).map((u) => [String(u._id), u]))
  const actorName = await actorNameOf(actorId, session)
  const now = new Date()
  const groupKey = groupKeyOf({ type, buildingId: buildingId ? String(buildingId) : null, actorId: actorId ? String(actorId) : null })
  const buildingCode = building?.code ?? null
  const gLink = groupLink ?? link
  const created = []
  let queued = 0
  for (const userId of recipients) {
    const channels = channelsFor(resolvePreferences(prefs.get(userId))[type])
    const delivered = channels.digest ? ['in_app', 'digest'] : ['in_app']
    if (channels.inApp) {
      // Part of a burst: the open group (unread, not yet in a digest, recent) counts it.
      const grouped = await Notification.findOneAndUpdate(
        { recipientId: new mongoose.Types.ObjectId(userId), groupKey, readAt: null, digestedAt: null, deliveredChannels: { $size: delivered.length, $all: delivered }, createdAt: { $gte: new Date(now.getTime() - GROUP_WINDOW_MS) } },
        { $inc: { count: 1 }, $set: { createdAt: now } },
        { session, returnDocument: 'after', sort: { createdAt: -1 } }
      )
      if (grouped) created.push(grouped)
      else {
        const [n] = await Notification.create([{ recipientId: userId, projectId: pid, type, title, body, relatedObjectType, relatedObjectId: relatedObjectId ? String(relatedObjectId) : null, buildingId: buildingId ?? null, buildingCode, link, groupLink: gLink, groupKey, actorName, deliveredChannels: delivered }], { session })
        created.push(n)
      }
    }
    const email = users.get(userId)?.email
    if (channels.emailNow && email) {
      // A mail still waiting for this group takes the event; otherwise a new one waits a minute.
      const waiting = await EmailOutbox.findOneAndUpdate({ userId: new mongoose.Types.ObjectId(userId), groupKey, kind: 'notification', status: 'pending', attempts: 0 }, { $inc: { count: 1 } }, { session, returnDocument: 'after' })
      if (waiting) {
        await EmailOutbox.updateOne({ _id: waiting._id }, { $set: mailOf({ type, title, body, actorName, link, groupLink: gLink, buildingCode, count: waiting.count }) }, { session })
      } else {
        await EmailOutbox.create([{ organisationId, userId, to: email, ...mailOf({ type, title, body, actorName, link, groupLink: gLink, buildingCode, count: 1 }), kind: 'notification', groupKey, notBefore: new Date(now.getTime() + EMAIL_GROUP_HOLD_MS), dedupeKey: `notification:${new mongoose.Types.ObjectId()}` }], { session })
        queued += 1
      }
    }
  }
  if (queued && settings.onOutbox) setTimeout(() => settings.onOutbox(), EMAIL_GROUP_HOLD_MS + 1000).unref?.()
  return created
}

// A safe wrapper for events raised after the action itself is done: a
// notification problem never fails the user's action (it is logged instead).
export async function notifyQuietly(args, logger = console) {
  try {
    return await notify(args)
  } catch (err) {
    logger.error?.({ err: err.message, type: args.type }, 'notification failed')
    return []
  }
}

// --- Hooks for modules that do not exist yet --------------------------------

// DGUV (brief §6.9): the reminder job (deployment/jobs.js) calls this when a
// recorded inspection is expiring or overdue; PMs (in scope) are told.
export function notifyDguvExpiry({ projectId, buildingId, deviceLabel, expiresOn, status = null, statusLabel = null, link = null, session = null }) {
  const day = new Date(expiresOn).toISOString().slice(0, 10)
  const title = status === 'overdue' ? `DGUV inspection of ${deviceLabel} overdue since ${day}` : `DGUV inspection of ${deviceLabel} expires on ${day}${statusLabel ? ` (${statusLabel})` : ''}`
  return notify({ type: 'dguv_expiry', projectId, buildingId, title, relatedObjectType: 'device', link, groupLink: link, to: { roles: ['pm'] }, session })
}

// A mains-powered device installed but never DGUV-inspected (M6a review):
// PMs (in scope) are told once per device.
export function notifyDguvNotInspected({ projectId, buildingId, deviceLabel, buildingCode = null, link = null, session = null }) {
  return notify({ type: 'dguv_not_inspected', projectId, buildingId, title: `${deviceLabel} is installed but not DGUV-inspected${buildingCode ? ` (${buildingCode})` : ''}`, relatedObjectType: 'device', link, groupLink: link, to: { roles: ['pm'] }, session })
}

// Comment mentions: comments arrive with a later module; it calls this with
// the users a comment mentions.
export function notifyMention({ projectId, buildingId = null, mentionedUserIds, actorId, excerpt, relatedObjectType = null, relatedObjectId = null, link = null, session = null }) {
  return notify({ type: 'mention', projectId, buildingId, title: 'You were mentioned in a comment', body: excerpt, relatedObjectType, relatedObjectId, link, actorId, to: { userIds: mentionedUserIds }, session })
}
