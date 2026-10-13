import { isDueSoon, isOverdue } from '@rackium/shared/notifications.js'
import { EmailOutbox } from '../models/emailOutbox.js'
import { Notification } from '../models/notification.js'
import { Organisation } from '../models/organisation.js'
import { Project } from '../models/project.js'
import { Task } from '../models/task.js'
import { User } from '../models/user.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { notify, paths, appUrl } from './notify.js'

// The jobs behind notifications (M5b), run by the scheduler (jobs/scheduler.js)
// and called directly by the tests. Each is idempotent: running it twice, or
// on two servers at once, never sends or notifies anything twice.

const MAX_ATTEMPTS = 5

// Sends queued mail. Each row is claimed atomically (pending → sending), so a
// second runner skips it; a failure goes back to pending until MAX_ATTEMPTS.
export async function deliverOutbox({ mailer, now = new Date(), limit = 100 }) {
  const out = { sent: 0, failed: 0 }
  for (let i = 0; i < limit; i++) {
    const row = await EmailOutbox.findOneAndUpdate(
      { status: 'pending', $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { status: 'sending', lockedUntil: new Date(now.getTime() + 5 * 60000) }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, returnDocument: 'after' }
    )
    if (!row) break
    try {
      await mailer.send({ to: row.to, subject: row.subject, text: row.text })
      await EmailOutbox.updateOne({ _id: row._id }, { $set: { status: 'sent', sentAt: new Date(), lockedUntil: null, lastError: null } })
      out.sent += 1
    } catch (err) {
      const failed = row.attempts >= MAX_ATTEMPTS
      await EmailOutbox.updateOne({ _id: row._id }, { $set: { status: failed ? 'failed' : 'pending', lockedUntil: failed ? null : new Date(now.getTime() + 60000 * row.attempts), lastError: err.message } })
      out.failed += 1
    }
  }
  return out
}

// Every project of every organisation, each in its own tenant scope.
async function forEachProject(fn) {
  const orgs = await Organisation.find({ deletedAt: null }, { _id: 1 }).lean()
  for (const org of orgs) {
    const projects = await runWithScope({ organisationId: org._id }, () => Project.find({}, { _id: 1 }).lean())
    for (const project of projects) await runWithScope({ organisationId: org._id, projectId: project._id }, () => fn({ organisationId: String(org._id), projectId: String(project._id) }))
  }
}

// Task reminders: due within 24 hours (the assignee), overdue (the assignee
// and whoever assigned it). Each is claimed on the task first, so it is sent once.
export async function taskReminders({ now = new Date() } = {}) {
  const out = { dueSoon: 0, overdue: 0 }
  await forEachProject(async ({ organisationId, projectId }) => {
    const open = await Task.find({ status: { $ne: 'complete' }, deadline: { $ne: null }, $or: [{ dueSoonNotifiedAt: null }, { overdueNotifiedAt: null }] }).lean()
    for (const task of open) {
      const link = paths.tasks(organisationId, projectId, task._id)
      const due = String(task.deadline.toISOString().slice(0, 10))
      if (isOverdue(task, now) && !task.overdueNotifiedAt) {
        const claimed = await Task.findOneAndUpdate({ _id: task._id, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: now } })
        if (!claimed) continue
        await notify({ type: 'task_overdue', projectId, buildingId: task.buildingId, title: `Overdue: ${task.title}`, body: `It was due on ${due}.`, relatedObjectType: 'task', relatedObjectId: task._id, link, to: { userIds: [task.assignedTo, task.assignedBy] } })
        out.overdue += 1
      } else if (isDueSoon(task, now) && !task.dueSoonNotifiedAt) {
        const claimed = await Task.findOneAndUpdate({ _id: task._id, dueSoonNotifiedAt: null }, { $set: { dueSoonNotifiedAt: now } })
        if (!claimed) continue
        await notify({ type: 'task_due_soon', projectId, buildingId: task.buildingId, title: `Due soon: ${task.title}`, body: `Due on ${due}.`, relatedObjectType: 'task', relatedObjectId: task._id, link, to: { userIds: [task.assignedTo] } })
        out.dueSoon += 1
      }
    }
  })
  return out
}

// The daily digest: per organisation and recipient, one email listing the
// digest notifications not yet summarised. The outbox row's key is unique per
// user and day, so a second run the same day queues nothing; only then are
// the notifications marked as summarised.
export async function dailyDigest({ now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10)
  const out = { emails: 0, notifications: 0 }
  const orgs = await Organisation.find({ deletedAt: null }, { _id: 1, name: 1 }).lean()
  for (const org of orgs) {
    await runWithScope({ organisationId: org._id }, async () => {
      const pending = await Notification.find({ deliveredChannels: 'digest', digestedAt: null, createdAt: { $lte: now } }).sort({ createdAt: 1 }).lean()
      const byUser = new Map()
      for (const n of pending) byUser.set(String(n.recipientId), [...(byUser.get(String(n.recipientId)) ?? []), n])
      for (const [userId, items] of byUser) {
        const user = await User.findById(userId, { email: 1 }).lean()
        if (!user?.email) continue
        const lines = items.map((n) => `- ${n.title}${n.link ? ` — ${appUrl()}${n.link}` : ''}`)
        const text = [`Your Rackium digest for ${day} (${org.name}): ${items.length} notification(s).`, '', ...lines, '', 'Types you receive as a daily digest are set in your notification preferences.'].join('\n')
        try {
          await EmailOutbox.create({ organisationId: org._id, userId, to: user.email, subject: `Rackium daily digest — ${items.length} notification(s)`, text, kind: 'digest', dedupeKey: `digest:${org._id}:${userId}:${day}` })
        } catch (err) {
          if (err.code === 11000) continue // already sent today: these wait for tomorrow's
          throw err
        }
        await Notification.updateMany({ _id: { $in: items.map((n) => n._id) }, digestedAt: null }, { $set: { digestedAt: now } })
        out.emails += 1
        out.notifications += items.length
      }
    })
  }
  return out
}

