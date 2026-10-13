import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ListChecks, Plus } from 'lucide-react'
import { TASK_STATUSES, TASK_STATUS_LABELS } from '@rackium/shared/notifications.js'
import { TaskForm, TaskList } from '../components/tasks/TaskParts.jsx'
import { tasksApi, sortTasks } from '../api/workApi.js'
import { projectsApi } from '../api/projectsApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const selectClass = 'h-9 min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'

// Tasks (brief v2.2 §8; M5b). With a project: the project's task list with
// filters and overdue highlighting; a PM or Architect assigns. Without one:
// "My tasks" across the organisation's projects.
export default function RealTasks() {
  const { orgId, projectId = null } = useParams()
  const [searchParams] = useSearchParams()
  const highlightId = searchParams.get('task')
  const { user } = useAuth()
  const { has } = useProjectRoles(orgId, projectId)
  const [data, setData] = useState(null)
  const [projects, setProjects] = useState([])
  const [filters, setFilters] = useState({ status: '', assignedTo: '', buildingId: '', overdue: false })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = projectId
        ? await tasksApi.list(orgId, projectId, { status: filters.status || undefined, assignedTo: filters.assignedTo || undefined, buildingId: filters.buildingId || undefined, overdue: filters.overdue ? 'true' : undefined })
        : await tasksApi.mine(orgId, { status: filters.status || undefined, includeComplete: filters.status ? undefined : 'false' })
      setData(res)
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'This project is not one you can see.' : err.message)
    }
  }, [orgId, projectId, filters])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    projectsApi
      .list(orgId)
      .then((r) => setProjects(r.projects))
      .catch(() => {})
  }, [orgId])

  const project = projects.find((p) => p.id === projectId) ?? null
  const buildings = project?.buildings ?? []
  const tasks = useMemo(() => sortTasks(data?.tasks ?? []), [data])
  const overdue = tasks.filter((t) => t.overdue).length

  async function setStatus(task, status) {
    try {
      await tasksApi.update(orgId, task.projectId ?? projectId, task.id, { status })
      setNotice(`${task.title}: ${TASK_STATUS_LABELS[status]}`)
      await load()
    } catch (err) {
      setError(err.message)
      await load()
    }
  }
  async function remove(task) {
    if (!window.confirm(`Delete the task "${task.title}"?`)) return
    try {
      await tasksApi.remove(orgId, task.projectId ?? projectId, task.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }
  const linkFor = (t) => (t.buildingId ? `/orgs/${orgId}/projects/${t.projectId}/buildings/${t.buildingId}${t.phaseKey && t.relatedObjectType === 'phase' ? `/${t.phaseKey}` : ''}` : null)

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
            <ListChecks size={22} strokeWidth={2} className="text-brand" />
            {projectId ? `Tasks${project ? ` — ${project.name}` : ''}` : 'My tasks'}
          </h1>
          <p className="text-sm text-text-secondary">
            {projectId ? 'Work assigned in this project.' : 'Work assigned to you in every project of the organisation.'}
            {overdue > 0 && <span className="font-medium text-status-red"> {overdue} overdue.</span>}
          </p>
        </div>
        {projectId && data?.canAssign && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white">
            <Plus size={14} strokeWidth={2} />
            New task
          </button>
        )}
      </div>

      {adding && (
        <TaskForm
          orgId={orgId}
          projectId={projectId}
          buildings={buildings}
          onCancel={() => setAdding(false)}
          onCreated={async (task) => {
            setAdding(false)
            setNotice(`Assigned "${task.title}" to ${task.assignedToName}`)
            await load()
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-2 text-xs" data-testid="task-filters">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Status</span>
          <select aria-label="Filter by status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={selectClass}>
            <option value="">{projectId ? 'Any' : 'Open'}</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {projectId && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Assignee</span>
              <select aria-label="Filter by assignee" value={filters.assignedTo} onChange={(e) => setFilters((f) => ({ ...f, assignedTo: e.target.value }))} className={selectClass}>
                <option value="">Anyone</option>
                <option value="me">Me</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Building</span>
              <select aria-label="Filter by building" value={filters.buildingId} onChange={(e) => setFilters((f) => ({ ...f, buildingId: e.target.value }))} className={selectClass}>
                <option value="">All</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-9 items-center gap-1.5 text-text">
              <input type="checkbox" checked={filters.overdue} onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.checked }))} />
              Overdue only
            </label>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-status-red">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-status-green">
          {notice}
        </p>
      )}
      {!data && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {data && <TaskList tasks={tasks} userId={user?.id} isPm={projectId ? has('pm') : false} highlightId={highlightId} showProject={!projectId} onStatus={setStatus} onDelete={projectId ? remove : null} linkFor={linkFor} empty={projectId ? 'No tasks match.' : 'Nothing assigned to you.'} />}
    </div>
  )
}
