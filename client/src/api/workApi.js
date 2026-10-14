import { API_MODE } from '../lib/apiMode.js'
import { apiRequest, API_BASE } from './httpClient.js'

const real = API_MODE === 'real'
const none = (value) => Promise.resolve(value)
const qs = (params) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}

// Real mode only (M5b): tasks, notifications and the audit log. Mock mode
// resolves empty values and never touches the network.
export const tasksApi = {
  list: (o, p, query = {}) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks${qs(query)}`) : none({ tasks: [], canAssign: false })),
  mine: (o, query = {}) => (real ? apiRequest(`/orgs/${o}/tasks/mine${qs(query)}`) : none({ tasks: [] })),
  assignees: (o, p, buildingId = null) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks/assignees${qs({ buildingId })}`) : none({ assignees: [] })),
  create: (o, p, body) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks`, { method: 'POST', body }) : none(null)),
  fromResources: (o, p, body) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks/from-resources`, { method: 'POST', body }) : none(null)),
  update: (o, p, id, body) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks/${id}`, { method: 'PATCH', body }) : none(null)),
  remove: (o, p, id) => (real ? apiRequest(`/orgs/${o}/projects/${p}/tasks/${id}`, { method: 'DELETE' }) : none(null)),
}

export const notificationsApi = {
  list: (o, { tab = 'all', before = null, limit = 30 } = {}) => (real ? apiRequest(`/orgs/${o}/notifications${qs({ tab, before, limit })}`) : none({ items: [], unread: 0, nextBefore: null })),
  unreadCount: (o) => (real ? apiRequest(`/orgs/${o}/notifications/unread-count`) : none({ unread: 0 })),
  markRead: (o, id) => (real ? apiRequest(`/orgs/${o}/notifications/${id}/read`, { method: 'POST' }) : none(null)),
  markAllRead: (o) => (real ? apiRequest(`/orgs/${o}/notifications/read-all`, { method: 'POST' }) : none({ marked: 0 })),
  preferences: (o) => (real ? apiRequest(`/orgs/${o}/notification-preferences`) : none({ modes: {}, types: [], deliveryModes: [] })),
  updatePreferences: (o, modes) => (real ? apiRequest(`/orgs/${o}/notification-preferences`, { method: 'PUT', body: { modes } }) : none(null)),
}

export const auditApi = {
  list: (o, filters = {}) => (real ? apiRequest(`/orgs/${o}/audit${qs(filters)}`) : none({ entries: [], nextBefore: null })),
  get: (o, id, projectId = null) => (real ? apiRequest(`/orgs/${o}/audit/${id}${qs({ projectId })}`) : none(null)),
  // The CSV is fetched (cookies travel with it) and saved through a blob link.
  exportUrl: (o, filters = {}) => `${API_BASE}/orgs/${o}/audit/export.csv${qs(filters)}`,
}

export async function downloadAuditCsv(o, filters = {}) {
  const res = await fetch(auditApi.exportUrl(o, filters), { credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error?.message ?? `Export failed (${res.status})`), { status: res.status })
  }
  const blob = await res.blob()
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'audit-log.csv'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return name
}

// --- Pure helpers (unit-tested) -----------------------------------------------

// Audit filters from the screen's form: blank fields dropped, the action
// type as a prefix ("task" → task.*).
export function auditFilters(form) {
  const out = {}
  for (const k of ['projectId', 'from', 'to', 'userId', 'action', 'module', 'objectType', 'buildingId', 'changeType']) {
    const v = typeof form[k] === 'string' ? form[k].trim() : form[k]
    if (v) out[k] = v
  }
  return out
}

// One field change as text: "status: not_started → complete".
export function changeText(c) {
  const show = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return `${c.field}: ${show(c.before)} → ${show(c.after)}`
}

// Tasks sorted for a list: overdue first, then by deadline, undated last; complete at the end.
export function sortTasks(tasks) {
  const rank = (t) => (t.status === 'complete' ? 2 : t.overdue ? 0 : 1)
  return [...tasks].sort((a, b) => rank(a) - rank(b) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.title.localeCompare(b.title))
}
