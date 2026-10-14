import { useEffect, useState } from 'react'
import { ListPlus } from 'lucide-react'
import { RESOURCE_TASKS } from '@rackium/shared/billOfResources.js'
import { tasksApi } from '../../api/workApi.js'

const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'

// Bill of Resources → tasks (brief §5.5; M5b): the chosen task kinds become
// one assigned task per room, with the quantity and hours in the notes. A kind
// already open for a room is skipped.
export default function ResourceTasksAction({ orgId, projectId, buildingId, estimate }) {
  const kinds = RESOURCE_TASKS.filter((t) => (estimate?.totalsByTask?.[t.id] ?? 0) > 0)
  const [chosen, setChosen] = useState(() => kinds.map((k) => k.id))
  const [assignees, setAssignees] = useState([])
  const [assignedTo, setAssignedTo] = useState('')
  const [deadline, setDeadline] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    tasksApi
      .assignees(orgId, projectId, buildingId)
      .then((r) => setAssignees(r.assignees))
      .catch(() => setAssignees([]))
  }, [orgId, projectId, buildingId])

  if (!kinds.length) return null

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await tasksApi.fromResources(orgId, projectId, { buildingId, assignedTo, deadline: deadline || null, taskIds: chosen })
      setResult(`${res.tasks.length} task(s) assigned${res.skipped.length ? `; ${res.skipped.length} already open, skipped` : ''}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3 text-xs" data-testid="resource-tasks">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <ListPlus size={15} strokeWidth={2} className="text-brand" />
        Turn the Bill of Resources into tasks
      </div>
      <p className="text-text-secondary">One task per room for each kind chosen, with its quantity and hours.</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {kinds.map((k) => (
          <label key={k.id} className="flex items-center gap-1.5 text-text">
            <input type="checkbox" checked={chosen.includes(k.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, k.id] : c.filter((x) => x !== k.id)))} />
            {k.label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Assign to</span>
          <select aria-label="Resource tasks assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
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
          <input aria-label="Resource tasks deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputClass} />
        </label>
        <button type="button" disabled={busy || !assignedTo || !chosen.length} onClick={create} className="h-9 rounded-lg bg-brand px-4 font-medium text-white disabled:bg-status-grey">
          Create tasks per room
        </button>
      </div>
      {result && (
        <p role="status" className="text-status-green">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className="text-status-red">
          {error}
        </p>
      )}
    </div>
  )
}
