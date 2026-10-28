import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, PackageCheck, Lock, Download, Loader2, AlertTriangle, CheckCircle2, Send, Eye, RotateCcw, Copy } from 'lucide-react'
import WorkflowTracker from '../components/handover/WorkflowTracker.jsx'
import ChecklistPanel from '../components/handover/ChecklistPanel.jsx'
import StatusChip from '../components/StatusChip.jsx'
import { handoverApi, documentsApi, FORMAT_LABEL, humanSize } from '../api/documentsApi.js'
import { deliveryApi } from '../api/deliveryApi.js'
import { useProjectRoles } from '../lib/useProjectRoles.js'

const STATUS_TONE = { ready: 'text-status-green', failed: 'text-status-red', generating: 'text-status-amber', not_compiled: 'text-text-secondary' }
const STATUS_TEXT = { ready: 'Ready', failed: 'Failed', generating: 'Generating', not_compiled: 'Not compiled' }
const input = 'h-touch w-full rounded-lg border border-border bg-surface px-2 text-sm text-text focus:border-brand focus:outline-none sm:h-9'

// Real-mode Handover (brief v2.3 §5.9, v2.2 §3.11; M6b): the calculated
// pre-compilation checklist, the 11 documents compiled as background jobs,
// review, delivery to the client by share link, and the baseline once the
// client accepts — after which the design is read-only.
export default function RealHandover() {
  const { orgId, projectId, buildingId } = useParams()
  const { readOnly, has } = useProjectRoles(orgId, projectId)
  const [view, setView] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [deliverForm, setDeliverForm] = useState({ password: '', expiryDays: 14 })
  const [sent, setSent] = useState(null)
  const timer = useRef(null)

  const reload = useCallback(async () => {
    try {
      setView(await handoverApi.view(orgId, projectId, buildingId))
      setError(null)
    } catch (err) {
      setError(err.status === 404 ? 'This building is not in the part of the project you can see.' : err.message)
    }
  }, [orgId, projectId, buildingId])
  useEffect(() => {
    reload()
  }, [reload])
  // While the documents are generated in the background, keep the page current.
  // (An interval, not a timeout re-armed on change: two polls with the same count must not stop it.)
  const compiling = view?.state === 'compiling'
  useEffect(() => {
    if (!compiling) return undefined
    timer.current = setInterval(reload, 2000)
    return () => clearInterval(timer.current)
  }, [compiling, reload])

  async function act(fn, done) {
    try {
      const out = await fn()
      setNotice(done)
      setError(null)
      await reload()
      return out
    } catch (err) {
      setNotice(null)
      setError(err.message)
      return null
    }
  }

  if (error && !view) return <div className="p-6 text-sm text-status-red">{error}</div>
  if (!view) return <div className="p-6 text-sm text-text-secondary" data-page-state="loading">Loading…</div>

  const can = { compile: !readOnly && view.permissions.compile, review: !readOnly && view.permissions.review, deliver: !readOnly && view.permissions.deliver }
  const failed = view.documents.some((d) => d.status === 'failed')
  const trackerState = view.state === 'compiling' ? 'ready' : view.state
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6" data-page-state={view.state === 'compiling' ? 'compiling' : 'ready'}>
      <Link to={`/orgs/${orgId}/projects/${projectId}/buildings/${buildingId}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
        <ArrowLeft size={14} strokeWidth={2} />
        {view.building.code} dashboard
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold text-text sm:text-2xl">
            <PackageCheck size={24} strokeWidth={2} className="text-brand" /> Handover — {view.building.code}
          </h1>
          <p className="text-sm text-text-secondary">The as-built package for the client: 11 documents, compiled from every phase, signed off through a share link</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={view.phaseStatus} />
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-text" data-testid="handover-state">
            {view.stateLabel}
          </span>
        </div>
      </div>

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
      {view.baseline && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-3 text-sm text-status-green" data-testid="baseline">
          <Lock size={16} strokeWidth={2} />
          <span>
            <strong>Accepted — baseline {view.baseline.label}</strong> on {new Date(view.baseline.acceptedAt).toLocaleDateString()} by {view.baseline.client.name}
            {view.baseline.client.role ? ` (${view.baseline.client.role})` : ''}. The design and deployment records are read-only; the CMDB stays editable for operational changes.
          </span>
        </div>
      )}
      {view.lastDecision && view.state === 'changes_requested' && (
        <div className="rounded-xl border border-status-amber/40 bg-status-amber/5 px-4 py-3 text-sm text-status-amber" role="status">
          <strong>{view.lastDecision.by}</strong> {view.lastDecision.value === 'rejected' ? 'rejected' : 'requested changes'}: “{view.lastDecision.comments}”
        </div>
      )}

      <WorkflowTracker state={trackerState} readyToCompile={view.ready} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Handover documents">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">
                Documents {view.round ? `· round ${view.round}` : ''} ({view.compiledCount}/{view.fileCount} files)
              </h2>
              <div className="flex flex-wrap gap-2">
                {can.compile && (
                  <button type="button" onClick={() => act(() => handoverApi.compile(orgId, projectId, buildingId), 'Compiling the package — documents are generated in the background')} className="inline-flex h-touch items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white sm:h-9">
                    <PackageCheck size={15} strokeWidth={2} /> {view.round ? 'Compile again' : 'Compile package'}
                  </button>
                )}
                {view.state === 'compiling' && failed && !readOnly && (
                  <button type="button" onClick={() => act(() => handoverApi.retry(orgId, projectId, buildingId), 'Failed documents queued again')} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-sm sm:h-9">
                    <RotateCcw size={15} strokeWidth={2} /> Retry failed
                  </button>
                )}
              </div>
            </div>
            {view.state === 'compiling' && (
              <div className="flex items-center gap-2 text-xs text-text-secondary" role="status" aria-live="polite">
                <Loader2 size={14} strokeWidth={2} className="animate-spin" /> Compiling: {view.compiledCount} of {view.fileCount} files ready
              </div>
            )}
            {/* A stacked list: readable and downloadable at every width (a table scrolled sideways on a phone). */}
            <ul className="divide-y divide-border/60" aria-label="Package documents">
              {view.documents.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 text-xs" data-testid={`handover-doc-${d.key}`}>
                  <span className="min-w-0">
                    <span className="block font-medium text-text">{d.name}</span>
                    <span className={`inline-flex items-center gap-1 ${STATUS_TONE[d.status]}`}>
                      {d.status === 'ready' ? <CheckCircle2 size={12} strokeWidth={2} /> : d.status === 'failed' ? <AlertTriangle size={12} strokeWidth={2} /> : d.status === 'generating' ? <Loader2 size={12} strokeWidth={2} className="animate-spin" /> : null}
                      {STATUS_TEXT[d.status]}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {d.files.map((f) =>
                      f.document?.status === 'ready' ? (
                        <a key={f.format} href={documentsApi.downloadUrl(orgId, projectId, f.document.id)} download={f.document.fileName} className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-2.5 font-medium text-text hover:border-brand">
                          <Download size={12} strokeWidth={2} /> {FORMAT_LABEL[f.format]}
                        </a>
                      ) : (
                        <span key={f.format} title={f.document?.error ?? ''} className="inline-flex h-9 items-center rounded-lg bg-surface-muted px-2.5 text-text-secondary">
                          {FORMAT_LABEL[f.format]}
                          {f.document?.status === 'failed' ? ' — failed' : ''}
                        </span>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {view.package && (
              <a href={documentsApi.downloadUrl(orgId, projectId, view.package.id)} download={view.package.fileName} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-brand px-3 text-sm font-medium text-brand sm:h-9" data-testid="package-download">
                <Download size={15} strokeWidth={2} /> Handover package (ZIP, {humanSize(view.package.sizeBytes)})
              </a>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <ChecklistPanel checklist={view.checklist} canKeepOldGear={!readOnly && view.permissions.keepOldGear} onKeepOldGear={(reason) => act(() => handoverApi.keepOldGear(orgId, projectId, buildingId, reason), reason ? 'Kept on site, with the reason' : 'Keeping it on site withdrawn')} />
          {(can.review || can.deliver || sent) && (
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Review and delivery">
              {can.review && (
                <button type="button" onClick={() => act(() => handoverApi.review(orgId, projectId, buildingId), 'Marked reviewed')} className="inline-flex h-touch w-full items-center justify-center gap-1.5 rounded-lg border border-brand px-3 text-sm font-medium text-brand sm:h-9">
                  <Eye size={15} strokeWidth={2} /> Mark reviewed
                </button>
              )}
              {can.deliver && (
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const out = await act(() => handoverApi.deliver(orgId, projectId, buildingId, { ...(deliverForm.password ? { password: deliverForm.password } : {}), expiryDays: Number(deliverForm.expiryDays) }), 'Sent to the client')
                    if (out) setSent(out.shareLink)
                  }}
                >
                  <div className="text-sm font-semibold text-text">Send to the client</div>
                  <label className="block text-xs text-text-secondary">
                    Password (blank: generated)
                    <input className={input} value={deliverForm.password} onChange={(e) => setDeliverForm({ ...deliverForm, password: e.target.value })} minLength={8} />
                  </label>
                  <label className="block text-xs text-text-secondary">
                    Valid for (days, 1–30)
                    <input className={input} type="number" min="1" max="30" value={deliverForm.expiryDays} onChange={(e) => setDeliverForm({ ...deliverForm, expiryDays: e.target.value })} />
                  </label>
                  <button type="submit" className="inline-flex h-touch w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white sm:h-9">
                    <Send size={15} strokeWidth={2} /> Create link and send
                  </button>
                </form>
              )}
              {sent && (
                <div className="space-y-2 rounded-lg border border-status-amber/40 bg-status-amber/5 p-3 text-xs" data-testid="handover-link">
                  <p className="font-semibold text-text">Copy the link and password now — they are shown only once.</p>
                  {[
                    ['Link', `${window.location.origin}${sent.url}`],
                    ['Password', sent.password],
                  ].map(([label, value]) => (
                    <label key={label} className="block text-text-secondary">
                      {label}
                      <span className="mt-0.5 flex gap-1">
                        <input readOnly value={value} className={input} />
                        <button type="button" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => navigator.clipboard?.writeText(value)} className="flex h-touch w-10 shrink-0 items-center justify-center rounded-lg border border-border sm:h-9">
                          <Copy size={14} strokeWidth={2} />
                        </button>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}
          {view.shareLinks.length > 0 && (
            <section className="space-y-2 rounded-xl border border-border bg-surface p-4" aria-label="Client links">
              <h2 className="text-sm font-semibold text-text">Client links</h2>
              <ul className="space-y-1.5 text-xs">
                {view.shareLinks.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-text-secondary">
                      {l.status} · expires {new Date(l.expiresAt).toLocaleDateString()}
                    </span>
                    {l.status === 'active' && !readOnly && has('pm') && (
                      <button type="button" onClick={() => act(() => deliveryApi.revokeLink(orgId, projectId, l.id), 'Link withdrawn — back to Under review')} className="font-medium text-status-red">
                        Withdraw
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
