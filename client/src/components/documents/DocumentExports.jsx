import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Download, FileDown, Loader2, AlertTriangle, History } from 'lucide-react'
import { documentsApi, FORMAT_LABEL, humanSize } from '../../api/documentsApi.js'
import { useDocumentJob } from './documentJob.js'

export function JobStatus({ job, orgId, projectId }) {
  if (!job) return null
  if (job.status === 'failed') {
    return (
      <div className="flex items-start gap-1.5 rounded-lg bg-status-red/10 px-2.5 py-1.5 text-xs text-status-red" role="alert">
        <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" /> {job.error ?? 'The document could not be generated'}
      </div>
    )
  }
  if (job.status === 'ready') {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-status-green/10 px-2.5 py-1.5 text-xs text-status-green" role="status" data-testid="document-ready">
        <FileDown size={14} strokeWidth={2} /> {job.fileName} is ready{job.pageCount ? ` (${job.pageCount} pages)` : ''} —
        <a className="font-semibold underline" href={documentsApi.downloadUrl(orgId, projectId, job.id)} download={job.fileName}>
          download again
        </a>
      </div>
    )
  }
  return (
    <div className="space-y-1 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-text-secondary" role="status" aria-live="polite">
      <div className="flex items-center gap-1.5">
        <Loader2 size={14} strokeWidth={2} className="animate-spin" /> {job.step ?? 'Queued'}…
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={job.progress ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-brand transition-all" style={{ width: `${job.progress ?? 0}%` }} />
      </div>
    </div>
  )
}

// The export menu of a screen (M6b): each item a document type and format;
// generation runs in the background, the file downloads when it is ready,
// and earlier versions stay available.
// The default label is "Documents" — screens keep their own "Export" buttons for quick sheets.
export default function DocumentExports({ orgId, projectId, buildingId, items, label = 'Documents', align = 'right' }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(null)
  const { job, start } = useDocumentJob(orgId, projectId)
  const typeKeys = [...new Set(items.map((i) => i.typeKey))].join(',')
  const loadHistory = useCallback(async () => {
    const lists = await Promise.all(typeKeys.split(',').map((k) => documentsApi.list(orgId, projectId, { buildingId, typeKey: k })))
    setHistory(lists.flatMap((l) => l.documents).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))).slice(0, 12))
  }, [orgId, projectId, buildingId, typeKeys])
  const showingHistory = Boolean(history)
  const ready = job?.status === 'ready'
  useEffect(() => {
    if (ready && showingHistory) loadHistory()
  }, [ready, showingHistory, loadHistory])
  return (
    <div className="relative" data-testid="document-exports">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-touch items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-text hover:border-brand sm:h-9">
        <Download size={15} strokeWidth={2} /> {label} <ChevronDown size={14} strokeWidth={2} />
      </button>
      {open && (
        <div className={`absolute z-40 mt-1 w-[min(22rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-border bg-surface p-2 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`} role="menu">
          {items.map((it) => (
            <button
              key={`${it.typeKey}-${it.format}-${it.options?.prices ?? ''}`}
              type="button"
              role="menuitem"
              disabled={job && !['ready', 'failed'].includes(job.status)}
              onClick={() => start({ buildingId, typeKey: it.typeKey, format: it.format, options: it.options ?? {} })}
              className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm text-text hover:bg-surface-muted disabled:opacity-50"
            >
              <span>{it.label}</span>
              <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">{FORMAT_LABEL[it.format]}</span>
            </button>
          ))}
          <JobStatus job={job} orgId={orgId} projectId={projectId} />
          <button type="button" onClick={() => (history ? setHistory(null) : loadHistory())} className="flex items-center gap-1 px-2.5 text-xs font-medium text-brand">
            <History size={13} strokeWidth={2} /> {history ? 'Hide' : 'Show'} earlier versions
          </button>
          {history && (
            <ul className="max-h-56 space-y-1 overflow-y-auto px-1 text-xs" aria-label="Earlier versions">
              {history.length === 0 && <li className="text-text-secondary">None yet.</li>}
              {history.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-text-secondary">
                    {d.fileName} · {d.requestedBy} · {new Date(d.requestedAt).toLocaleDateString()}
                  </span>
                  {d.status === 'ready' ? (
                    <a className="shrink-0 font-medium text-brand" href={documentsApi.downloadUrl(orgId, projectId, d.id)} download={d.fileName}>
                      {humanSize(d.sizeBytes)}
                    </a>
                  ) : (
                    <span className={`shrink-0 ${d.status === 'failed' ? 'text-status-red' : 'text-text-secondary'}`}>{d.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
