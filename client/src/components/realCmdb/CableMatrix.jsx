import { useState } from 'react'
import { MEDIA_COLOURS } from '../realDeployment/mediaColours.js'

// Every as-built port → its destination, with the hops between, the cable
// IDs of every segment, length and the link test (client audit 9.1).
export default function CableMatrix({ rows, onTrace }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const shown = needle ? rows.filter((r) => [r.device, r.port, r.toDevice, r.toPort, ...r.cableIds, ...r.hops].some((v) => v && String(v).toLowerCase().includes(needle))) : rows
  return (
    <div className="space-y-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search device, port or cable ID…" aria-label="Search cable matrix" className="h-9 w-full max-w-sm rounded-lg border border-border bg-surface px-2.5 text-sm focus:border-brand focus:outline-none" />
      {shown.length === 0 ? (
        <p className="text-sm text-text-secondary">No accepted connections yet — a connection enters the CMDB when it is accepted in deployment.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-max text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-text-secondary">
                {['Device', 'Port', 'Hops', 'Destination', 'Port', 'Cable IDs', 'Length', 'Media', 'Test'].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-b border-border/60 last:border-0 hover:bg-surface-muted">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{r.device}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <button type="button" className="font-medium text-brand hover:underline" onClick={() => onTrace(r.deviceId, r.port)}>
                      {r.port ?? '—'}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-text-secondary">{r.hops.length ? r.hops.join(' → ') : 'direct'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text">{r.toDevice}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.toPort ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-text">{r.cableIds.join(', ') || '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{r.lengthM != null ? `${r.lengthM} m` : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="inline-block h-2 w-4 rounded-sm align-middle" style={{ background: MEDIA_COLOURS[r.media] }} /> {r.media}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${r.testResult === 'pass' ? 'text-status-green' : 'text-status-red'}`}>{r.testResult ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
