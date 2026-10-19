import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import StatusChip from '../StatusChip.jsx'
import { RiskBadge } from './Badges.jsx'

const byDue = (x, y) => (x.dueDate < y.dueDate ? -1 : x.dueDate > y.dueDate ? 1 : 0)

// The schedule as a list (read-only): the Gantt's table view on wide
// screens, and the whole schedule on phones (below 768 px). One card per
// building, its phases in order with start → target, status and risk.
export default function ScheduleList({ view }) {
  const critical = new Set(view.critical)
  return (
    <div className="space-y-3" data-testid="schedule-list">
      {view.buildings.map((b) => {
        const bars = view.bars.filter((x) => x.buildingId === b.id)
        const next = view.milestones.filter((m) => m.buildingId === b.id && m.dueDate && !m.done).sort(byDue)[0]
        return (
          <section key={b.id} className="rounded-xl border border-border bg-surface p-3">
            <h3 className="text-sm font-semibold text-text">
              {b.code}
              {b.name && <span className="font-normal text-text-secondary"> · {b.name}</span>}
            </h3>
            <ol className="mt-2 divide-y divide-border/60">
              {bars.map((bar) => (
                <li key={bar.key} className="grid gap-y-1 py-1.5 text-xs sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-x-3" data-row={bar.key}>
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-text">
                      {PHASE_LABELS[bar.phaseKey]}
                      {critical.has(bar.key) && <span className="ml-1.5 rounded border border-text px-1 text-[10px] font-semibold">Critical</span>}
                    </span>
                  </span>
                  <span className="text-text-secondary">
                    {bar.target ? `${bar.start ?? '—'} → ${bar.target}` : 'No target'}
                    {bar.completedOn && ` · done ${bar.completedOn}`}
                    {!bar.completedOn && !bar.dateKnown && ' · done (date unknown)'}
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusChip status={bar.status} size="sm" />
                    <RiskBadge risk={bar.risk} />
                  </span>
                </li>
              ))}
            </ol>
            {next && (
              <p className="mt-2 text-[11px] text-text-secondary">
                Next milestone: {next.name} · {next.dueDate}
              </p>
            )}
          </section>
        )
      })}
      {view.buildings.length === 0 && <p className="text-sm text-text-secondary">No buildings in your scope.</p>}
    </div>
  )
}
