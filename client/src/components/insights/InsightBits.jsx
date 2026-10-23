import { formatMinor } from '../../lib/money.js'
import { phaseName } from '../../lib/insightsFormat.js'

const th = 'px-3 py-2 font-medium'

// The BOM value — present only for those who may see prices (the server
// leaves it out for everyone else).
export function BomValue({ value }) {
  if (!value) return null
  if (!value.buildings && !value.projects) return <span className="text-text-secondary">No BOM yet</span>
  return (
    <span className="whitespace-nowrap">
      {formatMinor(value.sellMinor, value.currency ?? 'EUR')} <span className="text-xs text-text-secondary">client · {formatMinor(value.costMinor, value.currency ?? 'EUR')} cost</span>
    </span>
  )
}

export function PeopleTable({ people }) {
  if (!people.length) return <p className="px-4 py-3 text-sm text-text-secondary">No members yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="text-left text-xs text-text-secondary">
          <tr>
            <th className={th}>Person</th>
            <th className={th}>Buildings (current phase)</th>
            <th className={`${th} text-right`}>Open tasks</th>
            <th className={`${th} text-right`}>Overdue</th>
          </tr>
        </thead>
        <tbody>
          {people.map((x) => (
            <tr key={x.userId} className="border-t border-border/60" data-person={x.name}>
              <td className="px-3 py-2 text-text">
                {x.name} <span className="text-xs text-text-secondary">{x.role?.replace('_', ' ')}</span>
              </td>
              <td className="px-3 py-2 text-xs text-text-secondary">{x.assigned?.length ? x.assigned.map((a) => `${a.code} (${phaseName(a.currentPhase)})`).join(', ') : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{x.openTasks}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${x.overdueTasks ? 'font-semibold text-status-red' : ''}`}>{x.overdueTasks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
