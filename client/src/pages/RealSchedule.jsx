import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CalendarRange } from 'lucide-react'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import { scheduleApi } from '../api/scheduleApi.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import Gantt from '../components/schedule/Gantt.jsx'
import ScheduleList from '../components/schedule/ScheduleList.jsx'
import { TargetsPanel, MilestonesPanel, DependenciesPanel, SlaPanel, SettingsPanel } from '../components/schedule/SchedulePanels.jsx'

const tab = (active) => `h-8 rounded-md px-3 text-xs font-medium ${active ? 'bg-brand text-white' : 'text-text hover:bg-surface-muted'}`

// Project schedule (brief v2.2 §21; M7a-1): the Gantt with targets,
// milestones, cross-building dependencies, the critical path and SLAs. The
// Org Admin and PM plan; everyone else reads. Phones get the list only.
export default function RealSchedule() {
  const { orgId, projectId } = useParams()
  const { roles, readOnly } = useProjectRoles(orgId, projectId)
  const phone = useMediaQuery('(max-width: 767px)')
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [mode, setMode] = useState('gantt')
  const [zoom, setZoom] = useState('weeks')
  const [buildingId, setBuildingId] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await scheduleApi.view(orgId, projectId)
      setView(res)
      setError(null)
      setBuildingId((b) => (b && res?.buildings.some((x) => x.id === b) ? b : res?.buildings[0]?.id ?? null))
    } catch (err) {
      setError(err.status === 404 ? 'This project is not one you can see.' : err.message)
    }
  }, [orgId, projectId])
  useEffect(() => {
    load()
  }, [load])

  const canEdit = !readOnly && can(roles, ACTIONS.CREATE_BUILDINGS_SET_TARGETS)
  const canEditProject = canEdit && view && !view.scopeLimited

  // Every write: run it, say what happened, reload (the server recomputes).
  const run = useCallback(
    async (fn, message) => {
      try {
        await fn()
        setNotice(message)
        setError(null)
      } catch (err) {
        setNotice(null)
        setError(err.message)
      }
      await load()
    },
    [load]
  )

  const onChangeDates = (bar, dates) =>
    run(() => scheduleApi.setTargets(orgId, projectId, [{ buildingId: bar.buildingId, phaseKey: bar.phaseKey, startDate: dates.startDate, targetDate: dates.targetDate }]), `${view.buildings.find((b) => b.id === bar.buildingId)?.code} ${PHASE_LABELS[bar.phaseKey]}: ${dates.startDate ? `${dates.startDate} → ` : ''}${dates.targetDate}`)

  const overdue = view?.bars.filter((b) => b.risk === 'overdue').length ?? 0
  const atRisk = view?.bars.filter((b) => b.risk === 'at_risk').length ?? 0
  const showGantt = !phone && mode === 'gantt'

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
            <CalendarRange size={22} strokeWidth={2} className="text-brand" />
            Schedule
          </h1>
          {view && (
            <p className="text-sm text-text-secondary">
              Today {view.today} ({view.timeZone}).{view.end && ` Planned end ${view.end}.`}
              {overdue > 0 && <span className="font-medium text-status-red"> {overdue} overdue.</span>}
              {atRisk > 0 && <span className="font-medium text-status-amber"> {atRisk} at risk.</span>}
              {view.next && ` Next milestone: ${view.next.name} · ${view.next.dueDate}.`}
            </p>
          )}
        </div>
        {!phone && view && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="View">
              <button type="button" className={tab(mode === 'gantt')} aria-pressed={mode === 'gantt'} onClick={() => setMode('gantt')}>
                Gantt
              </button>
              <button type="button" className={tab(mode === 'list')} aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
                List
              </button>
            </div>
            {mode === 'gantt' && (
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Zoom">
                <button type="button" className={tab(zoom === 'weeks')} aria-pressed={zoom === 'weeks'} onClick={() => setZoom('weeks')}>
                  Weeks
                </button>
                <button type="button" className={tab(zoom === 'months')} aria-pressed={zoom === 'months'} onClick={() => setZoom('months')}>
                  Months
                </button>
              </div>
            )}
          </div>
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
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}

      {view && (
        <>
          {view.scopeLimited && <p className="text-xs text-text-secondary">Showing the buildings in your scope.</p>}
          {showGantt ? (
            <>
              <Gantt view={view} canEdit={canEdit} zoom={zoom} onChangeDates={onChangeDates} onSelectBar={(bar) => setBuildingId(bar.buildingId)} />
              {canEdit && <p className="text-[11px] text-text-secondary">Drag a bar to move it, or its right edge to change the target. The Targets panel below does the same with the keyboard.</p>}
            </>
          ) : (
            <ScheduleList view={view} />
          )}

          {!phone && (
            <div className="grid gap-4 xl:grid-cols-2">
              {view.buildings.length > 0 && <TargetsPanel view={view} orgId={orgId} projectId={projectId} canEdit={canEdit} buildingId={buildingId} onBuilding={setBuildingId} run={run} />}
              <MilestonesPanel view={view} orgId={orgId} projectId={projectId} canEdit={canEdit} canEditProject={canEditProject} run={run} />
              <SlaPanel view={view} orgId={orgId} projectId={projectId} canEdit={canEdit} canEditProject={canEditProject} run={run} />
              <DependenciesPanel view={view} orgId={orgId} projectId={projectId} canEdit={canEdit} run={run} />
              {canEditProject && <SettingsPanel view={view} orgId={orgId} projectId={projectId} run={run} />}
            </div>
          )}
        </>
      )}
    </div>
  )
}
