import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { ArrowLeft, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import HldObjectLibrary from '../components/hld/HldObjectLibrary.jsx'
import SurveyInputsPanel from '../components/hld/SurveyInputsPanel.jsx'
import HldToolbar from '../components/hld/HldToolbar.jsx'
import EditUplinkPanel from '../components/hld/EditUplinkPanel.jsx'
import HldStatusBar from '../components/hld/HldStatusBar.jsx'
import HldWorkflowControls from '../components/hld/HldWorkflowControls.jsx'
import HldValidationPanel from '../components/hld/HldValidationPanel.jsx'
import HldDeviceDetails from '../components/hld/HldDeviceDetails.jsx'
import DragPreviewCard from '../components/DragPreviewCard.jsx'
import { hldApi, draftToUplinkBody, uplinkToDraft, libraryCategories, connectionStatus } from '../api/hldApi.js'
import { useDragSensors } from '../lib/useDragSensors.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'
import { useAuth } from '../lib/AuthContext.jsx'

const EMPTY_DRAFT = { sourceDeviceId: null, sourcePort: null, destDeviceId: null, destPort: null, media: 'os2', speed: '10G', sourceSfp: null, destSfp: null, usePatchPanel: false }

// Real-mode HLD (brief v2.3 §5.3, §6.8; M4a): the prototype's canvas,
// library, toolbar, Edit Uplink wizard and workflow on the backend. Every
// design change is sent with the revision this screen loaded; a stale one is
// refused and the screen offers to reload (brief §6.10).
export default function RealHld() {
  const { orgId, projectId, buildingId } = useParams()
  const { user } = useAuth()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const isPhone = useMediaQuery('(max-width: 767px)')
  const [view, setView] = useState(null)
  const [library, setLibrary] = useState(null)
  const [catalogueModels, setCatalogueModels] = useState({})
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(null)
  const [preset, setPreset] = useState('M')
  const [variant, setVariant] = useState(null) // null = the size's default
  const [mode, setMode] = useState('select')
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [wizardStep, setWizardStep] = useState(1)
  const [check, setCheck] = useState(null)
  const [validation, setValidation] = useState(null)
  const [showValidation, setShowValidation] = useState(false)
  const [activeDragData, setActiveDragData] = useState(null)
  const [history, setHistory] = useState({ actions: [], index: -1 })
  const flowInstanceRef = useRef(null)
  const sensors = useDragSensors()

  const reload = useCallback(async () => {
    try {
      const [v, val] = await Promise.all([hldApi.view(orgId, projectId, buildingId), hldApi.validate(orgId, projectId, buildingId)])
      setView(v)
      setValidation(val)
      setError(null)
      setStale(null)
      if (v.design.preset) setPreset(v.design.preset)
      if (v.design.variant) setVariant(v.design.variant)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])

  useEffect(() => {
    reload()
    hldApi
      .library(orgId, projectId)
      .then((lib) => {
        setLibrary(lib)
        setCatalogueModels(Object.fromEntries(lib.roles.map((r) => [r.role, r.models])))
      })
      .catch(() => {})
  }, [reload, orgId, projectId])

  const canEdit = !readOnly && has('architect') && !isPhone
  const latest = view?.approvals?.[0] ?? null
  const ownSubmission = latest?.status === 'pending' && latest.submittedById === user?.id
  const canReview = !readOnly && (has('pm') || has('reviewer')) && !ownSubmission
  const locked = view?.design.state === 'awaiting_approval'
  const editable = canEdit && !locked

  // One design write: sends the loaded revision; stale → offer reload.
  async function write(fn, { record } = {}) {
    try {
      const result = await fn(view.design.revision)
      if (record) setHistory((h) => ({ actions: [...h.actions.slice(0, h.index + 1), record(result)], index: h.index + 1 }))
      await reload()
      return result
    } catch (err) {
      if (err.code === 'stale_revision') setStale(err.message)
      else setError(err.message)
      return null
    }
  }
  // Operations that cannot be reversed cleanly (Generate, device delete) clear Undo.
  const clearHistory = () => setHistory({ actions: [], index: -1 })

  async function undo() {
    const action = history.actions[history.index]
    if (!action) return
    if (await write((rev) => action.revert(rev))) setHistory((h) => ({ ...h, index: h.index - 1 }))
  }
  async function redo() {
    const action = history.actions[history.index + 1]
    if (!action) return
    const result = await write((rev) => action.apply(rev))
    if (result) setHistory((h) => ({ ...h, index: h.index + 1 }))
  }

  const devices = useMemo(() => view?.devices ?? [], [view])
  const connections = useMemo(() => view?.connections ?? [], [view])
  const findingsByConn = useMemo(() => connectionStatus(validation?.findings), [validation])

  function openCreate(sourceDeviceId) {
    setSelectedConnectionId(null)
    setDraft({ ...EMPTY_DRAFT, sourceDeviceId: sourceDeviceId ?? null })
    setWizardStep(1)
    setCheck(null)
    setShowValidation(false)
    setMode('create-uplink')
  }
  function openEdit(connId, step = 1) {
    const conn = connections.find((c) => c.id === connId)
    if (!conn) return
    setSelectedConnectionId(connId)
    setSelectedDeviceId(null)
    setDraft(uplinkToDraft(conn))
    setWizardStep(step)
    setCheck(null)
    setShowValidation(false)
  }

  function handleSelectDevice(deviceId) {
    if (draft && !selectedConnectionId && wizardStep === 1 && draft.sourceDeviceId && !draft.destDeviceId && draft.sourceDeviceId !== deviceId) {
      setDraft((d) => ({ ...d, destDeviceId: deviceId }))
      return
    }
    if (draft && !draft.sourceDeviceId && wizardStep === 1) {
      setDraft((d) => ({ ...d, sourceDeviceId: deviceId }))
      return
    }
    setSelectedDeviceId(deviceId)
    setSelectedConnectionId(null)
    setDraft(null)
    setShowValidation(false)
  }

  async function runCheck() {
    try {
      const res = await hldApi.checkUplink(orgId, projectId, { buildingId, connectionId: selectedConnectionId ?? undefined, ...draftToUplinkBody(draft) })
      setCheck({ findings: res.checks, blocked: res.blocked, estimatedLengthM: res.length?.lengthM ?? null })
    } catch (err) {
      setError(err.message)
    }
  }

  async function applyUplink() {
    const body = draftToUplinkBody(draft)
    if (selectedConnectionId) {
      const before = connections.find((c) => c.id === selectedConnectionId)
      const id = selectedConnectionId
      const prev = { ...draftToUplinkBody(uplinkToDraft(before)) }
      await write((rev) => hldApi.updateUplink(orgId, projectId, id, { ...body, baseRevision: rev }), {
        record: () => ({ apply: (rev) => hldApi.updateUplink(orgId, projectId, id, { ...body, baseRevision: rev }), revert: (rev) => hldApi.updateUplink(orgId, projectId, id, { ...prev, baseRevision: rev }) }),
      })
    } else {
      let createdId = null
      const created = await write((rev) => hldApi.createUplink(orgId, projectId, { buildingId, ...body, baseRevision: rev }), {
        record: (res) => {
          createdId = res.uplink.id
          return {
            apply: async (rev) => {
              const again = await hldApi.createUplink(orgId, projectId, { buildingId, ...body, baseRevision: rev })
              createdId = again.uplink.id
              return again
            },
            revert: (rev) => hldApi.deleteUplink(orgId, projectId, createdId, rev),
          }
        },
      })
      if (created) setSelectedConnectionId(null)
    }
    setDraft(null)
    setCheck(null)
    setMode('select')
  }

  async function deleteSelected() {
    if (selectedConnectionId) {
      const conn = connections.find((c) => c.id === selectedConnectionId)
      const body = draftToUplinkBody(uplinkToDraft(conn))
      let currentId = conn.id
      await write((rev) => hldApi.deleteUplink(orgId, projectId, currentId, rev), {
        record: () => ({
          // A deleted uplink's cable ID is retired (never reused), so undo recreates it without one.
          apply: (rev) => hldApi.deleteUplink(orgId, projectId, currentId, rev),
          revert: async (rev) => {
            const again = await hldApi.createUplink(orgId, projectId, { buildingId, ...body, baseRevision: rev })
            currentId = again.uplink.id
            return again
          },
        }),
      })
      setSelectedConnectionId(null)
      setDraft(null)
    } else if (selectedDeviceId) {
      if (await write((rev) => hldApi.deleteDevice(orgId, projectId, selectedDeviceId, rev))) clearHistory()
      setSelectedDeviceId(null)
    }
  }

  async function generate() {
    const res = await write((rev) => hldApi.generate(orgId, projectId, { buildingId, preset, variant: chosenVariant, baseRevision: rev }))
    if (res) clearHistory()
  }

  async function runValidation() {
    try {
      setValidation(await hldApi.validate(orgId, projectId, buildingId))
      setShowValidation(true)
      setDraft(null)
    } catch (err) {
      setError(err.message)
    }
  }

  function selectTool(id) {
    if (id === 'validate') return runValidation()
    if (id === 'create-uplink') return openCreate(selectedDeviceId)
    if (id === 'change-medium') {
      if (selectedConnectionId) openEdit(selectedConnectionId, 3)
      else setError('Select an uplink on the canvas first, then Change Medium')
      return undefined
    }
    setMode(id)
    return undefined
  }

  function handleSelectFinding(f) {
    if (f.objectType === 'connection') openEdit(f.objectId)
    else if (f.objectType === 'device') handleSelectDevice(f.objectId)
  }

  async function moveDevice(deviceId, position) {
    try {
      await hldApi.moveDevice(orgId, projectId, deviceId, { x: Math.round(position.x), y: Math.round(position.y) })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDragEnd(event) {
    const data = activeDragData
    setActiveDragData(null)
    if (!data || data.kind !== 'hld-library-item' || !data.item.role || !flowInstanceRef.current || !editable) return
    const a = event.activatorEvent
    const point = flowInstanceRef.current.screenToFlowPosition({ x: (a.clientX ?? a.touches?.[0]?.clientX ?? 0) + event.delta.x, y: (a.clientY ?? a.touches?.[0]?.clientY ?? 0) + event.delta.y })
    const room = flow.roomNodes.find((r) => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height)
    if (!room) return
    let createdId = null
    const res = await write((rev) => hldApi.addDevice(orgId, projectId, { buildingId, role: data.item.role, roomId: room.roomId, baseRevision: rev }), {
      record: (r) => {
        createdId = r.device.id
        return {
          apply: async (rev) => {
            const again = await hldApi.addDevice(orgId, projectId, { buildingId, role: data.item.role, roomId: room.roomId, baseRevision: rev })
            createdId = again.device.id
            return again
          },
          revert: (rev) => hldApi.deleteDevice(orgId, projectId, createdId, rev),
        }
      },
    })
    if (res) setSelectedDeviceId(res.device.id)
  }

  async function updateDevice(patch) {
    const device = devices.find((d) => d.id === selectedDeviceId)
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, device[k]]))
    await write((rev) => hldApi.updateDevice(orgId, projectId, device.id, { ...patch, baseRevision: rev }), {
      record: () => ({ apply: (rev) => hldApi.updateDevice(orgId, projectId, device.id, { ...patch, baseRevision: rev }), revert: (rev) => hldApi.updateDevice(orgId, projectId, device.id, { ...prev, baseRevision: rev }) }),
    })
  }

  async function submit() {
    try {
      await hldApi.submit(orgId, projectId, { buildingId, baseRevision: view.design.revision })
      clearHistory()
      await reload()
    } catch (err) {
      if (err.code === 'validation_blocked') await runValidation()
      if (err.code === 'stale_revision') setStale(err.message)
      else setError(err.message)
    }
  }
  async function decide(decision, comment) {
    try {
      await hldApi.decide(orgId, projectId, { buildingId, decision, comment })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view || !library) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const flow = buildHldFlow({
    floors: view.floors,
    rooms: view.rooms,
    devices: devices.map((d) => ({ ...d, model: [d.model, view.racks.find((k) => k.id === d.rackId)?.code].filter(Boolean).join(' · ') })),
    connections,
    connectionFindings: findingsByConn,
    selectedDeviceId,
    selectedConnectionId,
    onSelectDevice: handleSelectDevice,
    draggableDevices: editable && mode === 'move',
  })
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null
  const portOptionsFor = (deviceId) => devices.find((d) => d.id === deviceId)?.ports ?? []
  const sfpOptionsFor = (media, speed) => library.optics.filter((o) => o.media === media && String(o.speed) === String(speed)).map((o) => o.key)
  const sizeInfo = library.presets.find((p) => p.key === preset)
  const chosenVariant = sizeInfo?.variants.includes(variant) ? variant : sizeInfo?.variants[0]
  const blockedLinks = Object.values(findingsByConn).filter((f) => f.blocked).length
  const summary = validation?.summary ?? { critical: 0, warning: 0, info: 0, blocksSubmit: false }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveDragData(e.active.data.current)} onDragEnd={handleDragEnd}>
      <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
        <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <ArrowLeft size={14} strokeWidth={2} />
          {view.building.code} dashboard
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-text">NexAI-Suggested HLD — {view.building.name}</h1>
            <p className="text-sm text-text-secondary">
              Generated from validated physical survey data · Network Architect review required · revision {view.design.revision}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-text-secondary">Blueprint</span>
                <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Blueprint preset" className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none">
                  {library.presets.map((p) => (
                    <option key={p.key} value={p.key} title={p.description}>
                      {p.key} — {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-text-secondary">Variant</span>
                <select value={chosenVariant ?? ''} onChange={(e) => setVariant(e.target.value)} aria-label="Blueprint variant" className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none">
                  {(sizeInfo?.variants ?? []).map((key) => {
                    const v = library.variants.find((x) => x.key === key)
                    return (
                      <option key={key} value={key} title={v?.description}>
                        {v?.label ?? key}
                      </option>
                    )
                  })}
                </select>
              </label>
              <button
                type="button"
                onClick={generate}
                disabled={!editable || !view.surveyVerified}
                title={view.surveyVerified ? undefined : 'Every survey tab must be Verified first'}
                className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
              >
                <Sparkles size={14} strokeWidth={2} />
                Generate HLD
              </button>
            </div>
          )}
        </div>

        {!view.surveyVerified && <p className="rounded-lg border border-status-amber/40 bg-status-amber/5 px-3 py-2 text-xs text-status-amber">The survey of {view.building.code} is not fully verified yet — Generate HLD needs every survey tab Verified.</p>}

        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-amber/40 bg-status-amber/5 px-3 py-2 text-xs text-status-amber">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={14} strokeWidth={2} />
              {stale}
            </span>
            <button type="button" onClick={reload} className="flex items-center gap-1 font-medium text-brand hover:underline">
              <RefreshCw size={12} strokeWidth={2} />
              Reload
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-status-red">
            {error}{' '}
            <button type="button" onClick={() => setError(null)} className="font-medium text-text-secondary underline">
              Dismiss
            </button>
          </p>
        )}

        {view.surveyChanges.length > 0 && (
          <div data-testid="survey-changed" className="space-y-1 rounded-xl border border-status-amber/40 bg-status-amber/5 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-status-amber">
              <AlertTriangle size={13} strokeWidth={2} />
              Survey changed after import
            </div>
            {view.surveyChanges.map((flag) => (
              <div key={flag.id} className="text-text-secondary">
                <span className="font-medium text-text">
                  {flag.tab}
                  {flag.roomCode ? ` · ${flag.roomCode}` : ''}
                </span>
                {flag.changes.length === 0 && ' — edited'}
                {flag.changes.map((c, i) => (
                  <span key={i}>
                    {' '}
                    · {c.field}: {String(c.before ?? '—')} → {String(c.after ?? '—')}
                    {c.changedBy ? ` (${c.changedBy})` : ''}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}

        <HldWorkflowControls
          status={view.status}
          canSubmit={canEdit}
          canReview={canReview}
          requireComment
          submitBlockedReason={summary.blocksSubmit ? `${summary.critical} Critical finding(s) must be fixed before submitting` : devices.length === 0 ? 'Generate or draw the HLD first' : null}
          onSubmit={submit}
          onApprove={() => decide('approved')}
          onRequestChanges={(comment) => decide('changes_requested', comment)}
        />
        {latest?.decision?.comments && latest.status === 'changes_requested' && (
          <p className="text-xs text-status-red">
            Changes requested by {latest.decision.decidedBy}: {latest.decision.comments}
          </p>
        )}
        {ownSubmission && (has('pm') || has('reviewer')) && <p className="text-xs text-text-secondary">You submitted this HLD — another PM or Reviewer decides on it.</p>}

        {canEdit && <HldToolbar mode={draft ? (selectedConnectionId ? 'change-medium' : 'create-uplink') : mode} onSelectTool={selectTool} onUndo={undo} canUndo={history.index >= 0} onRedo={redo} canRedo={history.index < history.actions.length - 1} onDelete={deleteSelected} canDelete={Boolean(selectedConnectionId || selectedDeviceId)} disabled={!editable} />}
        {canEdit && mode === 'move' && !draft && <p className="text-xs text-text-secondary">Move: drag devices inside their room. Positions are saved separately from the design.</p>}

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <SurveyInputsPanel buildingId={buildingId} summary={view.surveyInputs} basePath={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} />
          <div className="min-w-0 flex-1">
            <ReactFlowProvider>
              <HldCanvas
                flow={flow}
                onInit={(inst) => (flowInstanceRef.current = inst)}
                viewOnly={isPhone}
                onEdgeClick={(id) => openEdit(id)}
                nodesDraggable={editable && mode === 'move'}
                onNodeDragStop={editable && mode === 'move' ? moveDevice : undefined}
              />
            </ReactFlowProvider>
          </div>
          <div className="w-full shrink-0 space-y-4 xl:w-80">
            {editable && <HldObjectLibrary enabled categories={libraryCategories(library.roles)} />}
            {showValidation && validation ? (
              <HldValidationPanel result={validation} onSelectFinding={handleSelectFinding} onClose={() => setShowValidation(false)} />
            ) : draft ? (
              <EditUplinkPanel
                step={wizardStep}
                onStepChange={setWizardStep}
                draft={draft}
                onDraftChange={(patch) => {
                  setDraft((d) => {
                    const next = { ...d, ...patch }
                    // A new medium or speed drops optics that no longer fit, so a
                    // hidden stale optic never travels with the uplink.
                    if ('media' in patch || 'speed' in patch) {
                      const fits = sfpOptionsFor(next.media, next.speed)
                      if (!fits.includes(next.sourceSfp)) next.sourceSfp = null
                      if (!fits.includes(next.destSfp)) next.destSfp = null
                    }
                    return next
                  })
                  setCheck(null)
                }}
                devices={devices}
                validation={check}
                onValidate={runCheck}
                onApply={applyUplink}
                onCancel={() => {
                  setDraft(null)
                  setCheck(null)
                  setMode('select')
                }}
                disabled={!editable}
                sfpOptionsFor={sfpOptionsFor}
                portOptionsFor={portOptionsFor}
                applyLabel={selectedConnectionId ? 'Save uplink' : 'Create uplink'}
              />
            ) : selectedDevice ? (
              <HldDeviceDetails device={selectedDevice} models={catalogueModels[selectedDevice.role] ?? []} editable={editable} onChange={updateDevice} onDelete={deleteSelected} onCreateUplink={() => openCreate(selectedDevice.id)} />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-xs text-text-secondary">
                {editable ? 'Select a device or an uplink, drag a device from the library into a room, or use Create Uplink.' : 'Select a device or an uplink to see it.'}
              </div>
            )}
          </div>
        </div>

        <HldStatusBar
          surveyLinkedObjectCount={devices.length + connections.length}
          cmo={view.surveyInputs.cmo}
          openDesignQuestions={summary.critical + summary.warning}
          blockedLinkCount={blockedLinks}
        />
        <p className="text-xs text-text-secondary">Logical topology (VLANs) arrives with a later milestone.</p>
      </div>
      <DragOverlay dropAnimation={null}>
        <DragPreviewCard dragData={activeDragData?.kind === 'hld-library-item' ? { kind: 'topology-library-item', item: activeDragData.item } : null} />
      </DragOverlay>
    </DndContext>
  )
}
