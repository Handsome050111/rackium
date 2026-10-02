import { CheckCircle2, AlertTriangle } from 'lucide-react'

// Brief v2.2 §3.11's "Pre-compilation checklist (auto-evaluated)" — every
// line calculated from the real phase data, never hand-ticked.
export default function ChecklistPanel({ checklist }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-surface p-4">
      <div className="text-sm font-semibold text-text">Pre-compilation checklist</div>
      <ul className="space-y-1.5">
        {checklist.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-xs">
            {item.ok ? (
              <CheckCircle2 size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-green" />
            ) : (
              <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-status-amber" />
            )}
            <span>
              <span className="text-text">{item.label}</span>
              <span className="text-text-secondary"> — {item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
