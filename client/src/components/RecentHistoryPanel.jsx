import { ArrowRight, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatRelativeTime } from '@rackium/shared/time.js'

export default function RecentHistoryPanel({ items, buildingId }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <History size={16} strokeWidth={2} className="text-brand" />
        Recent history
      </div>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-text">{item.label}</span>
            <span className="shrink-0 text-xs text-text-secondary">{formatRelativeTime(item.at)}</span>
          </li>
        ))}
      </ul>
      <Link
        to={`/b/${buildingId}/activity`}
        className="mt-4 flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        View full history
        <ArrowRight size={14} strokeWidth={2} />
      </Link>
    </div>
  )
}
