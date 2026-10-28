import { useState } from 'react'
import { PackageMinus } from 'lucide-react'
import { DEFAULT_MODE_LABELS } from '@rackium/shared/modeState.js'

// After cutover (M7b-4b, DATA-MODEL §5.22): the interim kit and the CMO gear
// the HLD marks Replace or Remove, each removed by the Field Engineer once the
// new network runs (`onRemove(id, note)`). Removed ones stay listed.
export default function CutoverRemovals({ removals, labels = DEFAULT_MODE_LABELS, canRemove, onRemove }) {
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)
  if (!removals?.length) return null
  const left = removals.filter((r) => !r.removed).length
  const what = (r) => (r.kind === 'interim' ? labels.interim : r.decision?.decision === 'replace' ? `${labels.current} · replaced by ${r.decision.replacedByName ?? 'a new device'}` : `${labels.current} · remove`)
  return (
    <section data-testid="cutover-removals" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <PackageMinus size={16} strokeWidth={2} className="text-brand" />
        <h2 className="text-sm font-semibold text-text">After cutover: remove</h2>
        <span className="text-xs text-text-secondary">{left ? `${left} of ${removals.length} still to remove` : 'All removed'}</span>
      </div>
      <ul className="divide-y divide-border">
        {removals.map((r) => (
          <li key={r.id} data-testid={`removal-${r.id}`} className="flex flex-col gap-2 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="break-all font-medium text-text">{r.label}</div>
              <div className="text-text-secondary">
                {what(r)}
                {r.roomCode ? ` · ${r.roomCode}` : ''}
                {r.rackCode ? ` · ${r.rackCode}` : ''}
                {' · '}
                <span className={r.removed ? 'text-status-green' : ''}>{r.removed ? `Removed${r.removedBy ? ` by ${r.removedBy}` : ''}` : r.onSite ? 'On site' : r.statusLabel}</span>
              </div>
            </div>
            {canRemove && !r.removed && (r.onSite || r.kind === 'cmo') && (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setBusy(r.id)
                  await onRemove(r.id, notes[r.id]?.trim() || undefined)
                  setBusy(null)
                }}
              >
                <input value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={500} placeholder="Note (optional)" aria-label={`Removal note for ${r.label}`} className="h-touch min-w-0 rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none sm:h-8 sm:w-44" />
                <button type="submit" disabled={busy === r.id} className="h-touch rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5 disabled:cursor-not-allowed sm:h-8">
                  Mark removed
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
