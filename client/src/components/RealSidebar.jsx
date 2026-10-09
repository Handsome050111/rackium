import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Plus, X, Building2, Boxes, Settings2 } from 'lucide-react'
import { ACTIONS } from '@rackium/shared/policy.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { canIn, canCreateProjectsIn } from '../lib/realRoles.js'
import { PHASE_ICONS } from '../lib/phaseIcons.js'
import { PHASES } from '../mock/phases.js'
import StatusDot from './StatusDot.jsx'
import Mark from './Mark.jsx'
import { projectsApi } from '../api/projectsApi.js'
import { dashboardApi } from '../api/dashboardApi.js'

// Real-mode equivalent of Sidebar.jsx (which stays mock-only). Projects
// heading with "+ New project" sits above the signed-in user's projects;
// inside one, its buildings, and inside a building, its active phases.
function useRealRouteIds() {
  const { pathname, search } = useLocation()
  const orgId = pathname.match(/^\/orgs\/([^/]+)/)?.[1] ?? null
  // The catalogue lives at org level and carries the project as ?projectId.
  const projectId = pathname.match(/^\/orgs\/[^/]+\/projects\/([^/]+)/)?.[1] ?? new URLSearchParams(search).get('projectId')
  const buildingId = pathname.match(/\/buildings\/([^/]+)/)?.[1] ?? null
  return { orgId, projectId, buildingId }
}

function navLinkClass({ isActive }) {
  return `flex h-touch items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:h-9 ${
    isActive ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
  }`
}

function SidebarContent({ showLabels, orgId, projectId, buildingId, onNavigate }) {
  const { memberships } = useAuth()
  const canCreate = canCreateProjectsIn(memberships, orgId)
  const isOrgAdmin = canIn(memberships, orgId, null, ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE)
  const [projects, setProjects] = useState(null)
  const [phases, setPhases] = useState(null)

  useEffect(() => {
    if (!orgId) return
    let active = true
    projectsApi.list(orgId).then((r) => active && setProjects(r.projects))
    return () => {
      active = false
    }
  }, [orgId])

  useEffect(() => {
    setPhases(null)
    if (!orgId || !projectId || !buildingId) return undefined
    let active = true
    dashboardApi
      .getBuildingDashboard(orgId, projectId, buildingId)
      .then((r) => active && setPhases(r.phases))
      .catch(() => active && setPhases(null)) // e.g. a building outside the caller's scope
    return () => {
      active = false
    }
  }, [orgId, projectId, buildingId])

  const currentProject = projects?.find((p) => p.id === projectId) ?? null

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-3">
        {showLabels && <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Projects</span>}
        {canCreate && (
        <Link
          to={`/orgs/${orgId}/projects/new`}
          onClick={onNavigate}
          aria-label="New project"
          title="New project"
          className="flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted sm:h-8 sm:w-8"
        >
          <Plus size={18} strokeWidth={2} />
        </Link>
        )}
      </div>
      <nav aria-label="Projects" className="px-2">
        {(projects ?? []).map((p) => (
          <NavLink key={p.id} to={`/orgs/${orgId}/projects/${p.id}`} onClick={onNavigate} className={navLinkClass}>
            <span className="truncate">{showLabels ? p.name : (p.code ?? p.name.slice(0, 2)).slice(0, 3)}</span>
          </NavLink>
        ))}
      </nav>

      {/* Organisation-wide; opened from inside a project it also shows that
          project's own items and prices for the user's role there. */}
      <nav aria-label="Organisation" className="mt-1 px-2">
        <NavLink to={`/orgs/${orgId}/catalogue${projectId ? `?projectId=${projectId}` : ''}`} onClick={onNavigate} className={navLinkClass} title="Equipment catalogue">
          <Boxes size={16} strokeWidth={2} className="shrink-0" />
          {showLabels && <span className="truncate">Equipment catalogue</span>}
        </NavLink>
        {isOrgAdmin && (
          <NavLink to={`/orgs/${orgId}/settings`} onClick={onNavigate} className={navLinkClass} title="Organisation settings">
            <Settings2 size={16} strokeWidth={2} className="shrink-0" />
            {showLabels && <span className="truncate">Organisation settings</span>}
          </NavLink>
        )}
      </nav>

      {currentProject && (
        <>
          <div className="mx-3 my-2 border-t border-border" />
          {showLabels && <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">Buildings</div>}
          <nav aria-label="Buildings" className="px-2">
            {currentProject.buildings.map((b) => (
              <NavLink key={b.id} to={`/orgs/${orgId}/projects/${projectId}/buildings/${b.id}`} onClick={onNavigate} className={navLinkClass}>
                <Building2 size={16} strokeWidth={2} className="shrink-0" />
                {showLabels && <span className="truncate">{b.code}</span>}
              </NavLink>
            ))}
          </nav>
        </>
      )}

      {buildingId && phases && (
        <>
          <div className="mx-3 my-2 border-t border-border" />
          <nav aria-label="Phases" className="px-2">
            {phases.map((entry) => {
              const phase = PHASES.find((p) => p.id === entry.phaseKey)
              if (!phase) return null
              const Icon = PHASE_ICONS[phase.icon]
              return (
                <NavLink
                  key={phase.id}
                  to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/${phase.id}`}
                  onClick={onNavigate}
                  className={navLinkClass}
                  title={phase.name}
                >
                  <Icon size={16} strokeWidth={2} className="shrink-0" />
                  {showLabels ? (
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate leading-tight">{phase.shortName}</span>
                      <StatusDot status={entry.status} />
                    </span>
                  ) : (
                    <StatusDot status={entry.status} className="absolute right-1.5 top-1.5" />
                  )}
                </NavLink>
              )
            })}
          </nav>
        </>
      )}
    </div>
  )
}

export default function RealSidebar({ mobileOpen, onCloseMobile }) {
  const { orgId, projectId, buildingId } = useRealRouteIds()

  return (
    <>
      {/* Desktop / iPad: full rail with labels */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">
        <SidebarContent showLabels orgId={orgId} projectId={projectId} buildingId={buildingId} />
      </aside>

      {/* Tablet portrait: icon-only rail */}
      <aside className="hidden w-16 shrink-0 border-r border-border bg-surface sm:flex sm:flex-col md:hidden">
        <div className="flex h-16 shrink-0 items-center justify-center border-b border-border">
          <Mark />
        </div>
        <div className="min-h-0 flex-1">
          <SidebarContent showLabels={false} orgId={orgId} projectId={projectId} buildingId={buildingId} />
        </div>
      </aside>

      {/* Phone drawer, triggered from TopBar's menu button */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/30" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
              <Mark />
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close menu"
                className="flex h-touch w-touch items-center justify-center rounded-lg text-text-secondary"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent showLabels orgId={orgId} projectId={projectId} buildingId={buildingId} onNavigate={onCloseMobile} />
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
