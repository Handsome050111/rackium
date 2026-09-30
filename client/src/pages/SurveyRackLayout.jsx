import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Trash2, ClipboardCheck, Ruler, Zap, Cable, Accessibility } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import RackElevation, { parseDroppableId } from '../components/RackElevation.jsx'
import RackObjectLibrary from '../components/RackObjectLibrary.jsx'
import RackFactCard from '../components/RackFactCard.jsx'
import RackReadinessCard from '../components/RackReadinessCard.jsx'
import DeviceIdentityPanel from '../components/DeviceIdentityPanel.jsx'
import EvidenceUpload from '../components/EvidenceUpload.jsx'
import AutosaveIndicator from '../components/AutosaveIndicator.jsx'
import EditorToolbar from '../components/EditorToolbar.jsx'
import { getBuilding } from '../api/index.js'
import { getRackSurveyContext, autosaveRackSurvey, saveRackSurveyVersion, getDeviceSerial, setDeviceSerial, getAllProjectSerials } from '../api/survey.js'
import { useUndoableState } from '../lib/useUndoableState.js'
import { useRole } from '../lib/RoleContext.jsx'
import { getRackPermissions } from '../lib/permissions.js'
import { findConflicts, computeFreeRU } from '../lib/rackValidation.js'
import { computeReadiness } from '../lib/rackReadiness.js'

const AUTOSAVE_DELAY_MS = 800

function nextPlacementId() {
  return `placed-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

export default function SurveyRackLayout() {
  const { buildingId } = useParams()
  const [searchParams] = useSearchParams()
  const rackId = searchParams.get('rack')
  const { role } = useRole()
  const permissions = getRackPermissions(role)

  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [selectedPlacementId, setSelectedPlacementId] = useState(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [activeDragData, setActiveDragData] = useState(null)
  const [autosaveStatus, setAutosaveStatus] = useState('saved')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [serial, setSerial] = useState('')
  const [allSerials, setAllSerials] = useState([])

  const placements = useUndoableState([])
  const autosaveTimer = useRef(null)
  const loadedSnapshot = useRef(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    if (!rackId) return
    let active = true
    getRackSurveyContext(rackId).then((ctx) => {
      if (!active) return
      setContext(ctx)
      placements.reset(ctx.placements)
      // Reference identity, not a timing-sensitive flag: the autosave
      // effect below skips whenever placements.value is still this exact
      // array, so the load itself never triggers a spurious autosave.
      loadedSnapshot.current = ctx.placements
      setLastSavedAt(ctx.revisionMeta.lastSavedAt)
      setAutosaveStatus('saved')
      setSelectedPlacementId(null)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId])

  // Autosave: persists the current placements, but never resets undo
  // history — only an explicit Save Version does that (brief v2.3 §6.10).
  useEffect(() => {
    if (!rackId || placements.value === loadedSnapshot.current) return
    setAutosaveStatus('unsaved')
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(async () => {
      setAutosaveStatus('saving')
      const result = await autosaveRackSurvey(rackId, placements.value)
      setLastSavedAt(result.lastAutosavedAt)
      setAutosaveStatus('saved')
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(autosaveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placements.value])

  useEffect(() => {
    if (!selectedPlacementId) return
    getDeviceSerial(selectedPlacementId).then(setSerial)
  }, [selectedPlacementId])

  useEffect(() => {
    getAllProjectSerials().then(setAllSerials)
  }, [serial])

  const selectedPlacement = useMemo(
    () => placements.value.find((p) => p.id === selectedPlacementId) ?? null,
    [placements.value, selectedPlacementId]
  )

  const permissionFor = useCallback(
    (placement) => {
      if (placement.kind === 'reserved') return permissions.canReserve
      if (placement.kind === 'blocked') return permissions.canBlock
      return permissions.canMoveDevices
    },
    [permissions]
  )

  function buildCandidateFromDrag(data, target) {
    if (!data || !target) return null
    if (data.kind === 'library-item') {
      const item = data.item
      return {
        id: 'new',
        ru: target.type === 'rail' ? 0 : target.ru,
        heightU: item.heightU,
        face: target.face,
        fullDepth: Boolean(item.fullDepth),
        mounting: item.mounting ?? 'rack',
        railSide: target.side,
        kind: item.kind ?? 'device',
        category: item.category,
        label: item.label,
        sublabel: item.mounting === '0U' ? '0U' : `${item.heightU}U`,
      }
    }
    const existing = data.placement
    return {
      ...existing,
      ru: target.type === 'rail' ? 0 : target.ru,
      face: target.face,
      railSide: target.side,
    }
  }

  function handleDragStart(event) {
    setActiveDragData(event.active.data.current)
  }

  function handleDragOver(event) {
    const target = parseDroppableId(event.over?.id)
    if (!target || !activeDragData) {
      setDragPreview(null)
      return
    }
    const candidate = buildCandidateFromDrag(activeDragData, target)
    if (!candidate) {
      setDragPreview(null)
      return
    }
    const excludeId = activeDragData.kind === 'move-placement' ? activeDragData.placement.id : null
    const conflicts = findConflicts(candidate, placements.value, context.rack.heightU, excludeId)
    const permitted = permissionFor(candidate)
    setDragPreview({
      face: target.face,
      ruStart: candidate.ru,
      ruEnd: candidate.ru + candidate.heightU - 1,
      valid: conflicts.length === 0 && permitted && target.type === 'ru',
    })
  }

  function handleDragEnd(event) {
    const target = parseDroppableId(event.over?.id)
    const data = activeDragData
    setDragPreview(null)
    setActiveDragData(null)
    if (!target || !data) return

    const candidate = buildCandidateFromDrag(data, target)
    if (!candidate) return
    if (!permissionFor(candidate)) return

    if (target.type === 'ru') {
      const excludeId = data.kind === 'move-placement' ? data.placement.id : null
      const conflicts = findConflicts(candidate, placements.value, context.rack.heightU, excludeId)
      if (conflicts.length > 0) return
    }

    if (data.kind === 'library-item') {
      const newPlacement = { ...candidate, id: nextPlacementId() }
      placements.setValue((list) => [...list, newPlacement])
      setSelectedPlacementId(newPlacement.id)
    } else {
      placements.setValue((list) => list.map((p) => (p.id === data.placement.id ? { ...p, ...candidate, id: p.id } : p)))
    }
  }

  function handleDelete() {
    if (!selectedPlacement || !permissionFor(selectedPlacement)) return
    placements.setValue((list) => list.filter((p) => p.id !== selectedPlacement.id))
    setSelectedPlacementId(null)
  }

  async function handleSerialChange(value) {
    setSerial(value)
    if (selectedPlacementId) await setDeviceSerial(selectedPlacementId, value)
  }

  async function handleSaveVersion() {
    if (!rackId) return
    await autosaveRackSurvey(rackId, placements.value)
    const meta = await saveRackSurveyVersion(rackId)
    setLastSavedAt(meta.lastSavedAt)
    setAutosaveStatus('saved')
    // Explicit "Save version" is the only thing allowed to clear undo/redo
    // history (brief v2.3 §6.10) — autosave above never does this.
    loadedSnapshot.current = placements.value
    placements.reset(placements.value)
  }

  if (!building) return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  if (!rackId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-text-secondary">
          <p className="text-sm">No rack selected. Open a rack survey from the Survey landing page.</p>
        </div>
      </div>
    )
  }
  if (!context) return <div className="p-6 text-sm text-text-secondary">Loading rack…</div>

  const freeRuByFace = {
    front: computeFreeRU(placements.value, context.rack.heightU, 'front'),
    rear: computeFreeRU(placements.value, context.rack.heightU, 'rear'),
  }
  const readiness = computeReadiness({ placements: placements.value, rackHeightU: context.rack.heightU, meta: context.meta })
  // Rack survey % = share of readiness checks currently passing — a
  // calculated figure, never hand-typed.
  const surveyPercent = Math.round((readiness.checks.filter((c) => c.pass).length / readiness.checks.length) * 100)

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <Breadcrumb
          items={[
            ...building.breadcrumb,
            { label: context.floor.name },
            { label: context.room.code },
            { label: context.rack.code },
            { label: 'Survey' },
          ]}
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">Physical Site Survey — Rack Layout &amp; Installation Readiness</h1>
            <p className="text-sm text-text-secondary">
              Capture the existing rack configuration, dimensions, power, accessibility and readiness for planned FMO
              equipment.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-surface-muted px-3 py-1.5 text-xs font-semibold text-text">
              Rack survey {surveyPercent}%
            </span>
            <AutosaveIndicator status={autosaveStatus} lastSavedAt={lastSavedAt} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditorToolbar onUndo={placements.undo} canUndo={placements.canUndo} onRedo={placements.redo} canRedo={placements.canRedo} />
          <div className="flex items-center gap-2">
            {selectedPlacement && permissionFor(selectedPlacement) && (
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-touch items-center gap-1.5 rounded-lg border border-status-red/30 px-3 text-xs font-medium text-status-red hover:bg-status-red/5 sm:h-9"
              >
                <Trash2 size={14} strokeWidth={2} />
                Delete {selectedPlacement.label}
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveVersion}
              disabled={permissions.readOnly}
              className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              <ClipboardCheck size={14} strokeWidth={2} />
              Save Version
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 justify-center">
            <RackElevation
              rack={context.rack}
              placements={placements.value}
              mode={permissions.readOnly ? 'view' : 'edit'}
              selectedPlacementId={selectedPlacementId}
              onSelectPlacement={(p) => setSelectedPlacementId(p.id)}
              permissionFor={permissionFor}
              dropPreview={dragPreview}
              freeRuByFace={freeRuByFace}
            />
          </div>
          {!permissions.readOnly && <RackObjectLibrary permissions={permissions} />}
        </div>

        {permissions.readOnly && (
          <div className="rounded-lg border border-dashed border-border bg-surface-muted p-3 text-center text-xs text-text-secondary">
            Viewing as {role.replace('_', ' ')} — this role sees the rack read-only.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RackFactCard
            icon={Ruler}
            title="Rack details"
            rows={[
              ['Type', context.meta.details.type],
              ['Standard', context.meta.details.standard],
              ['Height', `${context.rack.heightU}RU`],
              ['External depth', `${context.meta.details.externalDepthMm} mm`],
              ['Usable depth', `${context.meta.details.usableDepthMm} mm`],
              ['Condition', context.meta.details.condition],
            ]}
          />
          <RackFactCard
            icon={Zap}
            title="Mounting & power"
            rows={[
              ['Cage nuts / screws', context.meta.mountingPower.cageNutType],
              ['Available sets', context.meta.mountingPower.availableCageNutSets],
              ['Mounting rails', context.meta.mountingPower.mountingRails],
              ['PDU-A', context.meta.mountingPower.pduA ? `${context.meta.mountingPower.pduA.freeSockets}/${context.meta.mountingPower.pduA.totalSockets} free` : '—'],
              ['PDU-B', context.meta.mountingPower.pduB ? `${context.meta.mountingPower.pduB.freeSockets}/${context.meta.mountingPower.pduB.totalSockets} free` : '—'],
              ['Redundant power', context.meta.mountingPower.redundantPower],
            ]}
          />
          <RackFactCard
            icon={Cable}
            title="Cable path & management"
            rows={[
              ['Main cable entry', context.meta.cablePath.mainCableEntry],
              ['Pathway', context.meta.cablePath.pathway],
              ['Secondary entry', context.meta.cablePath.secondaryEntry],
              ['Vertical managers', context.meta.cablePath.verticalManagers],
              ['Horizontal managers', context.meta.cablePath.horizontalManagers],
            ]}
          />
          <RackFactCard
            icon={Accessibility}
            title="Accessibility"
            rows={[
              ['Front', context.meta.accessibility.front],
              ['Rear', context.meta.accessibility.rear],
              ['Left side', context.meta.accessibility.left],
              ['Right side', context.meta.accessibility.right],
              ['Front clearance', `${context.meta.accessibility.frontClearanceMm} mm`],
              ['Rear clearance', `${context.meta.accessibility.rearClearanceMm} mm`],
            ]}
          />
          <RackReadinessCard readiness={readiness} />
          <EvidenceUpload disabled={!permissions.canUploadEvidence} />
        </div>

        {selectedPlacement && selectedPlacement.kind === 'device' && (
          <DeviceIdentityPanel
            placement={selectedPlacement}
            serial={serial}
            onSerialChange={handleSerialChange}
            roomCmoList={context.roomCmoList}
            allProjectSerials={allSerials}
            disabled={!permissions.canMoveDevices}
          />
        )}

        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
          {['Site Structure', 'Room Details', 'Rack Survey', 'Existing Connectivity', 'Validation'].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${step === 'Rack Survey' ? 'bg-brand' : 'border border-border bg-surface'}`}
              />
              <span className={step === 'Rack Survey' ? 'font-semibold text-brand' : ''}>{step}</span>
              {i < 4 && <span className="mx-1 h-px w-6 bg-border" />}
            </div>
          ))}
        </div>
      </div>
    </DndContext>
  )
}
