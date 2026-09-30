import { AlertTriangle, CheckCircle2 } from 'lucide-react'

export default function ValidationResultsPanel({ findings, onSelectFinding }) {
  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-status-green/30 bg-status-green/10 p-4 text-sm font-medium text-status-green">
        <CheckCircle2 size={18} strokeWidth={2} />
        Structure validated — no issues found.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <AlertTriangle size={16} strokeWidth={2} className="text-status-red" />
        {findings.length} validation issue{findings.length === 1 ? '' : 's'}
      </div>
      <ul className="space-y-1.5">
        {findings.map((finding) => (
          <li key={finding.id}>
            <button
              type="button"
              onClick={() => onSelectFinding(finding)}
              disabled={!finding.objectId}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent"
            >
              <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-amber" />
              <span className={finding.objectId ? 'text-brand underline-offset-2 hover:underline' : 'text-text'}>
                {finding.message}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
