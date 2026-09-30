import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { ClipboardCheck } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import SiteStructureBoard from '../components/SiteStructureBoard.jsx'
import SiteObjectLibrary from '../components/SiteObjectLibrary.jsx'
import DragPreviewCard from '../components/DragPreviewCard.jsx'
import RoomDetailPanel from '../components/RoomDetailPanel.jsx'
import ConnectionDetailPanel from '../components/ConnectionDetailPanel.jsx'
import FloorPlanUpload from '../components/FloorPlanUpload.jsx'
import ValidationResultsPanel from '../components/ValidationResultsPanel.jsx'
import SurveyStepper from '../components/SurveyStepper.jsx'
import { getBuilding } from '../api/index.js'
import { organisation, project, country, sal, campus } from '../mock/hierarchy.js'
import {
  getBuildingSiteStructure,
  getCampusSiteStructure,
  getRoomContext,
  getRoomMeta,
  updateRoomMeta,
  createRoom,
  createRack,
  createConnection,
  updateConnection,
  getConnectionContext,
  validateSiteStructure,
  BUILDING_IDS,
} from '../api/siteStructure.js'
import { useDragSensors } from '../lib/useDragSensors.js'
import { useRole } from '../lib/RoleContext.jsx'
import { getSiteStructurePermissions } from '../lib/permissions.js'

export default function SiteStructure({ mode }) {
  const { buildingId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { role } = useRole()
  const permissions = getSiteStructurePermissions(role)

  const [building, setBuilding] = useState(null)
  const [buildingGroups, setBuildingGroups] = useState(null)
  const [activeDragData, setActiveDragData] = useState(null)

  const [selectedObjectRef, setSelectedObjectRef] = useState(null)
  const [selectedRoomCtx, setSelectedRoomCtx] = useState(null)
  const [selectedRoomMeta, setSelectedRoomMeta] = useState(null)
  const [selectedConnection, setSelectedConnection] = useState(null)

  const [connectMode, setConnectMode] = useState(false)
  const [connectFirstRoomId, setConnectFirstRoomId] = useState(null)

  const [findings, setFindings] = useState(null)

  const sensors = useDragSensors()

  const reloadStructure = useCallback(() => {
    const load = mode === 'campus' ? getCampusSiteStructure() : getBuildingSiteStructure(buildingId)
    load.then((data) => setBuildingGroups(data.buildings))
  }, [mode, buildingId])

  useEffect(() => {
    if (mode === 'building') getBuilding(buildingId).then(setBuilding)
  }, [mode, buildingId])

  useEffect(() => {
    reloadStructure()
  }, [reloadStructure])

  useEffect(() => {
    if (searchParams.get('panel') === 'validation') runValidation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingGroups])

  function scopeBuildingIds() {
    return mode === 'campus' ? BUILDING_IDS : [buildingId]
  }

  async function runValidation() {
    const result = await validateSiteStructure(scopeBuildingIds())
    setFindings(result)
    setSelectedObjectRef(null)
  }

  async function selectRoom(room) {
    if (connectMode) {
      if (!connectFirstRoomId) {
        setConnectFirstRoomId(room.id)
      } else if (room.id !== connectFirstRoomId) {
        const conn = await createConnection(connectFirstRoomId, room.id)
        setConnectMode(false)
        setConnectFirstRoomId(null)
        const ctx = await getConnectionContext(conn.id)
        setSelectedConnection(ctx)
        setSelectedObjectRef({ type: 'connection', id: conn.id })
        reloadStructure()
      }
      return
    }
    setFindings(null)
    const [ctx, meta] = await Promise.all([getRoomContext(room.id), getRoomMeta(room.id)])
    setSelectedRoomCtx(ctx)
    setSelectedRoomMeta(meta)
    setSelectedObjectRef({ type: 'room', id: room.id })
  }

  function selectRack(rack) {
    const owningBuilding = buildingGroups.find((b) => b.floors.some((f) => f.rooms.some((r) => r.racks.some((rk) => rk.id === rack.id))))
    navigate(`/b/${owningBuilding?.buildingId ?? buildingId}/survey/rack?rack=${rack.id}`)
  }

  async function handleAddRoom(floorId) {
    await createRoom(floorId)
    reloadStructure()
  }

  async function handleAddRack(roomId) {
    await createRack(roomId)
    reloadStructure()
  }

  async function handleRoomMetaChange(patch) {
    if (!selectedRoomCtx) return
    const next = { ...selectedRoomMeta, ...patch }
    setSelectedRoomMeta(next)
    await updateRoomMeta(selectedRoomCtx.room.id, patch)
  }

  async function handleConnectionChange(patch) {
    if (!selectedConnection) return
    const next = { ...selectedConnection, ...patch }
    setSelectedConnection(next)
    await updateConnection(selectedConnection.id, patch)
  }

  async function handleSelectFinding(finding) {
    if (!finding.objectId) return
    if (finding.objectType === 'room' || finding.objectType === 'rack') {
      const roomId = finding.objectType === 'room' ? finding.objectId : null
      if (roomId) await selectRoom({ id: roomId })
    } else if (finding.objectType === 'connection') {
      const ctx = await getConnectionContext(finding.objectId)
      setSelectedConnection(ctx)
      setSelectedObjectRef({ type: 'connection', id: finding.objectId })
      setFindings(null)
    }
  }

  function handleDragStart(event) {
    setActiveDragData(event.active.data.current)
  }

  async function handleDragEnd(event) {
    const data = activeDragData
    setActiveDragData(null)
    const overId = event.over?.id
    if (!data || !overId || data.kind !== 'library-item') return

    if (data.item.kind === 'room' && overId.startsWith('site-floor:')) {
      await createRoom(overId.replace('site-floor:', ''))
      reloadStructure()
    } else if (data.item.kind === 'rack' && overId.startsWith('site-room:')) {
      await createRack(overId.replace('site-room:', ''))
      reloadStructure()
    }
  }

  const breadcrumbItems = useMemo(() => {
    if (mode === 'campus') {
      return [{ label: project.name }, { label: country.code }, { label: sal.code }, { label: campus.code }, { label: 'Survey' }]
    }
    return building ? [...building.breadcrumb, { label: 'Survey' }] : []
  }, [mode, building])

  const headerLabel =
    mode === 'campus' ? `SAL ${sal.code} · Campus ${campus.code}` : building ? `${organisation.name} · ${building.name}` : ''

  if ((mode === 'building' && !building) || !buildingGroups) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const stepperLinks = {
    'site-structure': mode === 'campus' ? `/b/${buildingId}/survey` : undefined,
    'rack-survey': buildingGroups[0]?.floors.flatMap((f) => f.rooms).flatMap((r) => r.racks)[0]
      ? `/b/${buildingId}/survey/rack?rack=${buildingGroups[0].floors.flatMap((f) => f.rooms).flatMap((r) => r.racks)[0].id}`
      : undefined,
    'building-connections': mode === 'building' ? `/b/${buildingId}/survey/campus` : undefined,
    validation: `?panel=validation`,
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
        <Breadcrumb items={breadcrumbItems} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">
              Physical Site Survey — {mode === 'campus' ? 'Multi-Building Structure' : 'Building & Room Structure'}
            </h1>
            <p className="text-sm text-text-secondary">{headerLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <FloorPlanUpload disabled={permissions.readOnly} />
            <button
              type="button"
              onClick={runValidation}
              className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
            >
              <ClipboardCheck size={14} strokeWidth={2} />
              Validate structure
            </button>
          </div>
        </div>

        {mode === 'building' && (
          <button
            type="button"
            onClick={() => navigate(`/b/${buildingId}/survey/campus`)}
            className="text-xs font-medium text-brand hover:underline"
          >
            View all buildings in campus {campus.code} →
          </button>
        )}

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <SiteStructureBoard
              buildingGroups={buildingGroups}
              editable={!permissions.readOnly}
              connectMode={connectMode}
              connectFirstRoomId={connectFirstRoomId}
              selectedObjectRef={selectedObjectRef}
              onSelectRoom={selectRoom}
              onAddRack={handleAddRack}
              onSelectRack={selectRack}
              onAddRoom={handleAddRoom}
            />
          </div>

          <div className="w-full shrink-0 space-y-4 xl:w-72">
            {!permissions.readOnly && (
              <SiteObjectLibrary
                permissions={{ canMoveDevices: permissions.canEdit }}
                connectMode={connectMode}
                onToggleConnectMode={() => {
                  setConnectMode((m) => !m)
                  setConnectFirstRoomId(null)
                }}
              />
            )}
            {permissions.readOnly && (
              <div className="rounded-lg border border-dashed border-border bg-surface-muted p-3 text-center text-xs text-text-secondary">
                Viewing as {role.replace('_', ' ')} — this role sees the structure read-only.
              </div>
            )}

            {findings ? (
              <ValidationResultsPanel findings={findings} onSelectFinding={handleSelectFinding} />
            ) : selectedObjectRef?.type === 'room' && selectedRoomCtx ? (
              <RoomDetailPanel
                room={selectedRoomCtx.room}
                floor={selectedRoomCtx.floor}
                meta={selectedRoomMeta}
                onMetaChange={handleRoomMetaChange}
                disabled={permissions.readOnly}
              />
            ) : selectedObjectRef?.type === 'connection' && selectedConnection ? (
              <ConnectionDetailPanel connection={selectedConnection} onChange={handleConnectionChange} disabled={permissions.readOnly} />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-secondary">
                Select a room or building connection to see its details.
              </div>
            )}
          </div>
        </div>

        {/* Site Structure covers both the single- and multi-building views —
            matches the render, where the stepper's active dot stays on
            "Site Structure" on both pages 3 and 4. */}
        <SurveyStepper active="site-structure" links={stepperLinks} />
      </div>

      <DragOverlay dropAnimation={null}>
        <DragPreviewCard dragData={activeDragData} />
      </DragOverlay>
    </DndContext>
  )
}
