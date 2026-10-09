import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { ArrowLeft, ClipboardCheck, Link2, Plus, Trash2 } from 'lucide-react'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import SiteStructureBoard from '../../components/SiteStructureBoard.jsx'
import SiteObjectLibrary from '../../components/SiteObjectLibrary.jsx'
import DragPreviewCard from '../../components/DragPreviewCard.jsx'
import RoomDetailPanel from '../../components/RoomDetailPanel.jsx'
import ConnectionDetailPanel from '../../components/ConnectionDetailPanel.jsx'
import ValidationResultsPanel from '../../components/ValidationResultsPanel.jsx'
import SurveyStepper from '../../components/SurveyStepper.jsx'
import PhotoStrip from '../../components/survey/PhotoStrip.jsx'
import { surveyApi } from '../../api/surveyApi.js'
import { useDragSensors } from '../../lib/useDragSensors.js'
import { useProjectRoles } from '../../lib/useProjectRoles.js'
import { useRealSurveySync } from '../../lib/RealSurveySync.jsx'
import { surveyPath, stepperLinksFor, toPanelValue as toPanel, toApiValue as toApi } from '../../lib/realSurveyModel.js'

function AddFloorForm({ onAdd }) {
  const [token, setToken] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!token.trim()) return
        try {
          await onAdd({ token: token.trim(), name: name.trim() || token.trim() })
          setToken('')
          setName('')
          setError(null)
        } catch (err) {
          setError(err.message)
        }
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="space-y-1">
        <span className="block text-[11px] text-text-secondary">Floor code</span>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="e.g. EG" aria-label="Floor code" className="h-9 w-24 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none" />
      </label>
      <label className="space-y-1">
        <span className="block text-[11px] text-text-secondary">Floor name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ground floor" aria-label="Floor name" className="h-9 w-40 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none" />
      </label>
      <button type="submit" className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
        <Plus size={13} strokeWidth={2} />
        Add floor
      </button>
      {error && <span className="w-full text-[11px] text-status-red">{error}</span>}
    </form>
  )
}

// Real-mode Physical Site Survey — Site Structure (brief v2.3 §5.2, M3b):
// floors, rooms and racks on the project hierarchy, room facts and photos,
// and pathways between rooms (also across buildings, in the campus view)
// with surveyed/estimated distances the cable-length engine uses. Reuses the
// prototype's board, library and panels.
export default function RealSiteStructure({ mode = 'building' }) {
  const { orgId, projectId, buildingId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { roles, readOnly } = useProjectRoles(orgId, projectId)
  const { isOffline } = useRealSurveySync()
  const canEdit = !readOnly && !isOffline && can(roles, ACTIONS.EDIT_SITE_STRUCTURE)

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null) // { type: 'room' | 'connection', id }
  const [connectMode, setConnectMode] = useState(false)
  const [connectFirstRoomId, setConnectFirstRoomId] = useState(null)
  const [showFindings, setShowFindings] = useState(searchParams.get('panel') === 'validation')
  const [activeDragData, setActiveDragData] = useState(null)
  const [roomFloorId, setRoomFloorId] = useState('')
  const distanceTimer = useRef(null)
  const pendingPathwaySave = useRef(null) // { id, patch } waiting for the typing pause
  const sensors = useDragSensors()

  const reload = useCallback(async () => {
    try {
      const next = mode === 'campus' ? await surveyApi.campusStructure(orgId, projectId, buildingId) : await surveyApi.structure(orgId, projectId, buildingId)
      setData(next)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [mode, orgId, projectId, buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  // Leaving the page mid-pause still saves the distance just typed.
  useEffect(
    () => () => {
      clearTimeout(distanceTimer.current)
      const pending = pendingPathwaySave.current
      if (pending) surveyApi.updatePathway(orgId, projectId, pending.id, pending.patch).catch(() => {})
    },
    [orgId, projectId]
  )

  const rooms = useMemo(() => (data ? data.buildings.flatMap((b) => b.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f, buildingCode: b.buildingCode })))) : []), [data])
  const floors = useMemo(() => (data ? data.buildings.filter((b) => b.buildingId === buildingId).flatMap((b) => b.floors) : []), [data, buildingId])

  async function act(fn) {
    try {
      await fn()
      setError(null)
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function selectRoom(room) {
    if (connectMode) {
      if (!connectFirstRoomId) return setConnectFirstRoomId(room.id)
      if (room.id === connectFirstRoomId) return undefined
      await act(async () => {
        const { pathway } = await surveyApi.createPathway(orgId, projectId, { fromRoomId: connectFirstRoomId, toRoomId: room.id, routeStatus: 'estimated', distanceM: null })
        setSelected({ type: 'connection', id: pathway.id })
      })
      setConnectMode(false)
      setConnectFirstRoomId(null)
      return undefined
    }
    setShowFindings(false)
    setSelected({ type: 'room', id: room.id })
    return undefined
  }

  function selectRack(rack) {
    const owner = data.buildings.find((b) => b.floors.some((f) => f.rooms.some((r) => r.racks.some((k) => k.id === rack.id))))
    navigate(surveyPath(orgId, projectId, owner?.buildingId ?? buildingId, `/rack?rack=${rack.id}`))
  }

  async function handleDragEnd(event) {
    const dragged = activeDragData
    setActiveDragData(null)
    const overId = event.over?.id
    if (!dragged || !overId || dragged.kind !== 'library-item' || !canEdit) return
    if (dragged.item.kind === 'room' && overId.startsWith('site-floor:')) await act(() => surveyApi.createRoom(orgId, projectId, { floorId: overId.replace('site-floor:', '') }))
    else if (dragged.item.kind === 'rack' && overId.startsWith('site-room:')) await act(() => surveyApi.createRack(orgId, projectId, { roomId: overId.replace('site-room:', '') }))
  }

  function handleSelectFinding(finding) {
    if (!finding.objectId) return
    if (finding.objectType === 'room') selectRoom({ id: finding.objectId })
    else if (finding.objectType === 'rack') {
      const room = rooms.find((r) => r.racks.some((k) => k.id === finding.objectId))
      if (room) selectRoom(room)
    } else if (finding.objectType === 'connection') {
      setShowFindings(false)
      setSelected({ type: 'connection', id: finding.objectId })
    }
  }

  if (error && !data) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!data) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const building = data.building
  const selectedRoom = selected?.type === 'room' ? rooms.find((r) => r.id === selected.id) : null
  const selectedPathway = selected?.type === 'connection' ? data.pathways.find((p) => p.id === selected.id) : null
  const firstRack = rooms.find((r) => r.floor.buildingId === buildingId && r.racks.length)?.racks[0]
  const links = stepperLinksFor(orgId, projectId, buildingId, firstRack?.id)
  if (mode === 'campus') links['building-connections'] = undefined

  function changeRoomSurvey(patch) {
    const body = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, toApi(v)]))
    act(() => surveyApi.updateRoomSurvey(orgId, projectId, selectedRoom.id, body))
  }

  function changePathway(patch) {
    // Optimistic, so typing a distance stays smooth; saved after a pause.
    setData((prev) => ({ ...prev, pathways: prev.pathways.map((p) => (p.id === selectedPathway.id ? { ...p, ...patch } : p)) }))
    clearTimeout(distanceTimer.current)
    const id = selectedPathway.id
    const save = () => {
      pendingPathwaySave.current = null
      return act(() => surveyApi.updatePathway(orgId, projectId, id, patch))
    }
    if ('distanceM' in patch) {
      pendingPathwaySave.current = { id, patch }
      distanceTimer.current = setTimeout(save, 500)
    } else save()
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveDragData(e.active.data.current)} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
        <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <ArrowLeft size={14} strokeWidth={2} />
          {building.code} dashboard
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">Physical Site Survey — {mode === 'campus' ? 'Multi-Building Structure' : 'Building & Room Structure'}</h1>
            <p className="text-sm text-text-secondary">{mode === 'campus' ? `Buildings of campus ${building.campusCode ?? ''} you can reach` : building.name}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowFindings(true)
              setSelected(null)
              reload()
            }}
            className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
          >
            <ClipboardCheck size={14} strokeWidth={2} />
            Validate structure
          </button>
        </div>

        {mode === 'building' ? (
          <Link to={surveyPath(orgId, projectId, buildingId, '/campus')} className="inline-block text-xs font-medium text-brand hover:underline">
            View all buildings in the campus (cross-building pathways) →
          </Link>
        ) : (
          <Link to={surveyPath(orgId, projectId, buildingId)} className="inline-block text-xs font-medium text-brand hover:underline">
            ← Back to {building.code}
          </Link>
        )}

        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}

        {canEdit && mode === 'building' && (
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-surface p-3">
            <AddFloorForm onAdd={(body) => act(() => surveyApi.createFloor(orgId, projectId, { buildingId, order: floors.length, ...body }))} />
            {floors.length > 0 && (
              <div className="flex items-end gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] text-text-secondary">Floor</span>
                  <select value={roomFloorId || floors[0].id} onChange={(e) => setRoomFloorId(e.target.value)} aria-label="Floor for the new room" className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none">
                    {floors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.token} — {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => act(() => surveyApi.createRoom(orgId, projectId, { floorId: roomFloorId || floors[0].id }))}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
                >
                  <Plus size={13} strokeWidth={2} />
                  Add room
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            {floors.length === 0 && mode === 'building' && (
              <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary">No floors yet{canEdit ? ' — add the first floor above.' : '.'}</div>
            )}
            <SiteStructureBoard
              buildingGroups={data.buildings}
              editable={canEdit}
              connectMode={connectMode}
              connectFirstRoomId={connectFirstRoomId}
              selectedObjectRef={selected}
              onSelectRoom={selectRoom}
              onAddRack={(roomId) => act(() => surveyApi.createRack(orgId, projectId, { roomId }))}
              onSelectRack={selectRack}
              onAddRoom={(floorId) => act(() => surveyApi.createRoom(orgId, projectId, { floorId }))}
            />

            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                <Link2 size={16} strokeWidth={2} className="text-brand" />
                Pathways
              </div>
              {data.pathways.length === 0 ? (
                <p className="text-xs text-text-secondary">No pathways yet{canEdit ? ' — use "Building connection" in the library, then pick two rooms.' : '.'}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.pathways.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowFindings(false)
                          setSelected({ type: 'connection', id: p.id })
                        }}
                        className={`flex min-h-touch w-full items-center justify-between gap-2 px-1 py-1.5 text-left text-xs sm:min-h-0 ${selected?.id === p.id ? 'text-brand' : 'text-text hover:text-brand'}`}
                      >
                        <span className="font-medium">
                          {p.fromRoomCode} → {p.toRoomCode}
                          {p.fromBuildingId !== p.toBuildingId && <span className="ml-1 text-[10px] text-text-secondary">(cross-building)</span>}
                        </span>
                        <span className={p.routeStatus === 'surveyed' ? 'text-status-green' : 'text-status-amber'}>
                          {p.routeStatus === 'surveyed' ? 'Surveyed' : 'Estimated'} · {p.distanceM ?? '—'} m
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="w-full shrink-0 space-y-4 xl:w-72">
            {canEdit && (
              <SiteObjectLibrary
                permissions={{ canMoveDevices: true }}
                connectMode={connectMode}
                onToggleConnectMode={() => {
                  setConnectMode((m) => !m)
                  setConnectFirstRoomId(null)
                }}
              />
            )}
            {connectMode && <p className="text-xs text-brand">{connectFirstRoomId ? 'Now pick the second room.' : 'Pick the first room to connect.'}</p>}
            {!canEdit && (
              <div className="rounded-lg border border-dashed border-border bg-surface-muted p-3 text-center text-xs text-text-secondary">
                {isOffline ? 'Offline — the structure is read-only until you reconnect.' : 'Your role sees the structure read-only.'}
              </div>
            )}

            {showFindings ? (
              <ValidationResultsPanel findings={data.findings} onSelectFinding={handleSelectFinding} />
            ) : selectedRoom ? (
              <RoomDetailPanel
                room={selectedRoom}
                floor={selectedRoom.floor}
                meta={{ access: toPanel(selectedRoom.survey.access), power: toPanel(selectedRoom.survey.power), environment: toPanel(selectedRoom.survey.environment), photoCount: selectedRoom.photoCount }}
                onMetaChange={changeRoomSurvey}
                disabled={!canEdit}
                evidence={<PhotoStrip orgId={orgId} projectId={projectId} attachedTo={{ type: 'room', id: selectedRoom.id }} editable={canEdit} label={`${selectedRoom.code} photo`} />}
              />
            ) : selectedPathway ? (
              <ConnectionDetailPanel
                connection={selectedPathway}
                onChange={changePathway}
                disabled={!canEdit}
                evidence={<PhotoStrip orgId={orgId} projectId={projectId} attachedTo={{ type: 'pathway', id: selectedPathway.id }} editable={canEdit} label="Route photo" />}
                actions={
                  canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        act(async () => {
                          await surveyApi.deletePathway(orgId, projectId, selectedPathway.id)
                          setSelected(null)
                        })
                      }
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-status-red/30 px-3 text-xs font-medium text-status-red hover:bg-status-red/5"
                    >
                      <Trash2 size={13} strokeWidth={2} />
                      Delete pathway
                    </button>
                  )
                }
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-secondary">Select a room or pathway to see its details.</div>
            )}
          </div>
        </div>

        <SurveyStepper active="site-structure" links={links} />
      </div>
      <DragOverlay dropAnimation={null}>
        <DragPreviewCard dragData={activeDragData} />
      </DragOverlay>
    </DndContext>
  )
}
