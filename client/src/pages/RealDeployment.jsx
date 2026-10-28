import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { ArrowLeft, ChevronLeft, Lock, QrCode } from 'lucide-react'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import LocationTree from '../components/deployment/LocationTree.jsx'
import RoomChecklistPanel from '../components/deployment/RoomChecklistPanel.jsx'
import PipelineBar from '../components/realDeployment/PipelineBar.jsx'
import InstallationPanel from '../components/realDeployment/InstallationPanel.jsx'
import ExceptionRegister from '../components/realDeployment/ExceptionRegister.jsx'
import LogExceptionDialog from '../components/realDeployment/LogExceptionDialog.jsx'
import { applyDeploymentStyling } from '@rackium/shared/deploymentFlow.js'
import { deploymentApi } from '../api/deploymentApi.js'
import DocumentExports from '../components/documents/DocumentExports.jsx'
import LabelPrintDialog from '../components/documents/LabelPrintDialog.jsx'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

// Real-mode Deployment & Installation (brief v2.3 §5.7, §4.4, §6.9; M6a): the
// HLD topology (planned links grey dashed, installed ones in media colours),
// the location tree with status counts, the pipeline bar, the per-device
// installation record (phone first), the room checklist and the exception
// register — all from the server's calculation against the frozen LLD.
export default function RealDeployment() {
  const { orgId, projectId, buildingId } = useParams()
  const [search, setSearch] = useSearchParams()
  const isPhone = useMediaQuery('(max-width: 767px)')
  const { readOnly } = useProjectRoles(orgId, projectId)
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [phoneView, setPhoneView] = useState('tree')
  const [logTarget, setLogTarget] = useState(null)
  // ?labels=<connection ids>: a reprint-label task opens the dialog with its cables chosen (M7b-2).
  const reprint = search.get('labels')
  const [labels, setLabels] = useState(() => Boolean(reprint))
  const selectedId = search.get('device')
  const select = useCallback((id) => setSearch(id ? { device: id } : {}, { replace: true }), [setSearch])

  const reload = useCallback(async () => {
    try {
      setView(await deploymentApi.view(orgId, projectId, buildingId))
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    reload()
  }, [reload])

  async function act(fn, done) {
    try {
      await fn()
      setNotice(done ?? null)
      setError(null)
      await reload()
      return true
    } catch (err) {
      setNotice(null)
      setError(err.message)
      await reload()
      return false
    }
  }

  const flow = useMemo(() => {
    if (!view?.started) return null
    // The HLD topology: active devices (panels are hops, not nodes) and the surveyed gear they connect to.
    const shown = view.devices.filter((d) => !d.passive)
    const ids = new Set(shown.map((d) => d.id))
    const existing = view.existingDevices.filter((x) => view.connections.some((c) => c.source.deviceId === x.id || c.dest.deviceId === x.id)).map((x) => ({ ...x, status: 'in_service' }))
    for (const x of existing) ids.add(x.id)
    const connections = view.connections.filter((c) => ids.has(c.source.deviceId) && ids.has(c.dest.deviceId))
    const devices = [...shown, ...existing].map((d) => ({ ...d, model: [d.model, d.rackCode].filter(Boolean).join(' · ') }))
    return applyDeploymentStyling(buildHldFlow({ floors: view.floors.map((f) => ({ ...f, name: f.name })), rooms: view.rooms, devices, connections, connectionFindings: {}, selectedDeviceId: selectedId, onSelectDevice: select }), devices, connections)
  }, [view, selectedId, select])

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary" data-page-state="loading">Loading…</div>

  const back = (
    <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
      <ArrowLeft size={14} strokeWidth={2} />
      {view.building.code} dashboard
    </Link>
  )
  if (!view.started) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6" data-page-state="ready">
        {back}
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-text-secondary">Deployment starts from the LLD — this building has none yet.</div>
      </div>
    )
  }

  const permissions = { install: !readOnly && view.permissions.install, recordDguv: !readOnly && view.permissions.recordDguv, overrideDguv: !readOnly && view.permissions.overrideDguv, accept: !readOnly && view.permissions.accept, reviewExceptions: !readOnly && view.permissions.reviewExceptions }
  const selected = view.devices.find((d) => d.id === selectedId) ?? null
  const racks = view.racks.map((r) => ({ ...r, label: `${r.code} · ${view.rooms.find((x) => x.id === r.roomId)?.code ?? ''}` }))
  const openExceptions = view.exceptions.filter((e) => e.status === 'open').length
  const panel = selected ? (
    <InstallationPanel
      key={`${selected.id}:${selected.status}:${selected.installation.updatedAt ?? ''}:${selected.dguv?.lastInspectionDate ?? ''}`}
      device={selected}
      connections={view.connections.filter((c) => selected.connectionIds.includes(c.id))}
      racks={racks}
      orgId={orgId}
      projectId={projectId}
      today={view.today}
      permissions={permissions}
      act={act}
      onLogException={setLogTarget}
    />
  ) : (
    <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-text-secondary">Select a device in the list or on the map to record its installation.</div>
  )
  const messages = (
    <>
      {notice && (
        <div className="rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-2 text-sm text-status-green" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-status-red/40 bg-status-red/5 px-4 py-2 text-sm text-status-red" role="alert">
          {error}
        </div>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6" data-page-state="ready">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-text sm:text-2xl">Deployment &amp; Installation — {view.building.code}</h1>
          <p className="text-sm text-text-secondary">Installed against the frozen LLD: every device, port, cable and length compared field by field</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLabels(true)} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:border-brand sm:h-9">
            <QrCode size={15} strokeWidth={2} /> Print labels
          </button>
          <DocumentExports
            orgId={orgId}
            projectId={projectId}
            buildingId={buildingId}
            items={[
              { typeKey: 'deployment-report', format: 'pdf', label: 'Deployment report' },
              { typeKey: 'exception-register', format: 'pdf', label: 'Exception register' },
              { typeKey: 'as-built', format: 'pdf', label: 'As-built vs as-designed' },
              { typeKey: 'dguv-report', format: 'pdf', label: 'DGUV report' },
              { typeKey: 'dguv-report', format: 'xlsx', label: 'DGUV report' },
            ]}
          />
        </div>
      </div>
      {!view.frozen && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted px-4 py-2.5 text-xs text-text-secondary">
          <Lock size={14} strokeWidth={2} /> Installation opens once the client approves the Solution Package (the LLD is then frozen).
        </div>
      )}
      {!isPhone && messages}
      <PipelineBar pipeline={view.pipeline} openExceptions={openExceptions} />

      {isPhone && selected && (
        // Phone: the device record is its own screen below the top bar, with a clear way back.
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 space-y-3 overflow-y-auto bg-surface-muted p-4" data-testid="device-screen">
          <button type="button" onClick={() => select(null)} className="flex h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand">
            <ChevronLeft size={18} strokeWidth={2} />
            Back to devices
          </button>
          {messages}
          {panel}
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {isPhone && (
            <div role="tablist" aria-label="Deployment view" className="flex gap-1 rounded-xl border border-border bg-surface p-1">
              {[
                { id: 'tree', label: 'Devices' },
                { id: 'map', label: 'Map' },
              ].map((v) => (
                <button key={v.id} type="button" role="tab" aria-selected={phoneView === v.id} onClick={() => setPhoneView(v.id)} className={`h-touch flex-1 rounded-lg text-sm font-medium ${phoneView === v.id ? 'bg-brand/10 text-brand' : 'text-text-secondary'}`}>
                  {v.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            {(!isPhone || phoneView === 'tree') && (
              <div className="rounded-xl border border-border bg-surface p-3 md:h-[600px] md:w-72 md:shrink-0 md:overflow-y-auto" data-testid="location-tree">
                <LocationTree tree={view.tree} selectedDeviceId={selectedId} onSelectDevice={select} />
              </div>
            )}
            {(!isPhone || phoneView === 'map') && (
              <div className="min-w-0 flex-1">
                <ReactFlowProvider>
                  <HldCanvas flow={flow} onInit={() => {}} viewOnly={isPhone} />
                </ReactFlowProvider>
              </div>
            )}
          </div>
        </div>
        {!isPhone && <div className="w-full min-w-0 shrink-0 space-y-4 xl:w-[28rem]">{panel}</div>}
      </div>

      <ExceptionRegister
        exceptions={view.exceptions}
        canReview={permissions.reviewExceptions}
        onSelectDevice={select}
        onReview={(e, decision, note) => act(() => deploymentApi.reviewException(orgId, projectId, e.id, { decision, note }), `Exception ${decision}`)}
      />
      <RoomChecklistPanel roomChecklists={view.roomChecklists} />

      {labels && (
        <LabelPrintDialog
          orgId={orgId}
          projectId={projectId}
          buildingId={buildingId}
          preselected={reprint ? reprint.split(',') : null}
          onClose={() => {
            setLabels(false)
            if (reprint) setSearch(selectedId ? { device: selectedId } : {}, { replace: true })
          }}
          connections={view.connections.map((c) => ({ id: c.id, title: `${c.source.name} ${c.source.portId ?? ''} → ${c.dest.name} ${c.dest.portId ?? ''}`, cableIds: c.segments.map((s) => s.installed?.cableId ?? s.cableId).filter(Boolean) }))}
        />
      )}
      {logTarget && (
        <LogExceptionDialog
          target={logTarget}
          deviceName={view.devices.find((d) => d.id === logTarget.deviceId)?.label ?? ''}
          onUpload={(file) => deploymentApi.uploadDeviceFile(orgId, projectId, logTarget.deviceId, file, 'evidence')}
          onClose={() => setLogTarget(null)}
          onSubmit={async (body) => {
            await deploymentApi.logException(orgId, projectId, body)
            setLogTarget(null)
            setNotice('Exception logged — a Reviewer or PM reviews it')
            await reload()
          }}
        />
      )}
    </div>
  )
}
