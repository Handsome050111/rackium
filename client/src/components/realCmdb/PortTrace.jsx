import { orthogonalPath } from '@rackium/shared/cmdb.js'
import { MEDIA_COLOURS, mediaEdge } from '../realDeployment/mediaColours.js'
import { portRows } from './portRows.js'

const U = 13 // px per RU
const RACK_W = 180
const GAP = 90 // between racks; the cable manager runs down the middle
const TOP = 28

// Rack elevations of every rack the route passes, side by side, with the
// route drawn orthogonally through the cable managers in the media colour
// and every cable ID on its segment (client audit 9.1 Port connectivity).
function RouteDiagram({ conn, fromDeviceId, placements, racks }) {
  const nodes = (fromDeviceId === conn.source.deviceId ? [conn.source, ...conn.hops.map((h) => ({ deviceId: h.patchPanelId, portId: `${h.inPort}/${h.outPort}`, panel: true })), conn.dest] : [conn.dest, ...[...conn.hops].reverse().map((h) => ({ deviceId: h.patchPanelId, portId: `${h.outPort}/${h.inPort}`, panel: true })), conn.source]).map((n) => ({ ...n, place: placements.get(n.deviceId) }))
  const segments = fromDeviceId === conn.source.deviceId ? conn.segments : [...conn.segments].reverse()
  const rackOrder = [...new Set(nodes.map((n) => n.place?.rackId).filter(Boolean))]
  const rackX = new Map(rackOrder.map((id, i) => [id, 20 + i * (RACK_W + GAP)]))
  const tallest = Math.max(12, ...rackOrder.map((id) => racks.find((r) => r.id === id)?.heightU ?? 42))
  const looseX = 20 + rackOrder.length * (RACK_W + GAP)
  const width = looseX + (nodes.some((n) => !n.place?.rackId) ? RACK_W + 20 : 0)
  const height = TOP + tallest * U + 30
  const box = (place) => {
    if (!place?.rackId) return { x: looseX, y: TOP + (tallest * U) / 2 - 12, w: RACK_W - 20, h: 24 }
    const rack = racks.find((r) => r.id === place.rackId)
    const hU = Math.max(1, place.heightU ?? 1)
    const top = TOP + ((rack?.heightU ?? 42) - ((place.ru ?? 1) + hU - 1)) * U
    return { x: rackX.get(place.rackId) + 8, y: top, w: RACK_W - 16, h: hU * U }
  }
  // Waypoints: out of each box towards the next, down the cable manager between them.
  const points = []
  const labels = []
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = box(nodes[i].place)
    const b = box(nodes[i + 1].place)
    const ay = a.y + a.h / 2
    const by = b.y + b.h / 2
    const rightward = b.x >= a.x
    const sameRack = nodes[i].place?.rackId && nodes[i].place?.rackId === nodes[i + 1].place?.rackId
    const ax = rightward || sameRack ? a.x + a.w : a.x
    const bx = sameRack ? b.x + b.w : rightward ? b.x : b.x + b.w
    const cm = sameRack ? a.x + a.w + 16 : rightward ? a.x + a.w + 8 + GAP / 2 : a.x - 8 - GAP / 2
    // From the second device on this passes through the panel (in one side, out the other).
    points.push({ x: ax, y: ay })
    points.push({ x: cm, y: ay }, { x: cm, y: by }, { x: bx, y: by })
    labels.push({ x: cm + 4, y: (ay + by) / 2, text: segments[i]?.cableId ?? '', length: segments[i]?.installedM ?? segments[i]?.effectiveM })
  }
  const colour = MEDIA_COLOURS[conn.media] ?? '#094F9A'
  const edge = mediaEdge(conn.media)
  const path = orthogonalPath(points)
  const shownIds = new Set(nodes.map((n) => n.deviceId))
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="img" aria-label={`Route ${segments.map((s) => s.cableId).filter(Boolean).join(', ')}`} data-testid="route-diagram">
      {rackOrder.map((id) => {
        const rack = racks.find((r) => r.id === id)
        const x = rackX.get(id)
        const h = (rack?.heightU ?? 42) * U
        return (
          <g key={id}>
            <text x={x} y={16} fontSize="11" fontWeight="600" fill="currentColor">
              {rack?.code} · {rack?.roomCode}
            </text>
            <rect x={x} y={TOP} width={RACK_W} height={h} rx="4" fill="#F4F5F7" stroke="#C7CCD6" />
            {/* the vertical cable manager beside the rack */}
            <rect x={x + RACK_W + GAP / 2 - 6} y={TOP} width={12} height={h} rx="3" fill="#E2E5EA" />
            {[...placements.values()]
              .filter((pl) => pl.rackId === id)
              .map((pl) => {
                const b = box(pl)
                return (
                  <g key={pl.id}>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="2" fill={shownIds.has(pl.id) ? '#DCE8F5' : '#FFFFFF'} stroke={shownIds.has(pl.id) ? '#094F9A' : '#C7CCD6'} />
                    <text x={b.x + 4} y={b.y + Math.min(b.h, U) - 2} fontSize="9" fill="#3D4452">
                      {pl.label.length > 26 ? `${pl.label.slice(0, 25)}…` : pl.label}
                    </text>
                  </g>
                )
              })}
          </g>
        )
      })}
      {nodes
        .filter((n) => !n.place?.rackId)
        .map((n) => {
          const b = box(n.place)
          return (
            <g key={n.deviceId}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="4" fill="#DCE8F5" stroke="#094F9A" />
              <text x={b.x + 4} y={b.y + 15} fontSize="9" fill="#3D4452">
                {n.place?.label ?? 'device'} (no rack)
              </text>
            </g>
          )
        })}
      {edge && <path d={path} fill="none" stroke={edge} strokeWidth="5" strokeLinejoin="round" />}
      <path d={path} fill="none" stroke={colour} strokeWidth="3" strokeLinejoin="round" data-testid="route-path" />
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} fontSize="11" fontWeight="600" fill="#1F2430">
          {l.text}
          {l.length != null ? ` · ${l.length} m` : ''}
        </text>
      ))}
    </svg>
  )
}

// Port connectivity (client audit 9.1): the device's ports with their far
// ends; a port opens its route over the rack elevations.
export default function PortTrace({ record, connections, placements, racks, selectedPort, onSelectPort }) {
  const rows = portRows(record, connections)
  const current = rows.find((r) => r.port === selectedPort && r.conn)
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start" data-testid="port-trace">
      <div className="w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface lg:w-96">
        <div className="border-b border-border px-3 py-2 text-sm font-semibold text-text">{record.hostname ?? record.label} — ports</div>
        <ul className="max-h-[520px] divide-y divide-border/60 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.port}>
              <button type="button" disabled={!r.conn} onClick={() => onSelectPort(r.port)} aria-pressed={r.port === selectedPort} className={`flex min-h-[44px] w-full items-center gap-2 px-3 py-1.5 text-left text-xs disabled:cursor-default ${r.port === selectedPort ? 'bg-brand/10' : r.conn ? 'hover:bg-surface-muted' : ''}`}>
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.conn ? MEDIA_COLOURS[r.conn.media] : '#E2E5EA' }} />
                <span className="w-20 shrink-0 font-mono font-medium text-text">{r.port}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">{r.conn ? `${r.other.name} ${r.other.portId ?? ''}` : 'free'}</span>
                {r.conn && <span className={`shrink-0 font-medium ${r.conn.testResult === 'pass' ? 'text-status-green' : 'text-status-red'}`}>{r.conn.testResult ?? '—'}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0 flex-1 space-y-3 rounded-xl border border-border bg-surface p-3">
        {current ? (
          <>
            <div className="text-sm text-text">
              <strong>
                {record.hostname} {current.port}
              </strong>{' '}
              → {current.hops.map((h) => `${h.name} ${h.inPort}/${h.outPort}`).join(' → ')}
              {current.hops.length ? ' → ' : ''}
              <strong>
                {current.other.name} {current.other.portId}
              </strong>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
              <span>Cable IDs: <span className="font-mono text-text">{current.conn.segments.map((s) => s.cableId ?? '—').join(', ')}</span></span>
              <span>Media: {current.conn.media}</span>
              <span>
                Test: <span className={current.conn.testResult === 'pass' ? 'text-status-green' : 'text-status-red'}>{current.conn.testResult ?? '—'}</span>
                {current.conn.testedAt ? ` (${new Date(current.conn.testedAt).toLocaleDateString()})` : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <RouteDiagram conn={current.conn} fromDeviceId={record.id} placements={placements} racks={racks} />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-secondary">Choose a patched port to trace its route.</p>
        )}
      </div>
    </div>
  )
}
