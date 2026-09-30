import { Flag } from 'lucide-react'

function KpiItem({ label, value, progress }) {
  return (
    <div className="flex flex-col gap-1 py-3 px-4 sm:px-5">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-lg font-semibold text-text">{value}</span>
      {progress !== undefined && (
        <div className="mt-1 h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}

export default function KpiStrip({ items, nextMilestone }) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        {items.map((item) => (
          <KpiItem key={item.label} {...item} />
        ))}
      </div>
      {nextMilestone && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm text-brand sm:px-5">
          <Flag size={15} strokeWidth={2} />
          <span>
            Next milestone: <span className="font-medium">{nextMilestone}</span>
          </span>
        </div>
      )}
    </div>
  )
}
