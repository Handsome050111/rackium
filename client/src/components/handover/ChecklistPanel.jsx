import { useState } from 'react'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

// Brief v2.2 §3.11's "Pre-compilation checklist (auto-evaluated)" — every
// line calculated from the real phase data, never hand-ticked. M7b-4b: CMO
// gear left on site after cutover is a warning the PM may meet by keeping it
// with a reason (`onKeepOldGear(reason | null)`), or withdraw.
export default function ChecklistPanel({ checklist, canKeepOldGear = false, onKeepOldGear = null }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-text">Pre-compilation checklist</div>
      <ul className="space-y-1.5">
        {checklist.map((item) => (
          <li key={item.id} className="space-y-2 text-xs" data-testid={`checklist-${item.id}`}>
            <div className="flex items-start gap-2">
              {item.ok ? (
                <CheckCircle2 size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-green" />
              ) : (
                <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-amber" />
              )}
              <span className="min-w-0 break-words">
                <span className="text-text">{item.label}</span>
                <span className="text-text-secondary"> — {item.detail}</span>
              </span>
            </div>
            {canKeepOldGear && onKeepOldGear && item.overridable && <KeepOnSite item={item} onKeep={onKeepOldGear} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function KeepOnSite({ item, onKeep }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (value) => {
    setBusy(true)
    await onKeep(value)
    setBusy(false)
  }
  if (item.override && item.ok) {
    return (
      <button type="button" disabled={busy} onClick={() => run(null)} className="ml-6 h-touch rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:text-text sm:h-8">
        Withdraw keeping it on site
      </button>
    )
  }
  return (
    <form
      className="ml-6 flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault()
        run(reason.trim())
      }}
    >
      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why it stays on site" aria-label="Reason to keep it on site" className="h-touch min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none sm:h-8" />
      <button type="submit" disabled={busy || !reason.trim()} className="h-touch rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-8">
        Keep on site
      </button>
    </form>
  )
}
