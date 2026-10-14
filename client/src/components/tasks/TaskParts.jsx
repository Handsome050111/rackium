import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, Trash2 } from 'lucide-react'
import { TASK_STATUSES, TASK_STATUS_LABELS, PHASE_LABELS } from '@rackium/shared/notifications.js'
import { tasksApi } from '../../api/workApi.js'

const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'

// New task (M5b): title, what it is about (a building or one of its phases),
// assignee (members covering the building), deadline and notes.
export function TaskForm({ orgId, projectId, buildings, fixedBuildingId = null, onCreated, onCancel }) {
  const [form, setForm] = useState({ title: '', buildingId: fixedBuildingId ?? '', phaseKey: '', assignedTo: '', deadline: '', notes: '' })
  const [assignees, setAssignees] = useState([])
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    let active = true
    tasksApi
      .assignees(orgId, projectId, form.buildingId || null)
      .then((r) => active && setAssignees(r.assignees))
      .catch(() => active && setAssignees([]))
    return () => {
      active = false
    }
  }, [orgId, projectId, form.buildingId])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const about = form.buildingId ? (form.phaseKey ? { relatedObjectType: 'phase', relatedObjectId: form.phaseKey, buildingId: form.buildingId } : { relatedObjectType: 'building', relatedObjectId: form.buildingId }) : {}
      const res = await tasksApi.create(orgId, projectId, { title: form.title, ...about, assignedTo: form.assignedTo, deadline: form.deadline || null, notes: form.notes || null })
      onCreated?.(res.task)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-surface p-3 text-xs sm:grid-cols-2" data-testid="task-form">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-text-secondary">Title</span>
        <input aria-label="Task title" required maxLength={200} value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputClass} />
      </label>
      {!fixedBuildingId && (
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Building</span>
          <select aria-label="Task building" value={form.buildingId} onChange={(e) => set({ buildingId: e.target.value, assignedTo: '' })} className={inputClass}>
            <option value="">Whole project</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Phase (optional)</span>
        <select aria-label="Task phase" value={form.phaseKey} disabled={!form.buildingId} onChange={(e) => set({ phaseKey: e.target.value })} className={inputClass}>
          <option value="">The building as a whole</option>
          {Object.entries(PHASE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Assignee</span>
        <select aria-label="Task assignee" required value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })} className={inputClass}>
          <option value="">Choose…</option>
          {assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name} ({a.roles.join(', ')})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Deadline</span>
        <input aria-label="Task deadline" type="date" value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-text-secondary">Notes</span>
        <textarea aria-label="Task notes" rows={2} maxLength={2000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={`${inputClass} h-auto py-1.5`} />
      </label>
      {error && (
        <p role="alert" className="text-status-red sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={saving} className="h-9 rounded-lg bg-brand px-4 font-medium text-white disabled:bg-status-grey">
          Assign task
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-border px-3 font-medium text-text">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

export function DeadlineBadge({ task }) {
  if (!task.deadline) return <span className="text-text-secondary">—</span>
  if (task.overdue)
    return (
      <span className="inline-flex items-center gap-1 rounded border border-status-red/40 px-1.5 py-0.5 font-medium text-status-red" title="Overdue">
        <AlertTriangle size={12} strokeWidth={2} />
        {task.deadline} · overdue
      </span>
    )
  if (task.dueSoon)
    return (
      <span className="inline-flex items-center gap-1 rounded border border-status-amber/40 px-1.5 py-0.5 text-status-amber" title="Due within 24 hours">
        <Clock size={12} strokeWidth={2} />
        {task.deadline}
      </span>
    )
  return <span className="text-text-secondary">{task.deadline}</span>
}

// Task rows (cards on a phone). `canMove(task)`: the assignee or a PM may set
// the status; the server refuses anything else and says why.
export function TaskList({ tasks, userId, isPm = false, highlightId = null, showProject = false, onStatus, onDelete, empty = 'No tasks yet.', linkFor = null }) {
  if (!tasks.length) return <p className="rounded-xl border border-border bg-surface px-3 py-6 text-center text-xs text-text-secondary">{empty}</p>
  return (
    <ul className="space-y-2" data-testid="task-list">
      {tasks.map((t) => {
        const mayMove = t.assignedTo === userId || isPm || t.assignedBy === userId
        const mayDelete = isPm || t.assignedBy === userId
        return (
          <li key={t.id} data-testid={`task-${t.id}`} className={`grid grid-cols-1 gap-2 rounded-xl border bg-surface p-3 text-xs sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] sm:items-center ${t.id === highlightId ? 'border-brand ring-2 ring-brand/20' : t.overdue ? 'border-status-red/40' : 'border-border'}`}>
            <div className="min-w-0">
              <div className={`text-sm font-medium ${t.status === 'complete' ? 'text-text-secondary line-through' : 'text-text'}`}>{t.title}</div>
              <div className="truncate text-text-secondary">
                {showProject && t.projectName ? `${t.projectName} · ` : ''}
                {linkFor && t.relatedLabel ? (
                  <Link to={linkFor(t)} className="text-brand hover:underline">
                    {t.relatedLabel}
                  </Link>
                ) : (
                  t.relatedLabel ?? 'Project-wide'
                )}
                {t.notes ? ` · ${t.notes}` : ''}
              </div>
              <div className="text-text-secondary">
                {t.assignedToName} · assigned by {t.assignedByName}
              </div>
            </div>
            <div>
              <DeadlineBadge task={t} />
            </div>
            <select aria-label={`Status of ${t.title}`} value={t.status} disabled={!mayMove || !onStatus} onChange={(e) => onStatus(t, e.target.value)} className={`${inputClass} sm:w-36`}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {onDelete && mayDelete ? (
              <button type="button" aria-label={`Delete ${t.title}`} onClick={() => onDelete(t)} className="flex h-9 w-9 items-center justify-center justify-self-start rounded-lg border border-border text-status-red hover:border-status-red">
                <Trash2 size={13} strokeWidth={2} />
              </button>
            ) : (
              <span className="hidden sm:block sm:w-9" />
            )}
          </li>
        )
      })}
    </ul>
  )
}
