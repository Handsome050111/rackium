import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { buildPortScheduleRows, filterPortScheduleRows, paginate } from '../../lib/lldModel.js'
import { exportPortScheduleXlsx } from '../../lib/lldExport.js'
import { Pagination } from './PortTable.jsx'

const EMPTY_FILTERS = { deviceId: '', roomCode: '', floorName: '', status: '', vlan: '' }
const PAGE_SIZE = 20

export default function PortScheduleTab({ portSchedule, buildingCode }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const allRows = useMemo(() => buildPortScheduleRows(portSchedule), [portSchedule])
  const filtered = useMemo(() => filterPortScheduleRows(allRows, filters), [allRows, filters])
  const view = paginate(filtered, page, PAGE_SIZE)

  const deviceOptions = useMemo(() => dedupe(portSchedule.map((e) => ({ value: e.device.id, label: e.device.label }))), [portSchedule])
  const roomOptions = useMemo(() => dedupe(allRows.map((r) => ({ value: r.roomCode, label: r.roomCode }))), [allRows])
  const floorOptions = useMemo(() => dedupe(allRows.map((r) => ({ value: r.floorName, label: r.floorName }))), [allRows])
  const statusOptions = useMemo(() => dedupe(allRows.map((r) => ({ value: r.status, label: r.status }))), [allRows])
  const vlanOptions = useMemo(() => dedupe(allRows.map((r) => ({ value: r.vlan, label: r.vlan }))), [allRows])

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Device" value={filters.deviceId} onChange={(v) => setFilter('deviceId', v)} options={deviceOptions} />
        <FilterSelect label="Room" value={filters.roomCode} onChange={(v) => setFilter('roomCode', v)} options={roomOptions} />
        <FilterSelect label="Floor" value={filters.floorName} onChange={(v) => setFilter('floorName', v)} options={floorOptions} />
        <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter('status', v)} options={statusOptions} />
        <FilterSelect label="VLAN" value={filters.vlan} onChange={(v) => setFilter('vlan', v)} options={vlanOptions} />
        <button
          type="button"
          onClick={() => exportPortScheduleXlsx(filtered, `${buildingCode}-port-schedule.xlsx`)}
          className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
        >
          <Download size={14} strokeWidth={2} />
          Export
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-secondary">
                {['Device', 'Interface', 'Type', 'Speed', 'Status', 'Connected To', 'Cable ID', 'VLAN (mock)', 'PoE'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.items.map((r) => (
                <tr key={r.rowKey} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{r.deviceLabel}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.port}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.type}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.speed}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className={r.status === 'Designed' ? 'text-status-green' : 'text-text-secondary'}>{r.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.destination}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {r.connectionId ? (r.cableId ?? <span className="text-status-amber">Pending</span>) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.vlan}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.poe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination view={view} onPage={setPage} />
      </div>
    </div>
  )
}

function dedupe(items) {
  const seen = new Map()
  for (const item of items) {
    if (item.value != null && item.value !== '—' && !seen.has(item.value)) seen.set(item.value, item)
  }
  return [...seen.values()]
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none"
      aria-label={label}
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
