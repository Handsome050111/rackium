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
  { key: 'dguv_expiry', label: 'DGUV inspection expiring', group: 'Compliance' },
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

// The bell panel groups by calendar day (UTC): Today, Yesterday, then the date.
const dayKey = (d) => new Date(d).toISOString().slice(0, 10)
export function groupByDay(items, now = new Date()) {
  const today = dayKey(now)
  const yesterday = dayKey(new Date(new Date(now).getTime() - 86400000))
  const groups = []
  for (const item of items) {
    const key = dayKey(item.createdAt)
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

// A deadline is a date (UTC midnight): due on that day, overdue after it ends.
const DAY_MS = 86400000
export const deadlineEnd = (deadline) => (deadline ? new Date(new Date(deadline).getTime() + DAY_MS) : null)
export function isOverdue(task, now = new Date()) {
  return Boolean(task.deadline) && task.status !== 'complete' && new Date(now) >= deadlineEnd(task.deadline)
}
export function isDueSoon(task, now = new Date(), hours = 24) {
  if (!task.deadline || task.status === 'complete' || isOverdue(task, now)) return false
  return deadlineEnd(task.deadline).getTime() - new Date(now).getTime() <= hours * 3600000
}

// Phase names for task and notification labels.
export const PHASE_LABELS = { cmo: 'CMO', survey: 'Physical Site Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'Solution Package', bom: 'BOM', deployment: 'Deployment & Installation', cmdb: 'CMDB', handover: 'Handover' }
