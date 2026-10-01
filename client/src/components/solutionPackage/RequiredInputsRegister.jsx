import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react'

const STATUS_META = {
  not_started: { label: 'Input required', icon: AlertTriangle, color: 'text-status-amber' },
  in_progress: { label: 'In progress', icon: Circle, color: 'text-status-amber' },
  complete: { label: 'Completed', icon: CheckCircle2, color: 'text-status-green' },
}

export default function RequiredInputsRegister({ groups, selectedId, onSelect }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-text-secondary">
            {['#', 'Input group', 'Owner', 'Status', 'Due date', 'Action'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const meta = STATUS_META[g.status]
            const Icon = meta.icon
            return (
              <tr key={g.id} className={`border-b border-border/60 last:border-0 ${selectedId === g.id ? 'bg-brand/5' : ''}`}>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{g.n}</td>
                <td className="px-3 py-1.5 font-medium text-text">{g.name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{g.owner ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={`flex items-center gap-1.5 font-medium ${meta.color}`}>
                    <Icon size={13} strokeWidth={2} />
                    {meta.label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{g.dueDate ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <button type="button" onClick={() => onSelect(g.id)} className="rounded border border-border px-2 py-1 text-[11px] font-medium text-brand hover:border-brand">
                    Open
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
