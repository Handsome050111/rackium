import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const TONE = { open: 'text-status-amber', accepted: 'text-status-green', rejected: 'text-status-red', corrected: 'text-text-secondary', superseded: 'text-text-secondary' }
const LABEL = { open: 'Open', accepted: 'Accepted', rejected: 'Rejected', corrected: 'Corrected', superseded: 'Superseded' }

// The building's exception register (brief §5.7): every logged difference
// from the frozen LLD, designed vs installed, reason, who logged and who
// reviewed it. A Reviewer or PM accepts or rejects open ones.
export default function ExceptionRegister({ exceptions, canReview, onReview, onSelectDevice }) {
  const [filter, setFilter] = useState('open')
  const [notes, setNotes] = useState({})
  const shown = filter === 'all' ? exceptions : exceptions.filter((e) => e.status === filter)
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Exception register">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle size={16} strokeWidth={2} className="text-status-amber" />
        <h2 className="text-sm font-semibold text-text">Exception register</h2>
        <select className="ml-auto h-9 rounded-lg border border-border bg-surface px-2 text-sm text-text" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show exceptions">
          <option value="open">Open ({exceptions.filter((e) => e.status === 'open').length})</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="all">All ({exceptions.length})</option>
        </select>
      </div>
      {shown.length === 0 ? (
        <p className="text-xs text-text-secondary">No {filter === 'all' ? '' : `${LABEL[filter]?.toLowerCase()} `}exceptions.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((e) => (
            <li key={e.id} className="space-y-1.5 py-2.5 text-sm" data-testid={`exception-${e.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => onSelectDevice(e.deviceId)}>
                  {e.deviceName}
                </button>
                <span className="text-text">{e.label}</span>
                <span className="text-text-secondary">
                  designed <strong className="text-text">{e.designedValue}</strong> → installed <strong className="text-text">{e.installedValue}</strong>
                </span>
                <span className={`ml-auto text-xs font-semibold ${TONE[e.status]}`}>{LABEL[e.status]}</span>
              </div>
              <div className="text-xs text-text-secondary">
                “{e.reason}” — {e.loggedBy}, {new Date(e.loggedAt).toLocaleString()}
                {e.photoFileIds.length > 0 && ` · ${e.photoFileIds.length} photo(s)`}
              </div>
              {e.reviewedBy && (
                <div className="text-xs text-text-secondary">
                  {LABEL[e.status]} by {e.reviewedBy}
                  {e.reviewNote ? ` — ${e.reviewNote}` : ''}
                </div>
              )}
              {canReview && e.status === 'open' && (
                <div className="flex flex-wrap items-center gap-2">
                  <input className="h-touch min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-sm" placeholder="Note (required to reject)" aria-label="Review note" value={notes[e.id] ?? ''} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} />
                  <button type="button" className="h-touch rounded-lg bg-status-green px-3 text-sm font-semibold text-white" onClick={() => onReview(e, 'accepted', notes[e.id] ?? '')}>
                    Accept
                  </button>
                  <button type="button" className="h-touch rounded-lg border border-status-red px-3 text-sm font-semibold text-status-red disabled:opacity-50" disabled={!(notes[e.id] ?? '').trim()} onClick={() => onReview(e, 'rejected', notes[e.id])}>
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
