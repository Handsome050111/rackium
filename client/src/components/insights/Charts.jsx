import { useId, useRef, useState } from 'react'
import { colors } from '../../tokens/design-tokens.js'

// Charts for the M7a-3 dashboards and analytics: one series each, in the
// brand colour (validated against the surface; dataviz skill), so no legend —
// the heading names what is plotted. Values are also in a table view, so the
// hover tooltips enhance and never gate.

// A figure: label, value, an optional note under it.
export function StatTile({ label, value, note = null, testId = null }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3" data-testid={testId ?? undefined}>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text">{value ?? '—'}</p>
      {note && <p className="mt-0.5 text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

// Horizontal bars (≤ 24px thick, 4px rounded data end, square at the
// baseline), the value at the tip; each bar its own focus/hover target.
export function BarList({ rows, label, testId = null }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  const [active, setActive] = useState(null)
  return (
    <ul className="space-y-1.5" aria-label={label} data-testid={testId ?? undefined}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr] items-center gap-2 text-sm">
          <span className="truncate text-text-secondary" title={r.label}>
            {r.label}
          </span>
          <span
            tabIndex={0}
            role="img"
            aria-label={`${r.label}: ${r.value}`}
            onPointerEnter={() => setActive(r.key)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(r.key)}
            onBlur={() => setActive(null)}
            className="relative flex h-7 items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className={`h-5 rounded-r bg-brand transition-opacity ${active && active !== r.key ? 'opacity-60' : ''}`} style={{ width: r.value ? `max(4px, calc(${(r.value / max) * 100}% - 3rem))` : '0px' }} />
            <span className="tabular-nums text-text">{r.value}</span>
            {active === r.key && (
              <span role="tooltip" className="pointer-events-none absolute -top-8 left-0 z-10 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-xs shadow">
                <strong className="text-text">{r.value}</strong> <span className="text-text-secondary">{r.label}</span>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

const W = 320
const H = 120
const PAD = { l: 34, r: 40, t: 12, b: 22 }

// A monthly trend: a 2px line, an end dot with a surface ring and the end
// value labelled; a crosshair snaps to the nearest month (pointer or arrow
// keys) with a tooltip; the data as a table under it.
export function TrendLine({ points, unit = '', title, testId = null }) {
  const id = useId()
  const svg = useRef(null)
  const [at, setAt] = useState(null)
  if (!points?.length) return <p className="text-xs text-text-secondary">No data with a known date yet.</p>
  const values = points.map((p) => p.value ?? 0)
  const hi = Math.max(...values)
  const top = hi <= 0 ? 1 : niceMax(hi)
  const x = (i) => (points.length === 1 ? PAD.l + (W - PAD.l - PAD.r) / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1))
  const y = (v) => PAD.t + (1 - (v ?? 0) / top) * (H - PAD.t - PAD.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points.length - 1
  const fmt = (v) => (v == null ? '—' : `${v}${unit}`)
  const nearest = (clientX) => {
    const box = svg.current.getBoundingClientRect()
    const sx = ((clientX - box.left) / box.width) * W
    let best = 0
    points.forEach((_, i) => {
      if (Math.abs(x(i) - sx) < Math.abs(x(best) - sx)) best = i
    })
    return best
  }
  const onKey = (e) => {
    if (e.key === 'ArrowRight') setAt((i) => Math.min(last, (i ?? -1) + 1))
    else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, (i ?? last + 1) - 1))
    else return
    e.preventDefault()
  }
  return (
    <figure className="m-0" data-testid={testId ?? undefined}>
      <div className="relative">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          role="img"
          aria-labelledby={`${id}-t`}
          tabIndex={0}
          onPointerMove={(e) => setAt(nearest(e.clientX))}
          onPointerDown={(e) => setAt(nearest(e.clientX))}
          onPointerLeave={() => setAt(null)}
          onKeyDown={onKey}
          onBlur={() => setAt(null)}
        >
          <title id={`${id}-t`}>{`${title}: ${points.map((p) => `${p.period} ${fmt(p.value)}`).join(', ')}`}</title>
          {[0, top].map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={colors.border} strokeWidth="1" />
              <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill={colors.textSecondary} className="tabular-nums">
                {v}
              </text>
            </g>
          ))}
          <text x={x(0)} y={H - 6} textAnchor={points.length === 1 ? 'middle' : 'start'} fontSize="9" fill={colors.textSecondary}>
            {points[0].period}
          </text>
          {last > 0 && (
            <text x={x(last)} y={H - 6} textAnchor="end" fontSize="9" fill={colors.textSecondary}>
              {points[last].period}
            </text>
          )}
          <path d={path} fill="none" stroke={colors.brandBlue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {at != null && <line x1={x(at)} x2={x(at)} y1={PAD.t} y2={H - PAD.b} stroke={colors.textSecondary} strokeWidth="1" />}
          <circle cx={x(at ?? last)} cy={y(points[at ?? last].value)} r="4" fill={colors.brandBlue} stroke={colors.background} strokeWidth="2" />
          <text x={x(last) + 7} y={y(points[last].value) + 3} fontSize="10" fontWeight="600" fill={colors.textPrimary} className="tabular-nums">
            {fmt(points[last].value)}
          </text>
        </svg>
        {at != null && (
          <div role="tooltip" className="pointer-events-none absolute top-0 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow" style={{ left: `${Math.min(70, (x(at) / W) * 100)}%` }}>
            <strong className="text-text">{fmt(points[at].value)}</strong> <span className="text-text-secondary">{points[at].period}</span>
            {points[at].count != null && <span className="text-text-secondary"> · {points[at].count} row(s)</span>}
          </div>
        )}
      </div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-brand">Table</summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-text-secondary">
            <tr>
              <th className="py-0.5 font-medium">Month</th>
              <th className="py-0.5 text-right font-medium">Value</th>
              <th className="py-0.5 text-right font-medium">Rows</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.period} className="border-t border-border/60">
                <td className="py-0.5">{p.period}</td>
                <td className="py-0.5 text-right tabular-nums">{fmt(p.value)}</td>
                <td className="py-0.5 text-right tabular-nums">{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function niceMax(v) {
  const step = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step
  return 10 * step
}
