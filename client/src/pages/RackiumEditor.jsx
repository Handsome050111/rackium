import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import Breadcrumb from '../components/Breadcrumb.jsx'
import EditorToolbar from '../components/EditorToolbar.jsx'
import RackContextPicker from '../components/RackContextPicker.jsx'
import RackElevation from '../components/RackElevation.jsx'
import PortFace from '../components/PortFace.jsx'
import PatchDetailsPanel from '../components/PatchDetailsPanel.jsx'
import ValidationPanel from '../components/ValidationPanel.jsx'
import { getBuilding } from '../api/index.js'
import { getBuildingRackTree } from '../api/site.js'
import { getRackEditorContext, suggestCableId, checkCableIdUnique, applyMapping, saveRevision } from '../api/lld.js'
import { useUndoableState } from '../lib/useUndoableState.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { computeSuggestedLength, stockLengthsFor } from '../lib/cableLength.js'
import { validateMapping, hasBlockingFailure } from '../lib/validation.js'
import { formatDateTime } from '../lib/time.js'
import { CheckCircle2, AlertTriangle, Eye } from 'lucide-react'

const EMPTY_DRAFT = {
  sourceEntityId: null,
  sourcePort: null,
  destEntityId: null,
  destPort: null,
  media: 'cat6a',
  status: 'draft',
}

function occupiedPortsFor(entityId, connections) {
  const used = new Set()
  for (const conn of connections) {
    if (conn.source.deviceId === entityId) used.add(conn.source.port)
    if (conn.dest.deviceId === entityId) used.add(conn.dest.port)
  }
  return used
}

export default function RackiumEditor() {
  const { buildingId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const rackId = searchParams.get('rack')

  const [building, setBuilding] = useState(null)
  const [tree, setTree] = useState(null)
  const [context, setContext] = useState(null)
  const [cableId, setCableId] = useState('')
  const [cableIdState, setCableIdState] = useState('unique')
  const [engineerSelectedLength, setEngineerSelectedLength] = useState(null)

  const draft = useUndoableState(EMPTY_DRAFT)
  // HLD/LLD canvas editing is view-only on phone (brief v2.3 §7.4); the
  // Rackium Editor is a mode inside LLD, so the same rule applies here.
  const isPhone = useMediaQuery('(max-width: 767px)')

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
    getBuildingRackTree().then(setTree)
  }, [buildingId])

  useEffect(() => {
    if (!rackId) return
    let active = true
    getRackEditorContext(rackId).then((ctx) => {
      if (!active) return
      setContext(ctx)
      draft.reset(EMPTY_DRAFT)
      setEngineerSelectedLength(null)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId])

  useEffect(() => {
    if (!rackId) return
    suggestCableId().then(setCableId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rackId, context?.revisionMeta.unsavedChanges])

  useEffect(() => {
    let active = true
    checkCableIdUnique(cableId).then((unique) => {
      if (!active) return
      if (cableId.trim().length === 0) setCableIdState('invalid')
      else setCableIdState(unique ? 'unique' : 'duplicate')
    })
    return () => {
      active = false
    }
  }, [cableId])

  const sourceEntity = useMemo(
    () => context?.entities.find((e) => e.id === draft.value.sourceEntityId) ?? null,
    [context, draft.value.sourceEntityId]
  )
  const destEntity = useMemo(
    () => context?.entities.find((e) => e.id === draft.value.destEntityId) ?? null,
    [context, draft.value.destEntityId]
  )

  const sourceOccupied = useMemo(
    () => (sourceEntity && context ? occupiedPortsFor(sourceEntity.id, context.connections) : new Set()),
    [sourceEntity, context]
  )
  const destOccupied = useMemo(
    () => (destEntity && context ? occupiedPortsFor(destEntity.id, context.connections) : new Set()),
    [destEntity, context]
  )

  const lengthResult = useMemo(() => {
    if (!sourceEntity || !destEntity) return null
    return computeSuggestedLength({
      source: { rackId: sourceEntity.rackId, roomId: sourceEntity.roomId, ru: sourceEntity.ru },
      dest: { rackId: destEntity.rackId, roomId: destEntity.roomId, ru: destEntity.ru },
      media: draft.value.media,
    })
  }, [sourceEntity, destEntity, draft.value.media])

  useEffect(() => {
    if (lengthResult && lengthResult.suggested != null) {
      setEngineerSelectedLength(lengthResult.suggested)
    }
  }, [lengthResult])

  const stockOptions = lengthResult ? stockLengthsFor(draft.value.media, lengthResult.situation) : []

  const readyForValidation = Boolean(sourceEntity && destEntity && draft.value.sourcePort && draft.value.destPort)

  const findings = useMemo(() => {
    if (!readyForValidation) return []
    return validateMapping({
      sourcePortFree: !sourceOccupied.has(draft.value.sourcePort),
      destPortFree: !destOccupied.has(draft.value.destPort),
      media: draft.value.media,
      sourceKind: sourceEntity.portKind(draft.value.sourcePort),
      destKind: destEntity.portKind(draft.value.destPort),
      cableId,
      existingCableIds: context.allCableIds,
      excludeCableId: null,
      lengthResult,
    })
  }, [readyForValidation, sourceOccupied, destOccupied, draft.value, sourceEntity, destEntity, cableId, context, lengthResult])

  const canApply = readyForValidation && cableIdState === 'unique' && !hasBlockingFailure(findings)

  function handleSetSource(entityId) {
    draft.setValue((d) => ({ ...d, sourceEntityId: entityId, sourcePort: null }))
  }
  function handleSetDest(entityId) {
    draft.setValue((d) => ({ ...d, destEntityId: entityId, destPort: null }))
  }
  function handleClearSource() {
    draft.setValue((d) => ({ ...d, sourceEntityId: null, sourcePort: null }))
  }
  function handleClearDest() {
    draft.setValue((d) => ({ ...d, destEntityId: null, destPort: null }))
  }
  // Click-to-cycle: first click sets source, next click (on a different
  // entity) sets destination, clicking an already-picked one clears it.
  function handleSelectPlacement(placement) {
    if (placement.id === draft.value.sourceEntityId) return handleClearSource()
    if (placement.id === draft.value.destEntityId) return handleClearDest()
    if (!draft.value.sourceEntityId) return handleSetSource(placement.id)
    if (!draft.value.destEntityId) return handleSetDest(placement.id)
  }
  function handleSelectSourcePort(portId) {
    draft.setValue((d) => ({ ...d, sourcePort: portId }))
  }
  function handleSelectDestPort(portId) {
    draft.setValue((d) => ({ ...d, destPort: portId }))
  }
  function handleMediaChange(media) {
    draft.setValue((d) => ({ ...d, media }))
  }
  function handleStatusChange(status) {
    draft.setValue((d) => ({ ...d, status }))
  }
  function handleSwap() {
    draft.setValue((d) => ({
      ...d,
      sourceEntityId: d.destEntityId,
      sourcePort: d.destPort,
      destEntityId: d.sourceEntityId,
      destPort: d.sourcePort,
    }))
  }
  function handleCancel() {
    draft.reset(EMPTY_DRAFT)
    setEngineerSelectedLength(null)
  }

  async function handleApply() {
    if (!canApply) return
    await applyMapping(rackId, {
      sourceEntityId: sourceEntity.id,
      sourcePort: draft.value.sourcePort,
      destEntityId: destEntity.id,
      destPort: draft.value.destPort,
      media: draft.value.media,
      cableId,
      engineerSelectedLength,
      suggestedLength: lengthResult?.suggested ?? null,
    })
    const ctx = await getRackEditorContext(rackId)
    setContext(ctx)
    draft.reset(EMPTY_DRAFT)
    setEngineerSelectedLength(null)
  }

  async function handleSaveRevision() {
    const meta = await saveRevision(rackId)
    setContext((prev) => (prev ? { ...prev, revisionMeta: meta } : prev))
    draft.reset(EMPTY_DRAFT)
    setEngineerSelectedLength(null)
  }

  if (!building || !tree) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  if (!rackId) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-text-secondary">
          <p className="text-sm">No rack selected. Open the Rackium Editor from a rack in LLD.</p>
        </div>
      </div>
    )
  }

  if (!context) {
    return <div className="p-6 text-sm text-text-secondary">Loading rack…</div>
  }

  const connectionTypeLabel = destEntity ? (destEntity.entityType === 'patchpanel' ? 'Patch panel' : 'Direct') : '—'

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
      <Breadcrumb
        items={[...building.breadcrumb, { label: 'LLD', id: 'lld' }, { label: 'Rackium Editor', id: 'editor' }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Rackium Editor — Port Mapping</h1>
          <p className="text-sm text-text-secondary">
            Select the installed source and destination ports within {context.room.code} / Rack {context.rack.code}.
          </p>
        </div>
        {isPhone ? (
          <span className="flex h-touch items-center gap-1.5 rounded-lg bg-surface-muted px-3 text-xs font-medium text-text-secondary">
            <Eye size={14} strokeWidth={2} />
            View-only on phone — open on tablet or desktop to edit
          </span>
        ) : (
          <EditorToolbar
            onUndo={draft.undo}
            canUndo={draft.canUndo}
            onRedo={draft.redo}
            canRedo={draft.canRedo}
            onSwap={handleSwap}
            canSwap={Boolean(sourceEntity || destEntity)}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <RackContextPicker
            buildingName={building.name}
            tree={tree}
            selectedRackId={rackId}
            onSelectRack={(id) => navigate(`/b/${buildingId}/lld/editor?rack=${id}`)}
          />
        </div>

        <div className="space-y-4">
          <RackElevation
            rack={context.rack}
            placements={context.entities}
            mode="view"
            selectionBadges={{
              ...(draft.value.sourceEntityId ? { [draft.value.sourceEntityId]: 'SRC' } : {}),
              ...(draft.value.destEntityId ? { [draft.value.destEntityId]: 'DST' } : {}),
            }}
            onSelectPlacement={isPhone ? undefined : handleSelectPlacement}
          />

          {sourceEntity && (
            <PortFace
              title={`Source · RU${sourceEntity.ru} · ${sourceEntity.label}`}
              sublabel={sourceEntity.sublabel}
              portMap={sourceEntity.portMap}
              occupiedPortIds={[...sourceOccupied]}
              selectedPortId={draft.value.sourcePort}
              onSelectPort={handleSelectSourcePort}
              disabled={isPhone}
            />
          )}

          {destEntity && (
            <PortFace
              title={`Destination · RU${destEntity.ru} · ${destEntity.label}`}
              sublabel={destEntity.sublabel}
              portMap={destEntity.portMap}
              occupiedPortIds={[...destOccupied]}
              selectedPortId={draft.value.destPort}
              onSelectPort={handleSelectDestPort}
              disabled={isPhone}
            />
          )}
        </div>

        <div className="space-y-4">
          <PatchDetailsPanel
            connectionTypeLabel={connectionTypeLabel}
            media={draft.value.media}
            onMediaChange={handleMediaChange}
            cableId={cableId}
            onCableIdChange={setCableId}
            cableIdState={cableIdState}
            status={draft.value.status}
            onStatusChange={handleStatusChange}
            disabled={isPhone}
          />

          {readyForValidation ? (
            <ValidationPanel
              findings={findings}
              engineerSelectedLength={engineerSelectedLength}
              stockOptions={stockOptions}
              onChangeEngineerSelectedLength={setEngineerSelectedLength}
              disabled={isPhone}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-secondary">
              Select a source and destination port to see NexAI validation.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isPhone}
              className="h-touch rounded-lg border border-border px-4 text-sm font-medium text-text hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:h-9"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={!canApply || isPhone}
              className="h-touch rounded-lg border border-brand px-4 text-sm font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed disabled:border-border disabled:text-status-grey sm:h-9"
            >
              Apply Mapping
            </button>
            <button
              type="button"
              onClick={handleSaveRevision}
              disabled={context.revisionMeta.unsavedChanges === 0 || isPhone}
              className="h-touch rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              Save Revision
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-text-secondary">
        <span>
          Revision {context.revisionMeta.revision} · Unsaved changes {context.revisionMeta.unsavedChanges} · Last
          saved {formatDateTime(context.revisionMeta.lastSavedAt)}
        </span>
        {hasBlockingFailure(findings) ? (
          <span className="flex items-center gap-1.5 font-medium text-status-red">
            <AlertTriangle size={14} strokeWidth={2} />
            Blocking conflicts
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-status-green">
            <CheckCircle2 size={14} strokeWidth={2} />
            No blocking conflicts
          </span>
        )}
      </div>
    </div>
  )
}
