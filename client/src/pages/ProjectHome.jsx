import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Building2, Settings } from 'lucide-react'
import { projectsApi } from '../api/projectsApi.js'

export default function ProjectHome() {
  const { orgId, projectId } = useParams()
  const [project, setProject] = useState(null)

  useEffect(() => {
    if (!orgId) return
    let active = true
    setProject(null)
    projectsApi.get(orgId, projectId).then((r) => active && setProject(r.project))
    return () => {
      active = false
    }
  }, [orgId, projectId])

  if (!project) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">{project.name}</h1>
          {project.clientName && <p className="text-sm text-text-secondary">{project.clientName}</p>}
        </div>
        <Link to={`/orgs/${orgId}/projects/${projectId}/settings`} className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-text hover:border-brand">
          <Settings size={15} strokeWidth={2} />
          Settings
        </Link>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-text">Buildings</h2>
        {project.buildings.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No buildings yet. Add the hierarchy under{' '}
            <Link to={`/orgs/${orgId}/projects/${projectId}/settings`} className="font-medium text-brand hover:underline">
              Settings → Hierarchy
            </Link>
            .
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {project.buildings.map((b) => (
              <Link
                key={b.id}
                to={`/orgs/${orgId}/projects/${projectId}/buildings/${b.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-brand/40 hover:shadow-sm"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Building2 size={20} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text">{b.name}</span>
                  <span className="block text-xs text-text-secondary">{b.code}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
