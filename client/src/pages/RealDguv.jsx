import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ShieldCheck, CheckCircle2, Clock, AlertTriangle, XOctagon, CircleDashed, Download, ChevronRight } from 'lucide-react'
import { DGUV_STATES, DGUV_STATE_LABEL, DGUV_LEVEL_LABEL } from '@rackium/shared/dguvRollup.js'
import { dguvApi } from '../api/m7a2Api.js'

// Status: an icon and a word with the colour (never colour alone).
const STATE = {
  valid: { Icon: CheckCircle2, text: 'text-status-green', bar: 'bg-status-green' },
  expiring_soon: { Icon: Clock, text: 'text-status-amber', bar: 'bg-status-amber/60' },
  expiring: { Icon: AlertTriangle, text: 'text-status-amber', bar: 'bg-status-amber' },
  overdue: { Icon: XOctagon, text: 'text-status-red', bar: 'bg-status-red' },
  not_inspected: { Icon: CircleDashed, text: 'text-status-red', bar: 'bg-status-red/50' },
}
const ORDER = [...DGUV_STATES].reverse() // valid … overdue, left to right

export function StateBadge({ state }) {
  if (!state) return <span className="text-xs text-text-secondary">—</span>
  const { Icon, text } = STATE[state]
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${text}`}>
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {DGUV_STATE_LABEL[state]}
    </span>
  )
}

// The node's devices by status: one stacked bar, a legend with the counts.
function Distribution({ counts }) {
  if (!counts.total) return <p className="text-sm text-text-secondary">No installed mains-powered devices here.</p>
  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={ORDER.map((s) => `${DGUV_STATE_LABEL[s]}: ${counts[s]}`).join(', ')}>
        {ORDER.filter((s) => counts[s]).map((s) => (
          <div key={s} className={`${STATE[s].bar} first:rounded-l last:rounded-r`} style={{ width: `${(counts[s] / counts.total) * 100}%` }} title={`${DGUV_STATE_LABEL[s]}: ${counts[s]}`} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text">
        {ORDER.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${STATE[s].bar}`} aria-hidden="true" />
            <StateBadge state={s} />
            <strong className="tabular-nums">{counts[s]}</strong>
          </li>
        ))}
      </ul>
    </div>
  )
}

// DGUV V3 compliance (brief v2.2 §20.9.3, §20.9.6; M7a-2): the rollup down
// to the device, buildings in scope only, with drill-down and CSV export.
export default function RealDguv() {
  const { orgId, projectId } = useParams()
  const [params, setParams] = useSearchParams()
  const level = params.get('level') || 'project'
  const id = params.get('id') || null
  const status = params.get('status') || ''
  const [view, setView] = useState(null)
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    const query = { level, id }
    Promise.all([dguvApi.view(orgId, projectId, query), dguvApi.devices(orgId, projectId, { ...query, status: status || undefined })])
      .then(([v, d]) => {
        if (!live) return
        setView(v)
        setDevices(d.devices)
        setError(null)
      })
      .catch((err) => live && setError(err.status === 404 ? 'This part of the project is not one you can see.' : err.message))
    return () => {
      live = false
    }
  }, [orgId, projectId, level, id, status])

  const open = (nextLevel, nextId) => setParams(nextLevel === 'project' ? {} : { level: nextLevel, id: nextId })
  const setStatus = (s) => setParams({ ...(level !== 'project' ? { level, id } : {}), ...(s ? { status: s } : {}) })

  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 sm:p-6" data-testid="dguv-page">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text">
          <ShieldCheck size={22} strokeWidth={2} className="text-brand" />
          DGUV V3 compliance
        </h1>
        {view && (
          <p className="text-sm text-text-secondary">
            Today {view.today} ({view.timeZone}). Interval {view.thresholds.intervalMonths} months; expiring soon ≤ {view.thresholds.expiringSoonDays} days, expiring ≤ {view.thresholds.expiringDays} days.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-red">
          {error}
        </p>
      )}
      {!view && !error && <p className="text-sm text-text-secondary">Loading…</p>}
      {view && (
        <>
          <nav aria-label="Location" className="flex flex-wrap items-center gap-1 text-sm">
            {view.path.map((x, i) => (
              <span key={`${x.level}:${x.id}`} className="inline-flex min-w-0 items-center gap-1">
                {i > 0 && <ChevronRight size={14} className="shrink-0 text-text-secondary" aria-hidden="true" />}
                {i === view.path.length - 1 ? (
                  <span className="truncate font-semibold text-text" aria-current="page">
                    {x.name}
                  </span>
                ) : (
                  <button type="button" onClick={() => open(x.level, x.id)} className="truncate text-brand hover:underline">
                    {x.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          <section className="rounded-xl border border-border bg-surface p-4" data-testid="dguv-node">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-text">
                {DGUV_LEVEL_LABEL[view.node.level]}: {view.node.name}
              </h2>
              <p className="text-sm text-text">
                <strong className="tabular-nums">{view.node.compliantPct ?? '—'}{view.node.compliantPct != null ? '%' : ''}</strong> <span className="text-text-secondary">compliant · {view.node.counts.total} device(s)</span>
              </p>
            </div>
            <Distribution counts={view.node.counts} />
          </section>

          {view.childLevel && view.rows.length > 0 && (
            <section className="rounded-xl border border-border bg-surface" data-testid="dguv-rows">
              <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-text">By {DGUV_LEVEL_LABEL[view.childLevel].toLowerCase()}</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-text-secondary">
                    <tr>
                      <th className="px-4 py-2 font-medium">{DGUV_LEVEL_LABEL[view.childLevel]}</th>
                      <th className="px-2 py-2 font-medium">Worst</th>
                      {ORDER.map((s) => (
                        <th key={s} className="px-2 py-2 text-right font-medium">
                          {DGUV_STATE_LABEL[s].replace(/ \(.*\)$/, '')}
                        </th>
                      ))}
                      <th className="px-4 py-2 text-right font-medium">Compliant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((r) => (
                      <tr key={`${r.level}:${r.id}`} className="border-t border-border/60">
                        <td className="px-4 py-2">
                          {r.id && view.childLevel !== 'device' ? (
                            <button type="button" onClick={() => open(r.level, r.id)} className="font-medium text-brand hover:underline">
                              {r.name}
                            </button>
                          ) : (
                            <span className="font-medium text-text">{r.name}</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <StateBadge state={r.worst} />
                        </td>
                        {ORDER.map((s) => (
                          <td key={s} className={`px-2 py-2 text-right tabular-nums ${r.counts[s] ? 'text-text' : 'text-text-secondary'}`}>
                            {r.counts[s]}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right tabular-nums">{r.compliantPct ?? '—'}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-surface" data-testid="dguv-devices">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-text">Devices</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Show status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none">
                  <option value="">Every status</option>
                  {DGUV_STATES.map((s) => (
                    <option key={s} value={s}>
                      {DGUV_STATE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <a href={dguvApi.exportUrl(orgId, projectId, { level, id, status: status || undefined })} download className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:bg-surface-muted">
                  <Download size={14} aria-hidden="true" />
                  CSV
                </a>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-text-secondary">
                  <tr>
                    <th className="px-4 py-2 font-medium">Device</th>
                    <th className="px-2 py-2 font-medium">Where</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Last inspection</th>
                    <th className="px-2 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Inspector</th>
                  </tr>
                </thead>
                <tbody>
                  {(devices ?? []).map((d) => (
                    <tr key={d.deviceId} className="border-t border-border/60" data-device={d.label}>
                      <td className="px-4 py-2 font-medium text-text">{d.label}</td>
                      <td className="px-2 py-2 text-xs text-text-secondary">{[d.buildingCode, d.floor, d.room, d.rack].filter(Boolean).join(' · ')}</td>
                      <td className="px-2 py-2">
                        <StateBadge state={d.state} />
                      </td>
                      <td className="px-2 py-2 tabular-nums">{d.lastInspectionDate ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {d.dueDate ?? '—'}
                        {d.daysRemaining != null && <span className="ml-1 text-xs text-text-secondary">({d.daysRemaining < 0 ? `${-d.daysRemaining} days ago` : `in ${d.daysRemaining} days`})</span>}
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{d.inspector ?? '—'}</td>
                    </tr>
                  ))}
                  {devices && devices.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-sm text-text-secondary">
                        No devices{status ? ` with status “${DGUV_STATE_LABEL[status]}”` : ''}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
