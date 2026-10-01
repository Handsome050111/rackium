import { AlertTriangle, Info } from 'lucide-react'

export default function AcceptedWarningsTable({ warnings }) {
  if (warnings.length === 0) return null
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-text">Accepted warnings</div>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-text-secondary">
            <th className="py-1.5 pr-3 font-medium">#</th>
            <th className="py-1.5 pr-3 font-medium">Warning</th>
            <th className="py-1.5 font-medium">Accepted by</th>
          </tr>
        </thead>
        <tbody>
          {warnings.map((w, i) => (
            <tr key={w.id} className="border-b border-border/60 last:border-0">
              <td className="py-1.5 pr-3 text-text-secondary">{i + 1}</td>
              <td className="py-1.5 pr-3 text-text">
                <span className="flex items-start gap-1.5">
                  <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0 text-status-amber" />
                  {w.text}
                </span>
              </td>
              <td className="py-1.5 text-text-secondary">{w.acceptedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
        <Info size={12} strokeWidth={2} />
        Warnings are documented and do not prevent technical submission.
      </p>
    </div>
  )
}
