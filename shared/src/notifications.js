import { DEFAULT_TIME_ZONE, localDate, addDays, startOfLocalDay } from './timeZone.js'

// Tasks and notifications (brief v2.2 §8, §9; DATA-MODEL §5.11; M5b). Pure:
// the notification types with their labels, the delivery modes a user picks
// per type, the bell panel's day grouping, and the task status rules.

// Every notification type, grouped as the preferences screen lists them.
export const NOTIFICATION_TYPES = [
  { key: 'survey_submitted', label: 'Survey tab submitted for verification', group: 'Survey' },
  { key: 'survey_verified', label: 'Survey tab verified', group: 'Survey' },
  { key: 'survey_rejected', label: 'Survey tab rejected', group: 'Survey' },
  { key: 'hld_submitted', label: 'HLD submitted for approval', group: 'Design' },
  { key: 'hld_approved', label: 'HLD approved', group: 'Design' },
  { key: 'hld_changes_requested', label: 'HLD changes requested', group: 'Design' },
  { key: 'lld_submitted', label: 'LLD submitted for approval', group: 'Design' },
  { key: 'lld_approved', label: 'LLD approved', group: 'Design' },
  { key: 'lld_changes_requested', label: 'LLD changes requested', group: 'Design' },
  { key: 'sp_sent', label: 'Solution Package sent to the client', group: 'Client approval' },
  { key: 'sp_approved', label: 'Solution Package approved by the client', group: 'Client approval' },
  { key: 'sp_changes_requested', label: 'Client requested changes to the Solution Package', group: 'Client approval' },
  { key: 'sp_rejected', label: 'Solution Package rejected by the client', group: 'Client approval' },
  { key: 'handover_accepted', label: 'Handover accepted by the client', group: 'Client approval' },
  { key: 'handover_changes_requested', label: 'Client requested changes to (or rejected) the handover', group: 'Client approval' },
  { key: 'cr_submitted', label: 'Change request submitted', group: 'Change requests' },
  { key: 'cr_sent', label: 'Change request sent to the client', group: 'Change requests' },
  { key: 'cr_approved', label: 'Change request approved by the client', group: 'Change requests' },
  { key: 'cr_changes_requested', label: 'Client requested changes to a change request', group: 'Change requests' },
  { key: 'cr_rejected', label: 'Change request rejected by the client', group: 'Change requests' },
  { key: 'task_assigned', label: 'Task assigned to you', group: 'Tasks' },
  { key: 'task_due_soon', label: 'Task due within 24 hours', group: 'Tasks' },
  { key: 'task_overdue', label: 'Task overdue', group: 'Tasks' },
  { key: 'blocker_raised', label: 'Blocker raised', group: 'Blockers' },
  { key: 'blocker_assigned', label: 'Blocker assigned to you', group: 'Blockers' },
  { key: 'blocker_resolved', label: 'Blocker resolved', group: 'Blockers' },
  { key: 'procurement_status_changed', label: 'Procurement status changed', group: 'Procurement' },
  { key: 'device_installed', label: 'Device installed', group: 'Deployment' },
  { key: 'exception_logged', label: 'Installation exception logged', group: 'Deployment' },
  { key: 'exception_reviewed', label: 'Installation exception accepted or rejected', group: 'Deployment' },
  { key: 'device_accepted', label: 'Device accepted', group: 'Deployment' },
  { key: 'dguv_expiry', label: 'DGUV inspection expiring', group: 'Compliance' },
  { key: 'dguv_not_inspected', label: 'Installed device not DGUV-inspected', group: 'Compliance' },
  { key: 'mention', label: 'You were mentioned in a comment', group: 'Mentions' },
]
export const NOTIFICATION_TYPE_KEYS = NOTIFICATION_TYPES.map((t) => t.key)
export const typeLabel = (key) => NOTIFICATION_TYPES.find((t) => t.key === key)?.label ?? key

// How a user receives one type: in the app, by email, both, or in the app plus
// one summary email a day. Default: in the app.
export const DELIVERY_MODES = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'both', label: 'In-app and email' },
  { key: 'digest', label: 'In-app and daily digest' },
]
export const DELIVERY_MODE_KEYS = DELIVERY_MODES.map((m) => m.key)
export const DEFAULT_DELIVERY_MODE = 'in_app'

export function channelsFor(mode = DEFAULT_DELIVERY_MODE) {
  return { inApp: mode !== 'email', emailNow: mode === 'email' || mode === 'both', digest: mode === 'digest' }
}

// Preferences as stored (type → mode, only the ones a user changed) over the
// defaults: every type with its mode.
export function resolvePreferences(stored = {}) {
  return Object.fromEntries(NOTIFICATION_TYPE_KEYS.map((k) => [k, DELIVERY_MODE_KEYS.includes(stored[k]) ? stored[k] : DEFAULT_DELIVERY_MODE]))
}

// The bell panel groups by calendar day in the organisation's time zone:
// Today, Yesterday, then the date.
export function groupByDay(items, now = new Date(), tz = DEFAULT_TIME_ZONE) {
  const today = localDate(now, tz)
  const yesterday = addDays(today, -1)
  const groups = []
  for (const item of items) {
    const key = localDate(item.createdAt, tz)
    const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : key
    const last = groups[groups.length - 1]
    if (last?.key === key) last.items.push(item)
    else groups.push({ key, label, items: [item] })
  }
  return groups
}

// --- Tasks --------------------------------------------------------------------

export const TASK_STATUSES = ['not_started', 'in_progress', 'complete']
export const TASK_STATUS_LABELS = { not_started: 'Not started', in_progress: 'In progress', complete: 'Complete' }
export const TASK_RELATED_TYPES = ['building', 'room', 'rack', 'device', 'phase', 'blocker', 'change_request']

// Not started → In progress → Complete, moved forward by the assignee (or a
// PM); reopening (back to Not started) by whoever assigned it or a PM.
export function taskTransitionProblem({ from, to, actorId, assignedTo, assignedBy, isPm = false }) {
  if (from === to) return null
  const isAssignee = String(actorId) === String(assignedTo)
  const isAssigner = String(actorId) === String(assignedBy)
  const forward = (from === 'not_started' && (to === 'in_progress' || to === 'complete')) || (from === 'in_progress' && to === 'complete')
  if (forward) return isAssignee || isPm ? null : 'Only the assignee or a PM moves a task forward'
  if (to === 'not_started') return isAssigner || isPm ? null : 'Only whoever assigned the task or a PM reopens it'
  return `A task cannot move from ${TASK_STATUS_LABELS[from]} to ${TASK_STATUS_LABELS[to]}`
}

// A deadline is a calendar date in the organisation's time zone (stored as
// that date at UTC midnight): due on that local day, overdue once the local
// day has ended — local midnight, so a DST day of 23 or 25 hours is right.
export const deadlineEnd = (deadline, tz = DEFAULT_TIME_ZONE) => (deadline ? startOfLocalDay(addDays(deadline, 1), tz) : null)
export function isOverdue(task, now = new Date(), tz = DEFAULT_TIME_ZONE) {
  return Boolean(task.deadline) && task.status !== 'complete' && new Date(now) >= deadlineEnd(task.deadline, tz)
}
export function isDueSoon(task, now = new Date(), tz = DEFAULT_TIME_ZONE, hours = 24) {
  if (!task.deadline || task.status === 'complete' || isOverdue(task, now, tz)) return false
  return deadlineEnd(task.deadline, tz).getTime() - new Date(now).getTime() <= hours * 3600000
}

// Phase names for task and notification labels.
export const PHASE_LABELS = { cmo: 'CMO', survey: 'Physical Site Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'Solution Package', bom: 'BOM', deployment: 'Deployment & Installation', cmdb: 'CMDB', handover: 'Handover' }

// --- Grouping (M5b review) ------------------------------------------------------

// Events one user action produces in a burst (verifying a whole survey,
// assigning a room's tasks) become ONE notification with a count: same
// recipient, type, building and actor, still unread, within the window.
export const GROUP_WINDOW_MS = 15 * 60000
// Immediate mail waits this long, so a burst goes out as one email.
export const EMAIL_GROUP_HOLD_MS = 60000
export const groupKeyOf = ({ type, buildingId = null, actorId = null }) => `${type}|${buildingId ?? '-'}|${actorId ?? 'system'}`

// The title of a group of `count` events (one event keeps its own title).
export function groupedTitle(type, count, buildingCode = null) {
  const b = buildingCode
  const forB = b ? ` for ${b}` : ''
  const inB = b ? ` (${b})` : ''
  switch (type) {
    case 'survey_submitted':
      return `Survey${forB} submitted — ${count} tabs`
    case 'survey_verified':
      return `Survey${forB} verified — ${count} tabs`
    case 'survey_rejected':
      return `Survey${forB}: ${count} tabs rejected`
    case 'task_assigned':
      return `${count} tasks assigned to you${inB}`
    case 'task_due_soon':
      return `${count} tasks due soon${inB}`
    case 'task_overdue':
      return `${count} tasks overdue${inB}`
    case 'blocker_raised':
      return `${count} blockers raised${inB}`
    case 'blocker_assigned':
      return `${count} blockers assigned to you${inB}`
    case 'blocker_resolved':
      return `${count} blockers resolved${inB}`
    case 'procurement_status_changed':
      return `${count} procurement lines changed${inB}`
    case 'mention':
      return `You were mentioned ${count} times${inB}`
    default:
      return `${typeLabel(type)}${inB} — ${count}`
  }
}

// What one stored notification shows: its own title and link, or its group's.
export const displayTitle = (n) => (n.count > 1 ? groupedTitle(n.type, n.count, n.buildingCode ?? null) : n.title)
export const displayLink = (n) => (n.count > 1 ? n.groupLink ?? n.link ?? null : n.link ?? null)
