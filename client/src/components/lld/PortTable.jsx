import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { paginate, DEPLOYMENT_PLACEHOLDER } from '../../lib/lldModel.js'

export const PORT_COLUMNS = {
  port: { label: 'Port', cell: (r) => <span className="font-medium text-text">{r.port}</span> },
  type: { label: 'Type', cell: (r) => r.type },
  status: { label: 'Status', cell: (r) => <PortStatus value={r.status} /> },
  destination: { label: 'Destination', cell: (r) => r.destination },
  patchPanelPort: { label: 'Patch-panel port', cell: (r) => r.patchPanelPort },
  cableId: {
    label: 'Cable ID',
    cell: (r) => (r.connectionId ? (r.cableId ?? <span className="text-status-amber">Pending</span>) : '—'),
  },
  media: { label: 'Media', cell: (r) => r.media },
  speed: { label: 'Speed', cell: (r) => r.speed },
  vlan: { label: 'VLAN (mock)', cell: (r) => r.vlan },
  poe: { label: 'PoE', cell: (r) => r.poe },
}

function PortStatus({ value }) {
  return <span className={value === 'Designed' ? 'text-status-green' : 'text-text-secondary'}>{value}</span>
}

export function Pagination({ view, onPage }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-text-secondary">
      <span>
        Showing {view.from}–{view.to} of {view.total}
      </span>
      {view.pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={view.page <= 1}
            onClick={() => onPage(view.page - 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border disabled:opacity-40"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="px-1">
            Page {view.page} / {view.pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={view.page >= view.pageCount}
            onClick={() => onPage(view.page + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border disabled:opacity-40"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// One port group (access ports, or uplink module ports, …) as its own
// paginated table — groups are never merged, and only the rows passed in
// (the device's real ports) are ever rendered.
export default function PortTable({ title, rows, columns, pageSize = 8, highlightPort = null }) {
  const [page, setPage] = useState(1)
  const view = paginate(rows, page, pageSize)
  const cols = columns.map((key) => PORT_COLUMNS[key])

  return (
    <div className="overflow-hidden rounded-lg border border-border" data-testid={`port-table-${title}`}>
      <div className="border-b border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-text">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              {cols.map((c) => (
                <th key={c.label} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.items.map((row) => (
              <tr key={row.port} className={`border-b border-border/60 last:border-0 ${row.port === highlightPort ? 'bg-brand/10' : ''}`}>
                {cols.map((c) => (
                  <td key={c.label} className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination view={view} onPage={setPage} />
    </div>
  )
}

export function DeploymentValue() {
  return <span className="italic text-text-secondary">{DEPLOYMENT_PLACEHOLDER}</span>
}
