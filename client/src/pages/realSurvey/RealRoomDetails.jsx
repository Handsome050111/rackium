import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Building2, DoorOpen, PackageCheck } from 'lucide-react'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import SurveyStepper from '../../components/SurveyStepper.jsx'
import StatusDot from '../../components/StatusDot.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import RealSurveyTabForm from '../../components/survey/RealSurveyTabForm.jsx'
import { surveyApi } from '../../api/surveyApi.js'
import { SURVEY_TABS, tabSlug, tabBySlug } from '../../lib/surveyFormModel.js'
import { useProjectRoles } from '../../lib/useProjectRoles.js'
import { useRealSurveySync } from '../../lib/RealSurveySync.jsx'
import { surveyPath, stepperLinksFor } from '../../lib/realSurveyModel.js'

const BUILDING_TABS = SURVEY_TABS.filter((t) => t.scope === 'building')
const ROOM_TABS = SURVEY_TABS.filter((t) => t.scope === 'room')
const TAB_DOT = { draft: 'not_started', submitted: 'awaiting_approval', verified: 'approved', imported: 'approved', rejected: 'changes_requested' }

// Real-mode Room Details (brief v2.3 §5.2): the 18 survey tabs from
// docs/survey-fields.json — building tabs once per building, the others per
// room — with the Draft → Submitted → Verified / Rejected → Imported
// workflow. The survey phase is Approved when every tab is Verified.
export default function RealRoomDetails() {
  const { orgId, projectId, buildingId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { roles, readOnly } = useProjectRoles(orgId, projectId)
  const { isOffline, revision } = useRealSurveySync()
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  const roomId = searchParams.get('room')
  const scope = roomId ? 'room' : 'building'
  const pool = scope === 'room' ? ROOM_TABS : BUILDING_TABS
  const fromSlug = tabBySlug(searchParams.get('tab') ?? '')
  const activeTab = fromSlug && pool.some((t) => t.tab === fromSlug.tab) ? fromSlug.tab : pool[0].tab

  const reloadProgress = useCallback(async () => {
    if (isOffline) return
    try {
      setProgress(await surveyApi.progress(orgId, projectId, buildingId))
    } catch (err) {
      setError(err.message)
    }
  }, [orgId, projectId, buildingId, isOffline])

  useEffect(() => {
    reloadProgress()
  }, [reloadProgress, revision])

  if (error && !progress) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!progress) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const selectRoom = (id) => setSearchParams(id ? { room: id, tab: tabSlug(ROOM_TABS[0].tab) } : { tab: tabSlug(BUILDING_TABS[0].tab) })
  const selectTab = (name) => setSearchParams(roomId ? { room: roomId, tab: tabSlug(name) } : { tab: tabSlug(name) })
  const canImport = !readOnly && !isOffline && can(roles, ACTIONS.IMPORT_SURVEY_INTO_HLD)
  const percent = progress.totalCount === 0 ? 0 : Math.round((progress.verifiedCount / progress.totalCount) * 100)

  async function handleImport() {
    try {
      setProgress(await surveyApi.importBuilding(orgId, projectId, buildingId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6">
      <Link to={surveyPath(orgId, projectId, buildingId)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {progress.building.code} site structure
      </Link>
      <SurveyStepper active="room-details" links={{ ...stepperLinksFor(orgId, projectId, buildingId, progress.rooms.flatMap((r) => r.racks ?? [])[0]?.id), 'room-details': undefined }} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
          </div>
          <span data-testid="verified-count" className="text-xs text-text-secondary">
            {progress.verifiedCount}/{progress.totalCount} tabs Verified
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary">
            Survey phase <StatusChip status={progress.phaseStatus} />
          </span>
          {progress.openDesignFlags > 0 && <span className="text-xs text-status-amber">Survey changed after import ({progress.openDesignFlags})</span>}
        </div>
        {canImport && (
          <button
            type="button"
            disabled={!progress.allVerified}
            onClick={handleImport}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-status-green px-3 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-status-grey"
          >
            <PackageCheck size={13} strokeWidth={2} />
            Import into HLD
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-status-red">{error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 space-y-3 lg:w-64">
          <button
            type="button"
            onClick={() => selectRoom(null)}
            className={`flex h-touch w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:h-9 ${scope === 'building' ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'}`}
          >
            <Building2 size={16} strokeWidth={2} />
            Building-wide
          </button>
          <div>
            <div className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Rooms</div>
            <div className="mt-1 space-y-0.5">
              {progress.rooms.length === 0 && <p className="px-2.5 text-xs text-text-secondary">No rooms yet — add them in Site Structure.</p>}
              {progress.rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => selectRoom(room.id)}
                  className={`flex h-touch w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:h-9 ${roomId === room.id ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'}`}
                >
                  <DoorOpen size={14} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{room.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1.5 lg:flex-wrap">
            {pool.map((t) => {
              const entry = progress.tabs.find((p) => p.tab === t.tab && (scope === 'building' ? p.roomId == null : p.roomId === roomId))
              return (
                <button
                  key={t.tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === t.tab}
                  onClick={() => selectTab(t.tab)}
                  className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium ${activeTab === t.tab ? 'bg-brand text-white' : 'text-text hover:bg-surface-muted'}`}
                >
                  {t.tab}
                  {entry && <StatusDot status={TAB_DOT[entry.status] ?? 'not_started'} />}
                </button>
              )
            })}
          </div>

          <RealSurveyTabForm
            key={`${activeTab}:${roomId ?? 'building'}`}
            orgId={orgId}
            projectId={projectId}
            buildingId={buildingId}
            roomId={roomId}
            tabName={activeTab}
            rackLinkFor={(rackId) => surveyPath(orgId, projectId, buildingId, `/rack?rack=${rackId}`)}
            onChanged={reloadProgress}
          />
        </div>
      </div>
    </div>
  )
}
