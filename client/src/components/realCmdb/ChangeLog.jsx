const KIND = {
  operational_change: { label: 'Operational change', tone: 'bg-status-amber/10 text-status-amber' },
  as_built: { label: 'Deployment', tone: 'bg-status-green/10 text-status-green' },
  import: { label: 'Import', tone: 'bg-purple-50 text-purple-700' },
}
const show = (v) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))

// The CMDB records' history (client audit 9.1): installation, acceptance,
// operational changes and imports, newest first, with field-level changes.
export default function ChangeLog({ entries, nameOf }) {
  if (!entries.length) return <p className="text-sm text-text-secondary">No changes yet.</p>
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface" aria-label="Change log">
      {entries.map((e) => {
        const kind = KIND[e.changeType] ?? { label: e.changeType, tone: 'bg-surface-muted text-text-secondary' }
        return (
          <li key={e.id} className="space-y-1 px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kind.tone}`}>{kind.label}</span>
              <span className="font-medium text-text">{e.action}</span>
              <span className="text-text-secondary">{nameOf(e.objectId) ?? ''}</span>
              <span className="ml-auto text-text-secondary">
                {e.actor ?? 'System'}
                {e.role ? ` (${e.role})` : ''} · {new Date(e.occurredAt).toLocaleString()}
              </span>
            </div>
            {e.comment && <div className="text-text-secondary">{e.comment}</div>}
            {e.changes.length > 0 && (
              <ul className="space-y-0.5 pl-2 text-text-secondary">
                {e.changes.slice(0, 8).map((c, i) => (
                  <li key={i} className="break-all">
                    <span className="font-medium text-text">{c.field}</span>: {show(c.before)} → {show(c.after)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
