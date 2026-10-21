import { useMemo, useState } from 'react'

const W = 640
const H = 220
const PAD = { left: 36, right: 12, top: 12, bottom: 28 }

// SLA burn-down (v2.2 §21.8): remaining work items per day, actual (solid)
// against the ideal straight line (dashed). One axis; a crosshair with a
// tooltip on hover; a table view of the same numbers.
export default function BurndownChart({ series, dueDate }) {
  const [hover, setHover] = useState(null)
  const [table, setTable] = useState(false)
  const max = useMemo(() => Math.max(1, ...series.map((d) => Math.max(d.ideal, d.actual ?? 0))), [series])
  const n = series.length
  const x = (i) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right))
  const y = (v) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom)
  const line = (pick) =>
    series
      .map((d, i) => [d, i])
      .filter(([d]) => pick(d) != null)
      .map(([d, i], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`)
      .join(' ')
  const yTicks = [...new Set([0, Math.round(max / 2), max])]
  const xLabels = n ? [0, Math.floor((n - 1) / 2), n - 1] : []
  const dueIndex = series.findIndex((d) => d.date === dueDate)

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }
  const h = hover != null ? series[hover] : null

  return (
    <div data-testid="burndown">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-secondary">
        <div className="flex gap-3">
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-brand" />Remaining (actual)</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-5 border-t-2 border-dashed border-text-secondary" />Ideal</span>
        </div>
        <button type="button" onClick={() => setTable((t) => !t)} className="rounded border border-border px-2 py-0.5 text-[11px] text-text hover:bg-surface-muted">
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-56 overflow-auto rounded border border-border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface text-left text-text-secondary">
              <tr><th className="px-2 py-1 font-medium">Day</th><th className="px-2 py-1 font-medium">Remaining</th><th className="px-2 py-1 font-medium">Ideal</th></tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date} className="border-t border-border/60">
                  <td className="px-2 py-0.5">{d.date}</td>
                  <td className="px-2 py-0.5">{d.actual ?? '—'}</td>
                  <td className="px-2 py-0.5">{d.ideal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="SLA burn-down: remaining work items per day against the ideal line" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
                <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" className="fill-text-secondary text-[10px]">{v}</text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-text-secondary text-[10px]">{series[i].date}</text>
            ))}
            {dueIndex >= 0 && <line x1={x(dueIndex)} x2={x(dueIndex)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-status-red" strokeWidth="1" strokeDasharray="2 3" />}
            <path d={line((d) => d.ideal)} className="fill-none stroke-text-secondary" strokeWidth="2" strokeDasharray="5 4" />
            <path d={line((d) => d.actual)} className="fill-none stroke-brand" strokeWidth="2" strokeLinejoin="round" />
            {h && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-text-secondary" strokeWidth="1" />
                {h.actual != null && <circle cx={x(hover)} cy={y(h.actual)} r="4" className="fill-brand stroke-surface" strokeWidth="2" />}
              </g>
            )}
          </svg>
          {h && (
            <div className="pointer-events-none absolute top-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text shadow" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%` }}>
              <div className="font-semibold">{h.date}{h.date === dueDate ? ' · due' : ''}</div>
              <div>Remaining: {h.actual ?? '—'}</div>
              <div className="text-text-secondary">Ideal: {h.ideal}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
