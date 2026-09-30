import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { Sparkles, ShieldCheck } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import HldObjectLibrary from '../components/hld/HldObjectLibrary.jsx'
import SurveyInputsPanel from '../components/hld/SurveyInputsPanel.jsx'
import HldToolbar from '../components/hld/HldToolbar.jsx'
import EditUplinkPanel from '../components/hld/EditUplinkPanel.jsx'
import LogicalTopologyTable from '../components/hld/LogicalTopologyTable.jsx'
import HldStatusBar from '../components/hld/HldStatusBar.jsx'
import HldWorkflowControls from '../components/hld/HldWorkflowControls.jsx'
import DragPreviewCard from '../components/DragPreviewCard.jsx'
import { getBuilding, getPhaseCards } from '../api/index.js'
import {
  getHldContext,
  getSurveyInputsSummary,
  addDeviceFromLibrary,
  createOrUpdateUplink,
  deleteUplink,
  validateUplinkDraft,
  generateHld,
  submitForApproval,
  approveHld,
  requestHldChanges,
} from '../api/hld.js'
import { getLogicalTopology } from '../mock/logicalTopology.js'
import { useDragSensors } from '../lib/useDragSensors.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { useRole } from '../lib/RoleContext.jsx'

const EMPTY_DRAFT = {
  sourceDeviceId: null,
  sourcePort: null,
  destDeviceId: null,
  destPort: null,
  media: 'os2',
  speed: '10G',
  sourceSfp: null,
  destSfp: null,
  usePatchPanel: false,
}

export default function Hld() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const isPhone = useMediaQuery('(max-width: 767px)')

  const [building, setBuilding] = useState(null)
  const [hldStatus, setHldStatus] = useState(null)
  const [context, setContext] = useState(null)
  const [surveySummary, setSurveySummary] = useState(null)
  const [tab, setTab] = useState('physical')

  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [editingConnectionId, setEditingConnectionId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [wizardStep, setWizardStep] = useState(1)
  const [validation, setValidation] = useState(null)
  const [activeDragData, setActiveDragData] = useState(null)

  const sensors = useDragSensors()
  const flowInstanceRef = useRef(null)
  const canvasWrapperRef = useRef(null)
  const [history, setHistory] = useState({ actions: [], index: -1 })

  const reload = useCallback(() => {
    if (!buildingId) return
    Promise.all([getHldContext(buildingId), getSurveyInputsSummary(buildingId), getPhaseCards(buildingId)]).then(
      ([ctx, summary, cards]) => {
        setContext(ctx)
        setSurveySummary(summary)
        setHldStatus(cards.find((c) => c.id === 'hld')?.status ?? 'not_started')
      }
    )
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  function pushAction(action) {
    setHistory((h) => ({ actions: [...h.actions.slice(0, h.index + 1), action], index: h.index + 1 }))
  }

  async function undo() {
    if (history.index < 0) return
    await history.actions[history.index].revert()
    setHistory((h) => ({ ...h, index: h.index - 1 }))
    reload()
  }

  async function redo() {
    if (history.index >= history.actions.length - 1) return
    await history.actions[history.index + 1].apply()
    setHistory((h) => ({ ...h, index: h.index + 1 }))
    reload()
  }

  const devicesForWizard = useMemo(() => context?.devices ?? [], [context])

  function openCreateUplink(sourceDeviceId) {
    setEditingConnectionId(null)
    setDraft({ ...EMPTY_DRAFT, sourceDeviceId })
    setWizardStep(sourceDeviceId ? 2 : 1)
    setValidation(null)
  }

  function handleSelectDevice(deviceId) {
    setSelectedDeviceId(deviceId)
    if (draft && wizardStep === 1 && !draft.destDeviceId && draft.sourceDeviceId && draft.sourceDeviceId !== deviceId) {
      setDraft((d) => ({ ...d, destDeviceId: deviceId }))
    }
  }

  async function handleRunValidation() {
    const result = await validateUplinkDraft(draft)
    setValidation(result)
  }

  async function handleApplyUplink() {
    const snapshot = { ...draft, estimatedLengthM: validation?.estimatedLengthM ?? null }
    const connId = editingConnectionId
    const action = {
      apply: () => createOrUpdateUplink(connId, snapshot),
      revert: connId ? () => createOrUpdateUplink(connId, snapshot) : () => deleteUplink(connId ?? snapshot._createdId),
    }
    const record = await createOrUpdateUplink(connId, snapshot)
    action.revert = connId ? action.revert : () => deleteUplink(record.id)
    pushAction(action)
    setDraft(null)
    setValidation(null)
    reload()
  }

  function handleCancelWizard() {
    setDraft(null)
    setValidation(null)
    setEditingConnectionId(null)
  }

  async function handleDeleteSelected() {
    if (!selectedDeviceId) return
    // Deleting a device isn't modeled (would orphan connections) — Delete
    // here targets the currently-open uplink draft/edit instead.
    if (editingConnectionId) {
      const removed = context.connections.find((c) => c.id === editingConnectionId)
      await deleteUplink(editingConnectionId)
      pushAction({ apply: () => deleteUplink(editingConnectionId), revert: () => createOrUpdateUplink(editingConnectionId, removed) })
      setEditingConnectionId(null)
      setDraft(null)
      reload()
    }
  }

  async function handleGenerateHld() {
    const created = await generateHld(buildingId)
    pushAction({
      apply: async () => {},
      revert: async () => {
        for (const c of created.uplinks) await deleteUplink(c.id)
        // Devices created by Generate HLD aren't removable via the store
        // API yet (no removeDevice) — undo restores connections; the
        // generated devices stay, matching "nothing re-typed" rather than
        // silently vanishing equipment.
      },
    })
    reload()
  }

  async function handleSubmit() {
    await submitForApproval(buildingId)
    reload()
  }
  async function handleApprove() {
    await approveHld(buildingId)
    reload()
  }
  async function handleRequestChanges() {
    await requestHldChanges(buildingId)
    reload()
  }

  // --- Drag from library onto canvas (touch-safe via dnd-kit, not native HTML5 DnD) ---
  function handleDragStart(event) {
    setActiveDragData(event.active.data.current)
  }

  async function handleDragEnd(event) {
    const data = activeDragData
    setActiveDragData(null)
    if (!data || data.kind !== 'hld-library-item' || !flowInstanceRef.current || !canvasWrapperRef.current) return

    const activatorEvent = event.activatorEvent
    const clientX = (activatorEvent.clientX ?? activatorEvent.touches?.[0]?.clientX ?? 0) + event.delta.x
    const clientY = (activatorEvent.clientY ?? activatorEvent.touches?.[0]?.clientY ?? 0) + event.delta.y
    const flowPoint = flowInstanceRef.current.screenToFlowPosition({ x: clientX, y: clientY })

    const targetRoom = flow.roomNodes.find(
      (r) => flowPoint.x >= r.x && flowPoint.x <= r.x + r.width && flowPoint.y >= r.y && flowPoint.y <= r.y + r.height
    )
    if (!targetRoom) return

    if (data.item.role) {
      const floorToken = context.floors.find((f) => f.id === context.rooms.find((r) => r.id === targetRoom.roomId)?.floorId)?.token
      const device = await addDeviceFromLibrary({ role: data.item.role, roomId: targetRoom.roomId, floorToken, model: data.item.model })
      pushAction({ apply: async () => {}, revert: async () => {} })
      reload()
      setSelectedDeviceId(device.id)
    }
    // Room/Rack reference items: canvas already shows every surveyed room —
    // nothing missing to add back for this dataset.
  }

  if (!building || !context || !surveySummary || !hldStatus) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const flow = buildHldFlow({
    floors: context.floors,
    rooms: context.rooms,
    devices: context.devices,
    connections: context.connections,
    connectionFindings: context.connectionFindings,
    selectedDeviceId,
    onSelectDevice: handleSelectDevice,
  })

  const logical = getLogicalTopology(buildingId)
  const canUndo = history.index >= 0
  const canRedo = history.index < history.actions.length - 1
  const viewOnly = isPhone

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
        <Breadcrumb items={[...building.breadcrumb, { label: 'HLD' }]} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">NexAI-Suggested HLD — {building.name}</h1>
            <p className="text-sm text-text-secondary">Generated from validated physical survey data · Network Architect review required</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleGenerateHld}
              disabled={viewOnly}
              className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              <Sparkles size={14} strokeWidth={2} />
              Generate HLD
            </button>
          </div>
        </div>

        <HldWorkflowControls status={hldStatus} role={role} onSubmit={handleSubmit} onApprove={handleApprove} onRequestChanges={handleRequestChanges} />

        <div className="flex gap-1 border-b border-border">
          {[
            { id: 'physical', label: 'Physical topology' },
            { id: 'logical', label: 'Logical topology' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`h-touch px-3 text-sm font-medium sm:h-9 ${
                tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'physical' ? (
          <>
            {!viewOnly && (
              <HldToolbar
                mode={draft ? 'create-uplink' : 'select'}
                onSelectTool={(id) => id === 'create-uplink' && openCreateUplink(selectedDeviceId)}
                onUndo={undo}
                canUndo={canUndo}
                onRedo={redo}
                canRedo={canRedo}
                onDelete={handleDeleteSelected}
                canDelete={Boolean(editingConnectionId)}
              />
            )}

            <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
              <SurveyInputsPanel buildingId={buildingId} summary={surveySummary} />

              <div ref={canvasWrapperRef} className="min-w-0 flex-1">
                <ReactFlowProvider>
                  <HldCanvas flow={flow} onInit={(inst) => (flowInstanceRef.current = inst)} viewOnly={viewOnly} />
                </ReactFlowProvider>
              </div>

              <div className="w-full shrink-0 space-y-4 xl:w-80">
                {!viewOnly && <HldObjectLibrary enabled />}
                {draft ? (
                  <EditUplinkPanel
                    step={wizardStep}
                    onStepChange={setWizardStep}
                    draft={draft}
                    onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
                    devices={devicesForWizard}
                    validation={validation}
                    onValidate={handleRunValidation}
                    onApply={handleApplyUplink}
                    onCancel={handleCancelWizard}
                    disabled={viewOnly}
                  />
                ) : (
                  !viewOnly && (
                    <button
                      type="button"
                      onClick={() => openCreateUplink(selectedDeviceId)}
                      className="flex h-touch w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs font-medium text-text-secondary hover:border-brand hover:text-brand sm:h-10"
                    >
                      <ShieldCheck size={14} strokeWidth={2} />
                      {selectedDeviceId ? 'Create uplink from selected device' : 'Select a device, then create an uplink'}
                    </button>
                  )
                )}
              </div>
            </div>

            <HldStatusBar
              surveyLinkedObjectCount={context.surveyLinkedObjectCount}
              cmo={surveySummary.cmo}
              openDesignQuestions={context.openDesignQuestions}
              blockedLinkCount={context.blockedLinkCount}
            />
          </>
        ) : (
          <LogicalTopologyTable vlans={logical.vlans} />
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        <DragPreviewCard dragData={activeDragData?.kind === 'hld-library-item' ? { kind: 'library-item', item: activeDragData.item } : null} />
      </DragOverlay>
    </DndContext>
  )
}
