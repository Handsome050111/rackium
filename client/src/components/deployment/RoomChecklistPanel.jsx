import { ClipboardList } from 'lucide-react'

// Step 8: "Bill of Resources tasks from Step 7 appear as the installation
// checklist per room" — same task list and counts, just reporting actual
// deployment progress against the calculated total instead of an estimate.
export default function RoomChecklistPanel({ roomChecklists }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <ClipboardList size={16} strokeWidth={2} className="text-brand" />
        Installation checklist by room
      </div>
      <div className="space-y-3">
        {roomChecklists.map((room) => (
          <div key={room.room}>
            <div className="mb-1 text-xs font-semibold text-text-secondary">{room.room}</div>
            <div className="space-y-1">
              {room.tasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-xs">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                    <div className={`h-full ${t.done === t.total ? 'bg-status-green' : 'bg-brand'}`} style={{ width: `${t.total === 0 ? 0 : (t.done / t.total) * 100}%` }} />
                  </div>
                  <span className="w-32 shrink-0 text-text-secondary">{t.label}</span>
                  <span className="w-10 shrink-0 text-right font-medium text-text">
                    {t.done}/{t.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
