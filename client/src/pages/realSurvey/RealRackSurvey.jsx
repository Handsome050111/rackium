import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { ArrowLeft, ClipboardCheck, Trash2 } from 'lucide-react'
import { ACTIONS, can } from '@rackium/shared/policy.js'
import { findConflicts, computeFreeRU } from '@rackium/shared/rackValidation.js'
import { computeReadiness } from '@rackium/shared/rackReadiness.js'
import RackElevation, { parseDroppableId } from '../../components/RackElevation.jsx'
import RackObjectLibrary from '../../components/RackObjectLibrary.jsx'
import DragPreviewCard from '../../components/DragPreviewCard.jsx'
import SurveyStepper from '../../components/SurveyStepper.jsx'
import RackReadinessCard from '../../components/RackReadinessCard.jsx'
import DeviceIdentityPanel from '../../components/DeviceIdentityPanel.jsx'
import EvidenceUpload from '../../components/EvidenceUpload.jsx'
import AutosaveIndicator from '../../components/AutosaveIndicator.jsx'
import EditorToolbar from '../../components/EditorToolbar.jsx'
import RackFactsForm from '../../components/survey/RackFactsForm.jsx'
import PhotoStrip from '../../components/survey/PhotoStrip.jsx'
import { surveyApi } from '../../api/surveyApi.js'
import { useUndoableState } from '../../lib/useUndoableState.js'
import { useDragSensors } from '../../lib/useDragSensors.js'
import { useProjectRoles } from '../../lib/useProjectRoles.js'
import { useRealSurveySync } from '../../lib/RealSurveySync.jsx'
import { newObjectId } from '../../lib/realOfflineQueue.js'
import { surveyPath, stepperLinksFor, toPlacementBody } from '../../lib/realSurveyModel.js'

const AUTOSAVE_DELAY_MS = 800

// Real-mode Rack Survey (brief v2.3 §5.2, M3b): existing devices by RU and
// face, reserved (Architect) and blocked (PM/Org Admin) RUs, device identity
// from the building's CMO or entered, rack facts, photos and the calculated
// readiness. Validated here for instant feedback and again on the server
// with the same shared rack rules.
export default function RealRackSurvey() {
  const { orgId, projectId, buildingId } = useParams()
  const [searchParams] = useSearchParams()
  const rackId = searchParams.get('rack')
  const { roles, readOnly, has } = useProjectRoles(orgId, projectId)
  const { isOffline } = useRealSurveySync()
  const online = !readOnly && !isOffline
  const permissions = useMemo(
    () => ({
      canMoveDevices: online && has('field_engineer'),
      canReserve: online && has('architect'),
      canBlock: online && (has('pm') || has('org_admin')),
      canEditFacts: online && can(roles, ACTIONS.EDIT_SITE_STRUCTURE),
    }),
    // roles identity changes every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [online, roles.join(',')]
  )

  const [context, setContext] = useState(null)
  const [ruStates, setRuStates] = useState([])
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [dragPreview, setDragPreview] = useState(null)
  const [activeDragData, setActiveDragData] = useState(null)
  const [autosaveStatus, setAutosaveStatus] = useState('saved')
  const devices = useUndoableState([])
  const loaded = useRef(null)
  const timer = useRef(null)
  const sensors = useDragSensors()

  const load = useCallback(async () => {
    if (!rackId) return
    try {
      const ctx = await surveyApi.rack(orgId, projectId, rackId)
      setContext(ctx)
      const own = ctx.placements.filter((p) => p.kind === 'device')
      devices.reset(own)
      loaded.current = own
      setRuStates(ctx.placements.filter((p) => p.kind !== 'device'))
      setAutosaveStatus('saved')
      setError(null)
    } catch (err) {
      setError(err.message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, projectId, rackId])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(
    async (list) => {
      setAutosaveStatus('saving')
      try {
        const ctx = await surveyApi.savePlacements(orgId, projectId, rackId, toPlacementBody(list))
        // Server-derived data (readiness, CMO list, serials); the placements stay as drawn.
        setContext(ctx)
        setAutosaveStatus('saved')
        setError(null)
        return true
      } catch (err) {
        setAutosaveStatus('unsaved')
        setError(err.message)
        return false
      }
    },
    [orgId, projectId, rackId]
  )

  // Autosave (never resets undo history — only Save Version does, §6.10).
  useEffect(() => {
    if (!context || devices.value === loaded.current) return undefined
    setAutosaveStatus('unsaved')
    clearTimeout(timer.current)
    const list = devices.value
    timer.current = setTimeout(() => save(list), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices.value])

  const all = useMemo(() => [...devices.value, ...ruStates], [devices.value, ruStates])
  const selected = all.find((p) => p.id === selectedId) ?? null

  const permissionFor = useCallback(
    (p) => (p.kind === 'reserved' ? permissions.canReserve : p.kind === 'blocked' ? permissions.canBlock : permissions.canMoveDevices),
    [permissions]
  )

  function candidateFrom(data, target) {
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
        railSide: target.side ?? null,
        kind: item.kind ?? 'device',
        category: item.category ?? null,
        label: item.label,
        sublabel: item.mounting === '0U' ? '0U' : `${item.heightU}U`,
      }
    }
    return { ...data.placement, ru: target.type === 'rail' ? 0 : target.ru, face: target.face, railSide: target.side ?? data.placement.railSide }
  }

  function handleDragOver(event) {
    const target = parseDroppableId(event.over?.id)
    const candidate = candidateFrom(activeDragData, target)
    if (!candidate || !context) return setDragPreview(null)
    const exclude = activeDragData.kind === 'move-placement' ? activeDragData.placement.id : null
    const conflicts = findConflicts(candidate, all, context.rack.heightU, exclude)
    return setDragPreview({ face: target.face, ruStart: candidate.ru, ruEnd: candidate.ru + candidate.heightU - 1, valid: conflicts.length === 0 && permissionFor(candidate) && target.type === 'ru' })
  }

  async function setRuState(candidate, previous) {
    try {
      if (previous) await surveyApi.releaseRuState(orgId, projectId, rackId, previous.ruStateId)
      const { ruState } = await surveyApi.setRuState(orgId, projectId, rackId, { ru: candidate.ru, face: candidate.fullDepth ? 'both' : candidate.face, state: candidate.kind, reason: candidate.kind === 'reserved' ? 'Reserved for FMO' : null })
      setRuStates((list) => [...list.filter((s) => s.id !== previous?.id), ruState])
      setSelectedId(ruState.id)
      setError(null)
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  function handleDragEnd(event) {
    const target = parseDroppableId(event.over?.id)
    const data = activeDragData
    setDragPreview(null)
    setActiveDragData(null)
    const candidate = candidateFrom(data, target)
    if (!candidate || !permissionFor(candidate)) return
    const exclude = data.kind === 'move-placement' ? data.placement.id : null
    if (target.type === 'ru' && findConflicts(candidate, all, context.rack.heightU, exclude).length) return
    if (candidate.kind !== 'device') {
      // RU states are saved at once (they are not part of the undo history).
      if (target.type !== 'ru') return
      setRuState(candidate, data.kind === 'move-placement' ? data.placement : null)
      return
    }
    if (data.kind === 'library-item') {
      const id = newObjectId()
      devices.setValue((list) => [...list, { ...candidate, id, deviceId: id }])
      setSelectedId(id)
    } else {
      devices.setValue((list) => list.map((p) => (p.id === data.placement.id ? { ...p, ...candidate, id: p.id } : p)))
    }
  }

  async function handleDelete() {
    if (!selected || !permissionFor(selected)) return
    if (selected.kind === 'device') devices.setValue((list) => list.filter((p) => p.id !== selected.id))
    else {
      try {
        await surveyApi.releaseRuState(orgId, projectId, rackId, selected.ruStateId)
        setRuStates((list) => list.filter((s) => s.id !== selected.id))
      } catch (err) {
        setError(err.message)
      }
    }
    setSelectedId(null)
  }

  // Typing a serial: a match with one of the building's CMO devices makes
  // this placement that device (picked from the CMO); otherwise it is an
  // entered serial, checked against the project's registry on save.
  function handleSerialChange(value) {
    const cmo = context.roomCmoList.find((c) => c.serial && c.serial.toLowerCase() === value.trim().toLowerCase())
    devices.setValue((list) =>
      list.map((p) => {
        if (p.id !== selected.id) return p
        if (cmo && !list.some((o) => o.id === cmo.deviceId)) {
          return { ...p, id: cmo.deviceId, deviceId: cmo.deviceId, fromCmo: true, serial: cmo.serial, label: cmo.expectedHostname ?? p.label, sublabel: cmo.model ?? p.sublabel, identityEdited: false }
        }
        return { ...p, serial: value, identityEdited: true }
      })
    )
    if (cmo && !devices.value.some((o) => o.id === cmo.deviceId)) setSelectedId(cmo.deviceId)
  }

  function handleMacChange(value) {
    devices.setValue((list) => list.map((p) => (p.id === selected.id ? { ...p, mac: value, identityEdited: true } : p)))
  }

  async function handleSaveVersion() {
    clearTimeout(timer.current)
    if (!(await save(devices.value))) return
    try {
      const meta = await surveyApi.saveVersion(orgId, projectId, rackId)
      setContext((c) => ({ ...c, revision: { ...c.revision, revision: meta.revision, savedAt: meta.savedAt } }))
      loaded.current = devices.value
      devices.reset(devices.value)
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveFacts(body) {
    try {
      const { meta } = await surveyApi.updateFacts(orgId, projectId, rackId, body)
      setContext((c) => ({ ...c, meta }))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }

  if (!rackId) return <div className="p-6 text-sm text-text-secondary">No rack selected. Open a rack from Site Structure.</div>
  if (error && !context) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!context) return <div className="p-6 text-sm text-text-secondary">Loading rack…</div>

  const heightU = context.rack.heightU
  const freeRuByFace = { front: computeFreeRU(all, heightU, 'front'), rear: computeFreeRU(all, heightU, 'rear') }
  // Calculated, never stored (brief §5.2): from what is drawn now and the rack facts.
  const readiness = computeReadiness({ placements: all, rackHeightU: heightU, meta: context.meta })
  const surveyPercent = Math.round((readiness.checks.filter((c) => c.pass).length / readiness.checks.length) * 100)
  const anyEditor = permissions.canMoveDevices || permissions.canReserve || permissions.canBlock
  const cmoWithSerials = context.roomCmoList.filter((c) => c.serial)

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveDragData(e.active.data.current)} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <Link to={surveyPath(orgId, projectId, buildingId)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <ArrowLeft size={14} strokeWidth={2} />
          {context.building.code} · {context.floor.name} · {context.room.code} · Rack {context.rack.code}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">Physical Site Survey — Rack Layout &amp; Installation Readiness</h1>
            <p className="text-sm text-text-secondary">Capture the existing rack configuration, dimensions, power, accessibility and readiness for planned FMO equipment.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-surface-muted px-3 py-1.5 text-xs font-semibold text-text">Rack survey {surveyPercent}%</span>
            <span className="text-xs text-text-secondary">Version {context.revision.revision}</span>
            <AutosaveIndicator status={autosaveStatus} lastSavedAt={context.revision.autosavedAt ?? context.revision.savedAt} />
          </div>
        </div>

        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <EditorToolbar onUndo={devices.undo} canUndo={devices.canUndo} onRedo={devices.redo} canRedo={devices.canRedo} />
          <div className="flex items-center gap-2">
            {selected && permissionFor(selected) && (
              <button type="button" onClick={handleDelete} className="flex h-touch items-center gap-1.5 rounded-lg border border-status-red/30 px-3 text-xs font-medium text-status-red hover:bg-status-red/5 sm:h-9">
                <Trash2 size={14} strokeWidth={2} />
                {selected.kind === 'device' ? `Remove ${selected.label}` : `Release RU ${selected.ru}`}
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveVersion}
              disabled={!permissions.canMoveDevices}
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
              placements={all}
              mode={anyEditor ? 'edit' : 'view'}
              selectedPlacementId={selectedId}
              onSelectPlacement={(p) => setSelectedId(p.id)}
              permissionFor={permissionFor}
              dropPreview={dragPreview}
              freeRuByFace={freeRuByFace}
            />
          </div>
          {anyEditor && <RackObjectLibrary permissions={permissions} />}
        </div>

        {!anyEditor && (
          <div className="rounded-lg border border-dashed border-border bg-surface-muted p-3 text-center text-xs text-text-secondary">
            {isOffline ? 'Offline — the rack layout is read-only until you reconnect.' : 'Your role sees the rack read-only.'}
          </div>
        )}

        {selected?.kind === 'device' && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <DeviceIdentityPanel
              placement={selected}
              serial={selected.serial ?? ''}
              onSerialChange={handleSerialChange}
              roomCmoList={cmoWithSerials}
              allProjectSerials={context.allProjectSerials}
              disabled={!permissions.canMoveDevices || selected.fromCmo}
            />
            <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">MAC address</span>
                <input
                  value={selected.mac ?? ''}
                  onChange={(e) => handleMacChange(e.target.value)}
                  disabled={!permissions.canMoveDevices || selected.fromCmo}
                  placeholder="e.g. 00:11:22:33:44:55"
                  aria-label="MAC address"
                  className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted"
                />
              </label>
              <p className="text-[11px] text-text-secondary">
                {selected.fromCmo ? 'Picked from the CMO inventory — its serial and MAC come from the import.' : 'Serial and MAC are checked against the project registry when the rack saves.'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <RackFactsForm meta={context.meta} editable={permissions.canEditFacts} onSave={saveFacts} />
          <RackReadinessCard readiness={readiness} />
          <EvidenceUpload>
            <PhotoStrip orgId={orgId} projectId={projectId} attachedTo={{ type: 'rack', id: rackId }} editable={online && can(roles, ACTIONS.EDIT_SITE_STRUCTURE)} label={`Rack ${context.rack.code} photo`} />
          </EvidenceUpload>
        </div>

        <SurveyStepper active="rack-survey" links={{ ...stepperLinksFor(orgId, projectId, buildingId, rackId), 'rack-survey': undefined }} />
      </div>
      <DragOverlay dropAnimation={null}>
        <DragPreviewCard dragData={activeDragData} />
      </DragOverlay>
    </DndContext>
  )
}
