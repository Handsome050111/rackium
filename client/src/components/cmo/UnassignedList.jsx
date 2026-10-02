import { AlertTriangle } from 'lucide-react'

// SAL-level list (brief D39: "Devices with no building go to Unassigned at
// SAL level"). Shown regardless of which building the PM is currently
// looking at, since these devices don't belong to one yet.
export default function UnassignedList({ devices, buildings, editable, onAssign }) {
  if (devices.length === 0) {
    return (
      <div className="rounded-xl border border-status-green/30 bg-status-green/5 p-4 text-xs text-status-green">No unassigned devices — every imported device has a building.</div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-status-amber/40 bg-status-amber/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-status-amber">
        <AlertTriangle size={16} strokeWidth={2} />
        Unassigned at SAL ERL ({devices.length})
      </div>
      <p className="text-xs text-text-secondary">These devices have no building and count as an open blocker until the PM assigns them.</p>
      <div className="space-y-1.5">
        {devices.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <div>
              <div className="text-xs font-medium text-text">{d.hostname ?? '(no hostname)'}</div>
              <div className="text-[11px] text-text-secondary">
                {d.model ?? '—'} · Serial {d.serial}
              </div>
            </div>
            {editable ? (
              <select
                defaultValue=""
                onChange={(e) => e.target.value && onAssign(d.id, e.target.value)}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none"
              >
                <option value="" disabled>
                  Assign to building…
                </option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] text-text-secondary">PM assigns this device</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
