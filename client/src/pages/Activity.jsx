import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { History } from 'lucide-react'
import { getRecentHistory } from '../api/index.js'
import { formatDateTime } from '@rackium/shared/time.js'

// Full activity log for a building. Uses the same mock history as the dashboard.
export default function Activity() {
  const { buildingId } = useParams()
  const [items, setItems] = useState(null)

  useEffect(() => {
    let active = true
    setItems(null)
    getRecentHistory(buildingId).then((history) => {
      if (active) setItems(history)
    })
    return () => {
      active = false
    }
  }, [buildingId])

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <h1 className="text-lg font-semibold text-text">Activity</h1>
      <div className="rounded-xl border border-border bg-surface p-4">
        {items === null && <p className="text-sm text-text-secondary">Loading…</p>}
        {items !== null && items.length === 0 && (
          <p className="py-6 text-center text-sm text-text-secondary">No activity yet</p>
        )}
        {items !== null && items.length > 0 && (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-text">
                  <History size={14} strokeWidth={2} className="shrink-0 text-brand" />
                  {item.label}
                </span>
                <span className="shrink-0 text-xs text-text-secondary">{formatDateTime(item.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
