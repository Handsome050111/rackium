import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { API_MODE } from '../lib/apiMode.js'
import { projectsApi } from '../api/projectsApi.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canCreateProjectsIn } from '../lib/realRoles.js'
import KpiStrip from '../components/KpiStrip.jsx'

const STATUS_CLASS = { active: 'bg-status-green/10 text-status-green', archived: 'bg-status-grey/10 text-status-grey' }

// orgId comes from the URL (/orgs/:orgId/...), not from memberships[0] — a
// user who belongs to more than one organisation must see the one they're
// actually in, not whichever membership happened to load first.
export default function ProjectsList() {
  const { orgId } = useParams()
  const { memberships } = useAuth()
  const canCreate = canCreateProjectsIn(memberships, orgId)
  const [projects, setProjects] = useState(null)

  useEffect(() => {
    if (!orgId) return
    let active = true
    projectsApi.list(orgId).then((r) => active && setProjects(r.projects))
    return () => {
      active = false
    }
  }, [orgId])

  if (API_MODE === 'mock') {
    return <div className="p-6 text-sm text-text-secondary">Projects need the backend. Set VITE_API_MODE=real to use it.</div>
  }
  if (!orgId || projects === null) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const activeProjects = projects.filter((p) => p.status === 'active')
  const totalBuildings = projects.reduce((sum, p) => sum + p.buildings.length, 0)
  const allProgress = projects.flatMap((p) => p.buildings.map((b) => b.progress))
  const avgProgress = allProgress.length ? Math.round(allProgress.reduce((a, b) => a + b, 0) / allProgress.length) : 0

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-text">Projects</h1>
        {canCreate && (
          <Link to={`/orgs/${orgId}/projects/new`} className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-brand/90">
            <Plus size={16} strokeWidth={2} />
            New project
          </Link>
        )}
      </div>

      <KpiStrip
        items={[
          { label: 'Active projects', value: activeProjects.length },
          { label: 'Buildings', value: totalBuildings },
          { label: 'Average progress', value: `${avgProgress}%`, progress: avgProgress },
        ]}
      />

      {projects.length === 0 ? (
        <p className="text-sm text-text-secondary">No projects yet. Create one to get started.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const progress = p.buildings.length ? Math.round(p.buildings.reduce((s, b) => s + b.progress, 0) / p.buildings.length) : 0
            return (
              <Link key={p.id} to={`/orgs/${orgId}/projects/${p.id}`} className="rounded-xl border border-border bg-surface p-4 hover:border-brand/40 hover:shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-text">{p.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                </div>
                {p.clientName && <p className="mt-0.5 truncate text-xs text-text-secondary">{p.clientName}</p>}
                <p className="mt-2 text-xs text-text-secondary">
                  {p.buildings.length} building{p.buildings.length === 1 ? '' : 's'} · {progress}% progress
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
