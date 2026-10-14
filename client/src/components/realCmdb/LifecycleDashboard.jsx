import { useState } from 'react'
import { FileUp } from 'lucide-react'
import { readSheetRows } from '../../api/deploymentApi.js'

const STATE = { expired: { label: 'Expired', tone: 'text-status-red' }, soon: { label: '≤ 90 days', tone: 'text-status-amber' }, ok: { label: 'OK', tone: 'text-status-green' } }
const DGUV_TONE = { valid: 'text-status-green', expiring_soon: 'text-status-amber', expiring: 'text-status-amber', overdue: 'text-status-red' }

function Tile({ label, counts }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-1 text-xs font-semibold text-text">{label}</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {Object.entries(counts).map(([k, n]) => (
          <span key={k} className={STATE[k]?.tone ?? DGUV_TONE[k] ?? 'text-text-secondary'}>
            {n} {STATE[k]?.label ?? k.replace('_', ' ')}
          </span>
        ))}
      </div>
    </div>
  )
}
const count = (rows, get) => rows.reduce((acc, r) => {
  const k = get(r) ?? 'not set'
  acc[k] = (acc[k] ?? 0) + 1
  return acc
}, {})
const cell = (date, state) => <span className={STATE[state]?.tone ?? 'text-text-secondary'}>{date ?? '—'}</span>

// Lifecycle (client audit 9.1): warranty, refresh, end of sale / life from
// the catalogue, DGUV status. Warranty and refresh come from manual entry
// (Operational edit) or a CSV / Excel import matched by serial or hostname.
export default function LifecycleDashboard({ records, canEdit, onImport, onSelect }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function choose(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const rows = await readSheetRows(file)
      setPreview({ fileName: file.name, rows, result: await onImport({ fileName: file.name, rows, apply: false }) })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function apply() {
    setBusy(true)
    try {
      await onImport({ fileName: preview.fileName, rows: preview.rows, apply: true })
      setPreview(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Warranty" counts={count(records, (r) => r.lifecycle.state.warranty)} />
        <Tile label="Refresh" counts={count(records, (r) => r.lifecycle.state.refresh)} />
        <Tile label="End of sale" counts={count(records, (r) => r.lifecycle.state.eos)} />
        <Tile label="End of life" counts={count(records, (r) => r.lifecycle.state.eol)} />
        <Tile label="DGUV" counts={count(records.filter((r) => r.dguv), (r) => r.dguv.status)} />
      </div>

      {canEdit && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex h-touch cursor-pointer items-center gap-1.5 rounded-lg border border-brand px-3 text-sm font-medium text-brand">
              <FileUp size={16} strokeWidth={2} /> {busy ? 'Reading…' : 'Import warranty / refresh (CSV or Excel)'}
              <input type="file" accept=".csv,.xlsx,.xls" className="sr-only" aria-label="Lifecycle import file" onChange={(e) => choose(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
            </label>
            <span className="text-xs text-text-secondary">Columns: Serial or Hostname, Warranty start, Warranty end, Refresh date</span>
          </div>
          {error && <p className="text-sm text-status-red">{error}</p>}
          {preview && (
            <div className="space-y-2" data-testid="import-preview">
              <div className="text-sm text-text">
                {preview.fileName}: <strong>{preview.result.matched}</strong> row(s) ready, <strong>{preview.result.problems}</strong> with problems
              </div>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                {preview.result.rows.map((r) => (
                  <li key={r.row} className={r.problems.length ? 'text-status-red' : 'text-text-secondary'}>
                    Row {r.row}: {r.device ? `${r.device} (by ${r.match})` : '—'} {Object.entries(r.values).map(([k, v]) => `${k} ${v}`).join(', ')} {r.problems.join('; ')}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <button type="button" className="h-touch rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || !preview.result.matched} onClick={apply}>
                  Import {preview.result.matched} row(s)
                </button>
                <button type="button" className="h-touch rounded-lg border border-border px-3 text-sm" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-max text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-text-secondary">
              {['Hostname', 'Serial', 'Warranty start', 'Warranty end', 'Refresh', 'End of sale', 'End of life', 'DGUV'].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-muted" onClick={() => onSelect(r.id)}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{r.hostname ?? r.label}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.serial ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{cell(r.lifecycle.warrantyStart)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{cell(r.lifecycle.warrantyEnd, r.lifecycle.state.warranty)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{cell(r.lifecycle.refreshDate, r.lifecycle.state.refresh)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{cell(r.lifecycle.eosDate, r.lifecycle.state.eos)}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{cell(r.lifecycle.eolDate, r.lifecycle.state.eol)}</td>
                <td className={`whitespace-nowrap px-3 py-1.5 ${DGUV_TONE[r.dguv?.status] ?? 'text-text-secondary'}`}>{r.dguv ? `${r.dguv.label}${r.dguv.dueDate ? ` · ${r.dguv.dueDate}` : ''}` : 'n/a'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
