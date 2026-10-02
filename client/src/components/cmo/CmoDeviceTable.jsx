// Per-building device list for the current building — the actual CMO
// baseline Survey/HLD/Deployment validate against (brief §5.1).
export default function CmoDeviceTable({ devices }) {
  if (devices.length === 0) {
    return <div className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-xs text-text-secondary">No CMO devices imported for this building yet.</div>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-max text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-surface-muted text-text-secondary">
            {['Hostname', 'Model', 'Serial', 'MAC', 'Room', 'Rack', 'RU'].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-border/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium text-text">{d.hostname ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.model ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.serial}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.mac ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.roomCode ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.rackCode ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{d.ru ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
