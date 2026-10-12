import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, RefreshCw, PlayCircle, PenLine, Cable, GitBranch } from 'lucide-react'
import ConnectivityTab from '../components/lld/ConnectivityTab.jsx'
import RackElevationsTab from '../components/lld/RackElevationsTab.jsx'
import PortScheduleTab from '../components/lld/PortScheduleTab.jsx'
import CableScheduleTab from '../components/lld/CableScheduleTab.jsx'
import HldBaselineBanner from '../components/lld/HldBaselineBanner.jsx'
import HldWorkflowControls from '../components/hld/HldWorkflowControls.jsx'
import HldValidationPanel from '../components/hld/HldValidationPanel.jsx'
import LldPlacementPanel from '../components/lld/real/LldPlacementPanel.jsx'
import LldVersionsPanel from '../components/lld/real/LldVersionsPanel.jsx'
import LldRenameDialog from '../components/lld/real/LldRenameDialog.jsx'
import LldReconciliation from '../components/lld/real/LldReconciliation.jsx'
import { lldApi, toLldContext } from '../api/lldApi.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { serialQueue } from '../lib/serialQueue.js'

// Client audit: "Physical Connections" (was Connectivity); Cable ID is the
// Cable Schedule's first column.
const TABS = [
  { id: 'connections', label: 'Physical Connections' },
  { id: 'racks', label: 'Rack Elevations' },
  { id: 'ports', label: 'Port Schedule' },
  { id: 'cables', label: 'Cable Schedule' },
]

// Real-mode LLD (brief v2.3 §5.4, §6.1–6.4, §6.10; M4b): the prototype's LLD
// tabs on the backend, plus rack placement, versions, branches, hostname
// rename, HLD reconciliation and the approval workflow. Every design change
// is sent with the revision this screen loaded; a stale one is refused and
// the screen offers to reload.
export default function RealLld() {
  const { orgId, projectId, buildingId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const branchId = searchParams.get('branch') || null
  const { user } = useAuth()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const isPhone = useMediaQuery('(max-width: 767px)')
  const [view, setView] = useState(null)
  const [validation, setValidation] = useState(null)
  const [reconciliation, setReconciliation] = useState(null)
  const [tab, setTab] = useState('connections')
  const [showValidation, setShowValidation] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(null)
  const [notice, setNotice] = useState(null)
  // The latest loaded view, and one queue for every design write (see lib/serialQueue.js).
  const viewRef = useRef(null)
  const [queue] = useState(serialQueue)

  const reload = useCallback(async () => {
    try {
      const v = await lldApi.view(orgId, projectId, buildingId, branchId)
      viewRef.current = v
      setView(v)
      if (v.started) {
        const [val, rec] = await Promise.all([lldApi.validate(orgId, projectId, buildingId, branchId), v.hld.changed ? lldApi.reconciliation(orgId, projectId, buildingId) : null])
        setValidation(val)
        setReconciliation(rec)
      }
      setError(null)
      setStale(null)
    } catch (err) {
      if (err.code === 'not_found' && branchId) setSearchParams({})
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId, branchId, setSearchParams])

  useEffect(() => {
    reload()
  }, [reload])

  const context = useMemo(() => (view?.started ? toLldContext(view, validation) : null), [view, validation])

  const isArchitect = !readOnly && has('architect')
  const canEdit = isArchitect && !isPhone
  const locked = view?.design?.state === 'awaiting_approval' && !branchId
  const editable = canEdit && !locked
  const latest = view?.approvals?.[0] ?? null
  const ownSubmission = latest?.status === 'pending' && latest.submittedById === user?.id
  const canReview = !readOnly && (has('pm') || has('reviewer')) && !ownSubmission
  const canRename = !readOnly && (has('architect') || has('pm')) && !isPhone && !view?.renameLocked && !locked
  const editorPath = (rackId) => `/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}/lld/editor?rack=${rackId}${branchId ? `&branch=${branchId}` : ''}`

  // One design write with the latest loaded revision, queued behind any write
  // still in flight; stale → offer reload.
  function write(fn, opts) {
    return queue(() => writeNow(fn, opts))
  }
  async function writeNow(fn, { silent = false } = {}) {
    try {
      const result = await fn(viewRef.current.design.revision)
      await reload()
      return result ?? true
    } catch (err) {
      if (err.code === 'stale_revision') setStale(err.message)
      else if (!silent) setError(err.message)
      if (silent) throw err
      return null
    }
  }
  const call = (fn) => (...args) => fn(orgId, projectId, ...args)

  async function start() {
    try {
      await lldApi.start(orgId, projectId, { buildingId })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }
  async function runValidation() {
    try {
      setValidation(await lldApi.validate(orgId, projectId, buildingId, branchId))
      setShowValidation(true)
    } catch (err) {
      setError(err.message)
    }
  }
  async function submit() {
    try {
      await lldApi.submit(orgId, projectId, { buildingId, baseRevision: viewRef.current.design.revision })
      await reload()
    } catch (err) {
      if (err.code === 'validation_blocked') await runValidation()
      if (err.code === 'stale_revision') setStale(err.message)
      else setError(err.message)
    }
  }
  async function decide(decision, comment) {
    try {
      await lldApi.decide(orgId, projectId, { buildingId, decision, comment })
      await reload()
    } catch (err) {
      setError(err.message)
    }
  }
  // Cable Schedule cells report errors inline ({ ok, error }).
  async function inline(fn) {
    try {
      await write(fn, { silent: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }
  function openBranch(id) {
    setSearchParams(id ? { branch: id } : {})
  }

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary">Loading…</div>

  const header = (
    <>
      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {view.building.code} dashboard
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-text">LLD — Low-Level Design</h1>
        <p className="text-sm text-text-secondary">
          Building {view.building.code} · Exact port-to-port connections, rack elevations, cable specifications
          {view.started ? ` · revision ${view.design.revision}` : ''}
        </p>
      </div>
    </>
  )

  if (!view.started) {
    return (
      <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
        {header}
        <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-sm text-text-secondary" data-testid="lld-not-started">
          {view.hld.latestApprovedNumber ? (
            <>
              <p>The LLD starts from the latest approved HLD (v{view.hld.latestApprovedNumber}): a working copy of its devices and uplinks. Later HLD changes are reconciled by hand — nothing re-syncs automatically.</p>
              {isArchitect ? (
                <button type="button" onClick={start} className="mt-3 h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9">
                  Start LLD from HLD v{view.hld.latestApprovedNumber}
                </button>
              ) : (
                <p className="mt-2">The Network Architect starts it.</p>
              )}
            </>
          ) : (
            <p>The LLD starts once the HLD of {view.building.code} is approved.</p>
          )}
        </div>
        {error && <p className="text-xs text-status-red">{error}</p>}
      </div>
    )
  }

  const summary = validation?.summary ?? { critical: 0, warning: 0, info: 0, blocksSubmit: false }
  const racksForPicker = view.racks.map((r) => ({ id: r.id, label: `${view.rooms.find((x) => x.id === r.roomId)?.code ?? ''} / ${r.code}` }))

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      {header}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={runValidation} className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 sm:h-9">
          <PlayCircle size={14} strokeWidth={2} />
          Validate LLD
        </button>
        <Link to={editorPath(view.racks[0]?.id ?? '')} className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-4 text-xs font-medium text-text hover:border-brand sm:h-9">
          <Cable size={14} strokeWidth={2} />
          Rackium Editor
        </Link>
        {canRename && (
          <button type="button" onClick={() => setRenaming(true)} className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-4 text-xs font-medium text-text hover:border-brand sm:h-9">
            <PenLine size={14} strokeWidth={2} />
            Rename hostnames
          </button>
        )}
        {view.renameLocked && <span className="text-xs text-text-secondary">Hostnames are fixed after LLD approval — renaming needs a change request.</span>}
      </div>

      {view.branch && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/40 bg-brand/5 px-3 py-2 text-xs text-brand" data-testid="lld-branch-banner">
          <GitBranch size={14} strokeWidth={2} />
          Editing branch <strong>{view.branch.name}</strong> ({view.branch.status}) — the main LLD is unchanged until the branch is promoted.
          <button type="button" onClick={() => openBranch(null)} className="font-medium underline">
            Back to main LLD
          </button>
        </div>
      )}

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
      {notice && (
        <p className="text-xs text-status-green" role="status">
          {notice}
        </p>
      )}

      <HldBaselineBanner hld={context.hld} canEdit={editable && !branchId} onRebase={() => write((rev) => lldApi.rebase(orgId, projectId, { buildingId, baseRevision: rev }))}>
        <LldReconciliation reconciliation={reconciliation} editable={editable && !branchId} onCopy={(ids) => write((rev) => lldApi.copyFromHld(orgId, projectId, { buildingId, hldDeviceIds: [], hldConnectionIds: [], ...ids, baseRevision: rev }))} />
      </HldBaselineBanner>

      {!branchId && (
        <>
          <HldWorkflowControls
            status={view.status}
            canSubmit={canEdit}
            canReview={canReview}
            requireComment
            submitBlockedReason={summary.blocksSubmit ? `${summary.critical} Critical finding(s) must be fixed before submitting` : null}
            onSubmit={submit}
            onApprove={() => decide('approved')}
            onRequestChanges={(comment) => decide('changes_requested', comment)}
          />
          {latest?.decision?.comments && latest.status === 'changes_requested' && (
            <p className="text-xs text-status-red">
              Changes requested by {latest.decision.decidedBy}: {latest.decision.comments}
            </p>
          )}
          {ownSubmission && (has('pm') || has('reviewer')) && <p className="text-xs text-text-secondary">You submitted this LLD — another PM or Reviewer decides on it.</p>}
        </>
      )}

      {showValidation && validation && (
        <HldValidationPanel
          result={validation}
          designLabel="LLD"
          onClose={() => setShowValidation(false)}
          onSelectFinding={(f) => {
            if (f.rule === 'L-PLACEMENT') setTab('racks')
            else if (f.objectType === 'connection') setTab('cables')
          }}
        />
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-touch shrink-0 px-3 text-sm font-medium sm:h-9 ${tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-text-secondary hover:text-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-4">
          {tab === 'connections' && <ConnectivityTab context={context} editorPath={editorPath} />}
          {tab === 'racks' && (
            <>
              <LldPlacementPanel
                devices={view.devices}
                racks={racksForPicker}
                passiveModels={view.passiveModels ?? []}
                editable={editable}
                onPlace={(deviceId, body) => write((rev) => lldApi.place(orgId, projectId, deviceId, { ...body, baseRevision: rev }))}
                onAdd={(body) => write((rev) => lldApi.addDevice(orgId, projectId, { buildingId, branchId: branchId ?? undefined, ...body, baseRevision: rev }))}
              />
              <RackElevationsTab rackElevations={context.rackElevations} editorPath={editorPath} />
            </>
          )}
          {tab === 'ports' && <PortScheduleTab portSchedule={context.portSchedule} buildingCode={view.building.code} />}
          {tab === 'cables' && (
            <CableScheduleTab
              rows={context.rows}
              buildingCode={view.building.code}
              checks={context.checks}
              editable={editable}
              cableIdSuggestion={view.cableIdSuggestion}
              onAssignCableId={(connectionId, rawId) => inline((rev) => lldApi.updateConnection(orgId, projectId, connectionId, { cableId: rawId.trim() || null, baseRevision: rev }))}
              onSetEngineerSelected={(connectionId, meters) => inline((rev) => lldApi.updateConnection(orgId, projectId, connectionId, { engineerSelectedM: meters || null, baseRevision: rev }))}
            />
          )}
        </div>
        <LldVersionsPanel
          view={view}
          branchId={branchId}
          editable={canEdit}
          onSave={async (label) => {
            const res = await write(() => lldApi.saveVersion(orgId, projectId, { buildingId, branchId: branchId ?? undefined, label }))
            if (res) setNotice(`Saved v${res.number} ${label}`)
            return res
          }}
          onDiff={async (from, to) => {
            try {
              return await call(lldApi.diff)({ buildingId, from, to })
            } catch (err) {
              setError(err.message)
              return null
            }
          }}
          onRestore={async (v) => {
            if (!window.confirm(`Restore v${v.number} ${v.label ?? ''}? The current ${branchId ? 'branch' : 'LLD'} is replaced (save a version first to keep it).`)) return
            const res = await write((rev) => lldApi.restore(orgId, projectId, v.id, { branchId: branchId ?? undefined, baseRevision: rev }))
            if (res) setNotice(`Restored v${v.number}`)
          }}
          onCreateBranch={async (name, fromVersionId) => {
            try {
              const res = await lldApi.createBranch(orgId, projectId, { buildingId, name, fromVersionId })
              openBranch(res.branch.id)
              return res
            } catch (err) {
              setError(err.message)
              return null
            }
          }}
          onOpenBranch={openBranch}
          onPromote={async (b) => {
            if (!window.confirm(`Promote branch ${b.name}? It replaces the main LLD (no merge).`)) return
            try {
              const main = await lldApi.view(orgId, projectId, buildingId)
              await lldApi.promoteBranch(orgId, projectId, b.id, { baseRevision: main.design.revision })
              setNotice(`Branch ${b.name} promoted`)
              openBranch(null)
              await reload()
            } catch (err) {
              if (err.code === 'stale_revision') setStale(err.message)
              else setError(err.message)
            }
          }}
          onDiscard={async (b) => {
            if (!window.confirm(`Discard branch ${b.name}? Its changes are lost.`)) return
            try {
              await lldApi.discardBranch(orgId, projectId, b.id)
              if (branchId === b.id) openBranch(null)
              await reload()
            } catch (err) {
              setError(err.message)
            }
          }}
        />
      </div>

      {renaming && (
        <LldRenameDialog
          devices={view.devices}
          onClose={() => setRenaming(false)}
          onPreview={async (body) => {
            try {
              return await lldApi.renamePreview(orgId, projectId, { buildingId, branchId: branchId ?? undefined, ...body })
            } catch (err) {
              setError(err.message)
              return null
            }
          }}
          onApply={async (body) => {
            const res = await write((rev) => lldApi.rename(orgId, projectId, { buildingId, branchId: branchId ?? undefined, ...body, baseRevision: rev }))
            if (res) {
              setRenaming(false)
              setNotice(`${res.renamed} hostname(s) renamed`)
            }
          }}
        />
      )}
    </div>
  )
}
