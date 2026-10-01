import { ArrowDown } from 'lucide-react'
import PortTable from './PortTable.jsx'

// Border: a direct table of its downstream uplinks (one row per Edge).
// Edge: the full access-port mapping, reusing the same paginated PortTable
// as the Port Schedule tab so the two never disagree.
export default function DownstreamPanel({ device, downstream, portGroups, onOpenEditor }) {
  if (device.role === 'border') {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <ArrowDown size={16} strokeWidth={2} className="text-brand" />
          Downstream port mapping ({downstream.length})
        </div>
        {downstream.length === 0 ? (
          <p className="text-xs text-text-secondary">No downstream uplinks designed yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-max text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-text-secondary">
                  <th className="px-3 py-2 font-medium">Source port</th>
                  <th className="px-3 py-2 font-medium">Destination</th>
                  <th className="px-3 py-2 font-medium">Edge port</th>
                  <th className="px-3 py-2 font-medium">Cable ID</th>
                </tr>
              </thead>
              <tbody>
                {downstream.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5 font-medium text-text">{row.source.port}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{row.dest.entity.label}</td>
                    <td className="px-3 py-1.5 text-text-secondary">{row.dest.port}</td>
                    <td className="px-3 py-1.5">
                      {row.cableId ?? <span className="text-status-amber">Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  const access = portGroups.find((g) => g.id === 'access')

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <ArrowDown size={16} strokeWidth={2} className="text-brand" />
          {access ? access.label.replace('Access ports', 'Access-port mapping') : 'Access-port mapping'}
        </div>
        <button
          type="button"
          onClick={onOpenEditor}
          className="h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-text hover:border-brand"
        >
          + Add patching details
        </button>
      </div>
      {access ? (
        <PortTable
          title={access.label}
          rows={access.rows}
          columns={['port', 'destination', 'patchPanelPort', 'cableId', 'status']}
          pageSize={8}
        />
      ) : (
        <p className="text-xs text-text-secondary">This device has no access ports.</p>
      )}
    </div>
  )
}
