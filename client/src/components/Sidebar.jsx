import { useEffect, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { X, LayoutDashboard, FolderTree } from 'lucide-react'
import { PHASE_ICONS } from '../lib/phaseIcons.js'
import { PHASES } from '../mock/phases.js'
import { getProjectTree, getPhaseCards } from '../api/index.js'
import { subscribePhaseStatusChanges } from '../api/phaseStatusStore.js'
import ProjectTree from './ProjectTree.jsx'
import StatusDot from './StatusDot.jsx'

function PhaseNavList({ buildingId, showLabels, onNavigate, phaseStatuses }) {
  return (
    <nav aria-label="Phases" className="px-2">
      <NavLink
        to={`/b/${buildingId}`}
        end
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex h-touch items-center gap-3 rounded-lg px-2.5 text-sm font-medium sm:h-10 ${
            isActive ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
          }`
        }
      >
        <LayoutDashboard size={18} strokeWidth={2} className="shrink-0" />
        {showLabels && <span>Overview</span>}
      </NavLink>

      {PHASES.map((phase) => {
        const Icon = PHASE_ICONS[phase.icon]
        const status = phaseStatuses?.[phase.id]
        return (
          <NavLink
            key={phase.id}
            to={`/b/${buildingId}/${phase.id}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex h-touch items-center gap-3 rounded-lg px-2.5 text-sm font-medium sm:h-10 ${
                isActive ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
              }`
            }
            title={phase.name}
          >
            <Icon size={18} strokeWidth={2} className="shrink-0" />
            {showLabels ? (
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate leading-tight">{phase.name}</span>
                {status && <StatusDot status={status} />}
              </span>
            ) : (
              status && <StatusDot status={status} className="absolute right-1.5 top-1.5" />
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}

function SidebarContent({ buildingId, showLabels, tree, onNavigate, onOpenTree, phaseStatuses }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PhaseNavList buildingId={buildingId} showLabels={showLabels} onNavigate={onNavigate} phaseStatuses={phaseStatuses} />
      <div className="mx-3 my-2 border-t border-border" />
      {showLabels ? (
        <ProjectTree tree={tree} selectedBuildingId={buildingId} onNavigate={onNavigate} />
      ) : (
        <button
          type="button"
          onClick={onOpenTree}
          aria-label="Open project tree"
          title="Project tree"
          className="mx-2 flex h-touch w-touch items-center justify-center rounded-lg text-brand hover:bg-surface-muted"
        >
          <FolderTree size={18} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

export default function Sidebar({ mobileOpen, onOpenMobile, onCloseMobile }) {
  const { buildingId } = useParams()
  const [tree, setTree] = useState(null)
  const [phaseStatuses, setPhaseStatuses] = useState(null)

  useEffect(() => {
    let active = true
    getProjectTree().then((data) => {
      if (active) setTree(data)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!buildingId) return
    let active = true
    function load() {
      getPhaseCards(buildingId).then((cards) => {
        if (!active) return
        setPhaseStatuses(Object.fromEntries(cards.map((c) => [c.id, c.status])))
      })
    }
    load()
    const unsubscribe = subscribePhaseStatusChanges(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [buildingId])

  return (
    <>
      {/* Desktop / iPad: full rail with labels */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">
        <SidebarContent buildingId={buildingId} showLabels tree={tree} phaseStatuses={phaseStatuses} />
      </aside>

      {/* Tablet portrait: icon-only rail, with a trigger to open the tree as an overlay */}
      <aside className="hidden w-16 shrink-0 border-r border-border bg-surface sm:block md:hidden">
        <SidebarContent buildingId={buildingId} showLabels={false} tree={tree} onOpenTree={onOpenMobile} phaseStatuses={phaseStatuses} />
      </aside>

      {/* Phone drawer / tablet tree overlay (same panel, different trigger) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/30"
            onClick={onCloseMobile}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold text-text">Menu</span>
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
              <SidebarContent buildingId={buildingId} showLabels tree={tree} onNavigate={onCloseMobile} phaseStatuses={phaseStatuses} />
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
