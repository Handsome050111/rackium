import { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Building2, DoorOpen, PackageCheck, AlertTriangle } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import SurveyStepper from '../components/SurveyStepper.jsx'
import SurveyTabForm from '../components/survey/SurveyTabForm.jsx'
import StatusDot from '../components/StatusDot.jsx'
import { getBuilding } from '../api/index.js'
import { getBuildingSiteStructure } from '../api/siteStructure.js'
import { getBuildingSurveyProgress, importBuildingIntoHld, updateKeyValueSection } from '../api/surveyFormsDesign.js'
import { SURVEY_TABS, tabSlug, tabBySlug } from '../lib/surveyFormModel.js'
import { useOffline } from '../lib/OfflineContext.jsx'
import { useRole } from '../lib/RoleContext.jsx'

const BUILDING_TABS = SURVEY_TABS.filter((t) => t.scope === 'building')
const ROOM_TABS = SURVEY_TABS.filter((t) => t.scope === 'room')

function tabStatusDot(entry) {
  if (!entry) return null
  const map = { draft: 'not_started', submitted: 'awaiting_approval', verified: 'approved', imported: 'approved', rejected: 'changes_requested' }
  return map[entry.status] ?? 'not_started'
}

export default function RoomDetails() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const { isOffline, lastSyncReport } = useOffline()
  const [searchParams, setSearchParams] = useSearchParams()
  const [building, setBuilding] = useState(null)
  const [tree, setTree] = useState(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  const roomId = searchParams.get('room')
  const tabSlugParam = searchParams.get('tab')
  const scope = roomId ? 'room' : 'building'
  const tabPool = scope === 'room' ? ROOM_TABS : BUILDING_TABS
  const activeTab = tabBySlug(tabSlugParam ?? '') && tabPool.some((t) => t.tab === tabBySlug(tabSlugParam).tab) ? tabBySlug(tabSlugParam).tab : tabPool[0].tab

  const reloadProgress = useCallback(() => {
    getBuildingSurveyProgress(buildingId).then(setProgress)
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
    getBuildingSiteStructure(buildingId).then(({ buildings }) => setTree(buildings[0]))
  }, [buildingId])

  useEffect(() => {
    reloadProgress()
  }, [reloadProgress])

  function selectRoom(id) {
    setSearchParams(id ? { room: id, tab: tabSlug(ROOM_TABS[0].tab) } : { tab: tabSlug(BUILDING_TABS[0].tab) })
  }
  function selectTab(name) {
    const params = { tab: tabSlug(name) }
    if (roomId) params.room = roomId
    setSearchParams(params)
  }

  async function handleImport() {
    const result = await importBuildingIntoHld(buildingId, role)
    if (!result.ok) return setError(result.error)
    setError(null)
    reloadProgress()
  }

  function simulateConflictingEdit() {
    if (!isOffline) return
    // The sync report already shows when the live record changed
    // (currentModifiedAt) — this marker just needs to be a real write that
    // touches the record's lastModifiedAt, not carry its own timestamp.
    updateKeyValueSection(buildingId, activeTab, roomId, 0, { __simulated_conflict_marker: 'Edited by Architect on another device' })
  }

  if (!building || !tree || !progress) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const allRooms = tree.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floorName: f.name })))
  const stepperLinks = {
    'site-structure': `/b/${buildingId}/survey`,
    'room-details': `/b/${buildingId}/survey/room`,
    'rack-survey': allRooms.flatMap((r) => r.racks)[0] ? `/b/${buildingId}/survey/rack?rack=${allRooms.flatMap((r) => r.racks)[0].id}` : undefined,
    'building-connections': `/b/${buildingId}/survey/campus`,
    validation: `/b/${buildingId}/survey?panel=validation`,
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'Room Details' }]} />
      <SurveyStepper active="room-details" links={stepperLinks} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full bg-brand" style={{ width: `${progress.totalCount === 0 ? 0 : Math.round((progress.verifiedCount / progress.totalCount) * 100)}%` }} />
          </div>
          <span className="text-xs text-text-secondary">
            {progress.verifiedCount}/{progress.totalCount} tabs Verified
          </span>
        </div>
        {(role === 'architect' || role === 'pm') && (
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

      {error && <p className="text-xs text-status-red">{error}</p>}

      {lastSyncReport && lastSyncReport.length > 0 && (
        <div className="space-y-1 rounded-xl border border-status-amber/40 bg-status-amber/5 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-status-amber">
            <AlertTriangle size={13} strokeWidth={2} />
            Sync report
          </div>
          {lastSyncReport.map((r, i) => (
            <div key={i} className="text-text-secondary">
              {r.description ?? 'Edit'} —{' '}
              {r.outcome === 'conflict' ? (
                <span className="text-status-red">applied, but this record changed elsewhere at {new Date(r.currentModifiedAt).toLocaleTimeString()} — your edit overwrote it</span>
              ) : (
                <span className="text-status-green">synced cleanly</span>
              )}
            </div>
          ))}
        </div>
      )}

      {isOffline && (
        <button type="button" onClick={simulateConflictingEdit} className="text-[11px] text-text-secondary underline hover:text-status-amber">
          Dev: simulate a conflicting edit from another device on this tab
        </button>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 space-y-3 lg:w-64">
          <div>
            <button
              type="button"
              onClick={() => selectRoom(null)}
              className={`flex h-touch w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:h-9 ${
                scope === 'building' ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
              }`}
            >
              <Building2 size={16} strokeWidth={2} />
              Building-wide
            </button>
          </div>
          <div>
            <div className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Rooms</div>
            <div className="mt-1 space-y-0.5">
              {allRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => selectRoom(room.id)}
                  className={`flex h-touch w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium sm:h-9 ${
                    roomId === room.id ? 'bg-brand/10 text-brand' : 'text-text hover:bg-surface-muted'
                  }`}
                >
                  <DoorOpen size={14} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{room.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1.5">
            {tabPool.map((t) => {
              const entry = progress.tabs.find((p) => p.tab === t.tab && (scope === 'building' ? p.roomId == null : p.roomId === roomId))
              return (
                <button
                  key={t.tab}
                  type="button"
                  onClick={() => selectTab(t.tab)}
                  className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium ${
                    activeTab === t.tab ? 'bg-brand text-white' : 'text-text hover:bg-surface-muted'
                  }`}
                >
                  {t.tab}
                  {tabStatusDot(entry) && <StatusDot status={tabStatusDot(entry)} />}
                </button>
              )
            })}
          </div>

          <SurveyTabForm key={`${activeTab}:${roomId ?? 'building'}`} buildingId={buildingId} tabName={activeTab} roomId={roomId} onChanged={reloadProgress} />
        </div>
      </div>
    </div>
  )
}
