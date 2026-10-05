import { useMemo, useState } from 'react'
import { DGUV_LABEL } from '@rackium/shared/dguv.js'

const DGUV_COLOR = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function dedupe(values) {
  return [...new Set(values.filter(Boolean))]
}

export default function CmdbInventoryTable({ rows, selectedId, onSelect }) {
  const [search, setSearch] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [lifecycleFilter, setLifecycleFilter] = useState('')
  const [acceptanceFilter, setAcceptanceFilter] = useState('')
  const [dguvFilter, setDguvFilter] = useState('')

  const floors = useMemo(() => dedupe(rows.map((r) => r.floorName)), [rows])
  const roles = useMemo(() => dedupe(rows.map((r) => r.role)), [rows])
  const lifecycles = useMemo(() => dedupe(rows.map((r) => r.lifecycle)), [rows])

  const filtered = rows.filter((r) => {
    if (floorFilter && r.floorName !== floorFilter) return false
    if (roleFilter && r.role !== roleFilter) return false
    if (lifecycleFilter && r.lifecycle !== lifecycleFilter) return false
    if (acceptanceFilter && r.acceptance !== acceptanceFilter) return false
    if (dguvFilter && r.dguv?.status !== dguvFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const hay = [r.hostname, r.serial, r.mac].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search hostname, serial, MAC or cable ID…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none"
        />
        <FilterSelect label="Floor" value={floorFilter} onChange={setFloorFilter} options={floors} />
        <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter} options={roles} />
        <FilterSelect label="Lifecycle" value={lifecycleFilter} onChange={setLifecycleFilter} options={lifecycles} />
        <FilterSelect label="Acceptance" value={acceptanceFilter} onChange={setAcceptanceFilter} options={['Accepted', 'Awaiting']} />
        <FilterSelect label="DGUV" value={dguvFilter} onChange={setDguvFilter} options={Object.keys(DGUV_LABEL)} optionLabel={(v) => DGUV_LABEL[v]} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-text-secondary">
              {['Hostname', 'Role', 'Model', 'Location', 'Rack / RU', 'Serial', 'Lifecycle', 'Acceptance', 'DGUV'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-muted ${selectedId === r.id ? 'bg-brand/5' : ''}`}
              >
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{r.hostname}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.role}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.model}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">
                  {r.floorName} / {r.roomCode}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.rackCode ? `${r.rackCode} / RU${r.ru ?? '—'}` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.serial ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={r.lifecycle === 'in_service' || r.lifecycle === 'accepted' ? 'text-status-green' : 'text-text-secondary'}>{r.lifecycle}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={r.acceptance === 'Accepted' ? 'text-status-green' : 'text-status-amber'}>{r.acceptance}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  {r.dguv ? <span className={DGUV_COLOR[r.dguv.status]}>{DGUV_LABEL[r.dguv.status]}</span> : <span className="text-text-secondary">n/a</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options, optionLabel = (v) => v }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none">
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {optionLabel(o)}
        </option>
      ))}
    </select>
  )
}
