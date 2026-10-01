import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import { RESOURCE_TASKS } from '../../lib/billOfResources.js'

// Solution Package Section 17 — tasks x PM-editable standard minutes =
// estimated hours per room and total (brief: no labour cost).
export default function ResourceEstimatePanel({ estimate, minutesById, editable, onSetMinutes }) {
  const [edited, setEdited] = useState({})

  function save(taskId, raw) {
    const minutes = Number(raw)
    if (Number.isFinite(minutes) && minutes >= 0) onSetMinutes(taskId, minutes)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Clock3 size={16} strokeWidth={2} className="text-brand" />
        Bill of Resources — {estimate.totalHours} h total
      </div>

      <div className="space-y-1.5">
        {RESOURCE_TASKS.map((t) => {
          const count = estimate.totalsByTask[t.id] ?? 0
          if (count === 0) return null
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-text-secondary">
                {t.label} × {count}
              </span>
              <span className="flex items-center gap-1">
                {editable ? (
                  <input
                    type="number"
                    min="0"
                    defaultValue={edited[t.id] ?? minutesById[t.id] ?? t.defaultMinutes}
                    onBlur={(e) => {
                      setEdited((m) => ({ ...m, [t.id]: e.target.value }))
                      save(t.id, e.target.value)
                    }}
                    className="h-6 w-14 rounded border border-border px-1 text-right text-xs focus:border-brand focus:outline-none"
                  />
                ) : (
                  <span className="font-medium text-text">{minutesById[t.id] ?? t.defaultMinutes}</span>
                )}
                <span className="text-text-secondary">min</span>
              </span>
            </div>
          )
        })}
      </div>

      <div className="border-t border-border pt-2">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">By room</div>
        {Object.entries(estimate.byRoomMinutes).map(([room, minutes]) => (
          <div key={room} className="flex items-center justify-between text-xs">
            <span className="text-text-secondary">{room}</span>
            <span className="font-medium text-text">{Math.round((minutes / 60) * 10) / 10} h</span>
          </div>
        ))}
      </div>
    </div>
  )
}
