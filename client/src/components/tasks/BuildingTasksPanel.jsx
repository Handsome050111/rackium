import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Plus } from 'lucide-react'
import { TaskForm, TaskList } from './TaskParts.jsx'
import { tasksApi, sortTasks } from '../../api/workApi.js'

// The building's tasks on its dashboard (M5b: tasks visible on related
// objects) — anything about the building, its phases, rooms, racks, devices,
// blockers or change requests. A PM or Architect assigns a new one here.
export default function BuildingTasksPanel({ orgId, projectId, buildingId, userId, isPm }) {
  const [data, setData] = useState(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await tasksApi.list(orgId, projectId, { buildingId }))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    load()
  }, [load])

  async function setStatus(task, status) {
    try {
      await tasksApi.update(orgId, projectId, task.id, { status })
    } catch (err) {
      setError(err.message)
    }
    await load()
  }

  const open = (data?.tasks ?? []).filter((t) => t.status !== 'complete')
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4" data-testid="building-tasks">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          <ListChecks size={15} strokeWidth={2} className="text-brand" />
          Tasks ({open.length} open)
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <Link to={`/orgs/${orgId}/projects/${projectId}/tasks`} className="font-medium text-brand hover:underline">
            All project tasks
          </Link>
          {data?.canAssign && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="flex h-8 items-center gap-1 rounded-lg bg-brand px-3 font-medium text-white">
              <Plus size={13} strokeWidth={2} />
              New task
            </button>
          )}
        </div>
      </div>
      {adding && (
        <TaskForm
          orgId={orgId}
          projectId={projectId}
          buildings={[]}
          fixedBuildingId={buildingId}
          onCancel={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false)
            await load()
          }}
        />
      )}
      {error && <p className="text-xs text-status-red">{error}</p>}
      {data && <TaskList tasks={sortTasks(open)} userId={userId} isPm={isPm} onStatus={setStatus} empty="No open tasks for this building." />}
    </section>
  )
}
