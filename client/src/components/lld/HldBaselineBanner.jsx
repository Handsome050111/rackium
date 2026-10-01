import { useState } from 'react'
import { AlertTriangle, GitCompare } from 'lucide-react'

// "LLD based on HLD v[n]" (brief v2.3 §5.4). No automatic re-sync (D17):
// when HLD has moved on, the Architect reviews what changed and then
// explicitly re-baselines.
export default function HldBaselineBanner({ hld, canEdit, onRebase }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <GitCompare size={14} className="text-brand" />
        <span data-testid="lld-hld-baseline" className="font-medium text-text">
          Based on HLD v{hld.basedOnVersion}
        </span>
        {hld.status !== 'approved' && (
          <span className="rounded border border-status-amber/40 px-1.5 py-0.5 text-status-amber">
            HLD not approved yet ({hld.status.replace('_', ' ')})
          </span>
        )}
      </div>

      {hld.stale && (
        <div role="alert" className="rounded-xl border border-status-amber/50 bg-status-amber/5 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2 text-text">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-status-amber" />
              <span>
                <strong>HLD changed after LLD started.</strong> This LLD is based on HLD v{hld.basedOnVersion}; the current HLD is v
                {hld.currentVersion}. Review the changes and update the LLD manually — nothing is re-synced automatically.
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="h-touch rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
              >
                {open ? 'Hide changes' : 'Review changes'}
              </button>
              {canEdit && (
                <button
                  type="button"
                  onClick={onRebase}
                  className="h-touch rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
                >
                  Mark reviewed against HLD v{hld.currentVersion}
                </button>
              )}
            </div>
          </div>
          {open && (
            <ul className="mt-3 space-y-1 border-t border-status-amber/30 pt-3 text-xs text-text-secondary">
              {hld.changesSince.map((change) => (
                <li key={change.version}>
                  <span className="font-medium text-text">HLD v{change.version}</span> — {change.summaries.join('; ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
