import { useState } from 'react'
import { QrCode, X } from 'lucide-react'
import { LABEL_SIZES } from '@rackium/shared/documents/labels.js'
import { JobStatus } from './DocumentExports.jsx'
import { useDocumentJob } from './documentJob.js'

// Printable QR cable labels (M6b): the chosen cables, both ends, on the
// chosen label stock. connections: [{ id, title, cableIds: [] }].
// `preselected`: connection ids to start with (a reprint-label task, M7b-2);
// default every connection.
export default function LabelPrintDialog({ orgId, projectId, buildingId, connections, preselected = null, onClose }) {
  const [chosen, setChosen] = useState(() => new Set(connections.map((c) => c.id).filter((id) => !preselected || preselected.includes(id))))
  const [size, setSize] = useState(LABEL_SIZES[0].key)
  const { job, start } = useDocumentJob(orgId, projectId)
  const busy = job && !['ready', 'failed'].includes(job.status)
  const toggle = (id) =>
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const labelCount = connections.filter((c) => chosen.has(c.id)).reduce((n, c) => n + Math.max(1, c.cableIds.length) * 2, 0)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Print cable labels">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 rounded-t-2xl bg-surface p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-text">
            <QrCode size={18} strokeWidth={2} className="text-brand" /> Print cable labels
          </h2>
          <button type="button" className="flex h-touch w-11 items-center justify-center rounded-lg text-text-secondary" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <label className="text-xs text-text-secondary">
          Label stock
          <select className="mt-1 h-touch w-full rounded-lg border border-border bg-surface px-2 text-sm text-text" value={size} onChange={(e) => setSize(e.target.value)}>
            {LABEL_SIZES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>
            {chosen.size} of {connections.length} connection(s) · {labelCount} label(s) — one for each end
          </span>
          <button type="button" className="font-medium text-brand" onClick={() => setChosen(chosen.size === connections.length ? new Set() : new Set(connections.map((c) => c.id)))}>
            {chosen.size === connections.length ? 'None' : 'All'}
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-border p-2" aria-label="Connections">
          {connections.map((c) => (
            <li key={c.id}>
              <label className="flex min-h-[40px] items-center gap-2 text-sm text-text">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="min-w-0">
                  <span className="block truncate">{c.title}</span>
                  <span className="block font-mono text-xs text-text-secondary">{c.cableIds.join(', ') || 'no cable ID yet'}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-text-secondary">Each QR code opens the connection in Rackium — sign-in required, and only for people whose scope includes this building.</p>
        <JobStatus job={job} orgId={orgId} projectId={projectId} />
        <div className="flex justify-end gap-2">
          <button type="button" className="h-touch rounded-lg border border-border px-4 text-sm" onClick={onClose}>
            Close
          </button>
          <button type="button" disabled={busy || chosen.size === 0} className="h-touch rounded-lg bg-brand px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => start({ buildingId, typeKey: 'cable-labels', format: 'pdf', options: { labelSize: size, connectionIds: [...chosen] } })}>
            Create label sheet
          </button>
        </div>
      </div>
    </div>
  )
}
