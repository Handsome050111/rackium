import { useMemo, useState } from 'react'
import { Download, X } from 'lucide-react'
import RackElevation from '../RackElevation.jsx'
import { buildPortTrace } from '../../lib/cmdbModel.js'
import { exportConnectionsXlsx } from '../../lib/cmdbExport.js'

// Brief Step 8: the render's "All (48) = 40 patched + 2 uplinks + 6 free"
// folds the uplink-module ports into the 48 access-port total, which is
// wrong — uplink ports are a separate pool (lib/portMap.js never mixes
// them). "All" here is the true union of both pools; access and uplink
// counts are never conflated.
const FILTERS = ['All', 'Patched', 'Free', 'Uplinks']

export default function PortConnectivityView({ context, onClose }) {
  const { entity, access, modules, placements, rack, freeRuByFace, entityById } = context
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [selectedPort, setSelectedPort] = useState(null)

  const allPorts = [...access, ...modules]
  const patchedCount = allPorts.filter((p) => p.state === 'Patched' || p.state === 'Uplink').length
  const freeCount = access.filter((p) => p.state === 'Free').length

  const filtered = useMemo(() => {
    let rows = allPorts
    if (filter === 'Patched') rows = access.filter((p) => p.state === 'Patched')
    else if (filter === 'Free') rows = access.filter((p) => p.state === 'Free')
    else if (filter === 'Uplinks') rows = modules
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((p) => [p.port, p.cableId, p.destination].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, access, modules])

  const selectedRow = allPorts.find((p) => p.port === selectedPort)
  const trace = selectedRow?.cableId ? buildPortTrace({ source: { deviceId: entity.id, port: selectedRow.port }, dest: { deviceId: null, port: null }, cableId: selectedRow.cableId, hops: [] }, entityById) : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-text">
          {entity.hostname} — Port Connectivity
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
          <X size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
        <span>
          Access ports: <strong className="text-text">{access.length}</strong>
        </span>
        <span>
          Uplink module ports: <strong className="text-text">{modules.length}</strong>
        </span>
        <span>
          Patched: <strong className="text-text">{patchedCount}</strong>
        </span>
        <span>
          Free: <strong className="text-text">{freeCount}</strong>
        </span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <RackElevation rack={rack} placements={placements} mode="view" selectionBadges={{ [entity.id]: 'SEL' }} freeRuByFace={freeRuByFace} />
        </div>

        <div className="w-full shrink-0 space-y-2 lg:w-96">
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`h-8 rounded-lg border px-2.5 text-xs font-medium ${filter === f ? 'border-brand bg-brand text-white' : 'border-border text-text hover:border-brand/40'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by port, panel or cable ID…"
            className="h-8 w-full rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none"
          />

          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-surface-muted">
                <tr className="border-b border-border text-text-secondary">
                  {['Port', 'State', 'Destination', 'Cable ID', 'Medium', 'Validation'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.port}
                    onClick={() => setSelectedPort(p.port)}
                    className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-muted ${selectedPort === p.port ? 'bg-brand/10' : ''}`}
                  >
                    <td className="whitespace-nowrap px-2 py-1 font-medium text-text">{p.port}</td>
                    <td className="whitespace-nowrap px-2 py-1">
                      <span className={p.state === 'Free' ? 'text-text-secondary' : 'text-status-green'}>{p.state}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{p.destination}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{p.cableId ?? '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{p.medium}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-secondary">{p.validation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {trace && (
            <div className="rounded-lg border border-border bg-surface-muted p-2.5 text-xs">
              <div className="mb-1 font-semibold text-text">Trace — {selectedPort}</div>
              <div className="flex flex-wrap items-center gap-1 text-text-secondary">
                {trace.map((step, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className={step.isCable ? 'rounded bg-surface px-1 text-[10px]' : ''}>{step.label}</span>
                    {i < trace.length - 1 && <span>→</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => exportConnectionsXlsx(allPorts, `${entity.hostname}-port-connectivity.xlsx`)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-xs font-medium text-text hover:border-brand"
          >
            <Download size={13} strokeWidth={2} />
            Export connections
          </button>
        </div>
      </div>
    </div>
  )
}
