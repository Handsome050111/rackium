import { CheckCircle2, AlertTriangle } from 'lucide-react'

export default function ValidationResultsTable({ areas, onAccept, canAccept }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-text-secondary">
            {['#', 'Validation area', 'Description', 'Checks', 'Result', 'Action'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {areas.map((a, i) => (
            <tr key={a.id} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{i + 1}</td>
              <td className="px-3 py-1.5 font-medium text-text">{a.name}</td>
              <td className="px-3 py-1.5 text-text-secondary">{a.description}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                {a.passed}/{a.total}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                {a.result === 'passed' ? (
                  <span className="flex items-center gap-1.5 font-medium text-status-green">
                    <CheckCircle2 size={13} strokeWidth={2} /> Passed
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-status-amber">
                    <AlertTriangle size={13} strokeWidth={2} /> Warning
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                {a.result !== 'passed' && canAccept && (
                  <button type="button" onClick={() => onAccept(a)} className="rounded border border-border px-2 py-1 text-[11px] font-medium text-brand hover:border-brand">
                    Accept
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
