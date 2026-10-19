import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Ban, Clock } from 'lucide-react'
import { PHASE_LABELS } from '@rackium/shared/notifications.js'
import { RISK_LABEL } from '@rackium/shared/schedule.js'
import { phaseStatus } from '../../tokens/design-tokens.js'
import { ganttRange, assignLanes, ganttTicks, barSpan, draggedDates } from '../../lib/ganttLayout.js'

const LANE = 30
const ROW_PAD = 6
const LABEL_W = 88
const SHORT = { cmo: 'CMO', survey: 'Survey', hld: 'HLD', lld: 'LLD', 'solution-package': 'SP', bom: 'BOM', deployment: 'Deploy', cmdb: 'CMDB', handover: 'Handover' }
const FILL = { grey: 'bg-status-grey/25 text-text border border-status-grey/60', amber: 'bg-status-amber text-white', red: 'bg-status-red text-white', green: 'bg-status-green text-white' }
const RISK_ICON = { overdue: AlertTriangle, at_risk: Clock, blocked: Ban }
// Blocked bars are hatched (v2.2 §21.7), independent of colour.
const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.28) 0 3px, transparent 3px 8px)' }

// The Gantt (brief v2.2 §21.2): buildings as rows, phase bars coloured by
// status, today marker, milestones, dependency arrows, the critical path
// outlined, blocked bars hatched. The PM drags a bar (move) or its end
// (target); everyone else reads. Built in-house (THIRD-PARTY: no library).
export default function Gantt({ view, canEdit, zoom = 'weeks', onChangeDates, onSelectBar }) {
  const dayWidth = zoom === 'weeks' ? 18 : 5
  const [drag, setDrag] = useState(null) // { key, mode, startX, delta }
  const scrollRef = useRef(null)
  const range = useMemo(() => ganttRange({ bars: view.bars, milestones: view.milestones, today: view.today }), [view])
  const ticks = useMemo(() => ganttTicks({ from: range.from, days: range.days, dayWidth }), [range, dayWidth])
  const width = range.days * dayWidth
  const codeOf = useMemo(() => new Map(view.buildings.map((b) => [b.id, b.code])), [view.buildings])

  // Rows: the project's own milestones first, then each building with its lanes.
  const rows = useMemo(() => {
    const out = []
    let y = 0
    const projectMilestones = view.milestones.filter((m) => !m.buildingId && m.dueDate)
    if (projectMilestones.length) {
      out.push({ id: 'project', label: 'Project', y, height: LANE + ROW_PAD * 2, bars: [], milestones: projectMilestones })
      y += LANE + ROW_PAD * 2
    }
    for (const b of view.buildings) {
      const laid = assignLanes(view.bars.filter((x) => x.buildingId === b.id), range.from)
      const height = laid.lanes * LANE + ROW_PAD * 2
      out.push({ id: b.id, label: b.code, y, height, bars: laid.bars, milestones: view.milestones.filter((m) => m.buildingId === b.id && m.dueDate) })
      y += height
    }
    return { list: out, height: y }
  }, [view, range.from])

  const barPos = useMemo(() => {
    const pos = new Map()
    for (const row of rows.list) for (const bar of row.bars) pos.set(bar.key, { row, bar, x1: bar.span.left * dayWidth, x2: (bar.span.left + bar.span.width) * dayWidth, y: row.y + ROW_PAD + bar.lane * LANE + LANE / 2 })
    return pos
  }, [rows, dayWidth])
  const critical = useMemo(() => new Set(view.critical), [view.critical])
  const todayX = (barSpan({ start: view.today, target: view.today }, range.from)?.left ?? 0) * dayWidth

  function onPointerDown(e, bar, mode) {
    if (!canEdit || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ key: bar.key, mode, startX: e.clientX, delta: 0 })
    e.stopPropagation()
  }
  function onPointerMove(e) {
    if (!drag) return
    setDrag((d) => ({ ...d, delta: Math.round((e.clientX - d.startX) / dayWidth) }))
  }
  function onPointerUp(bar) {
    if (!drag) return
    const d = drag
    setDrag(null)
    if (d.delta === 0) {
      onSelectBar?.(bar)
      return
    }
    onChangeDates?.(bar, draggedDates(bar, { mode: d.mode, deltaDays: d.delta }))
  }

  return (
    <div className="rounded-xl border border-border bg-surface" data-testid="gantt">
      <div className="flex">
        <div className="shrink-0 border-r border-border" style={{ width: LABEL_W }}>
          <div className="h-10 border-b border-border" />
          <div className="relative" style={{ height: rows.height }}>
            {rows.list.map((row) => (
              <div key={row.id} className="absolute left-0 right-0 flex items-center border-b border-border/60 px-2 text-xs font-semibold text-text" style={{ top: row.y, height: row.height }}>
                {row.label}
              </div>
            ))}
          </div>
        </div>
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto" onPointerMove={onPointerMove}>
          <div className="relative" style={{ width }}>
            <div className="relative h-10 border-b border-border">
              {ticks.map((t) => (
                <div key={t.date} className="absolute top-0 h-full border-l border-border/70 pl-1 text-[10px] leading-5 text-text-secondary" style={{ left: t.day * dayWidth }}>
                  <span data-testid="gantt-tick">{t.label}</span>
                </div>
              ))}
              <span data-testid="gantt-today-label" className="absolute bottom-0.5 rounded bg-status-red px-1 text-[10px] font-semibold leading-4 text-white" style={{ left: todayX + dayWidth / 2 + 2 }}>
                Today
              </span>
            </div>
            <div className="relative" style={{ height: rows.height }}>
              {ticks.map((t) => (
                <div key={t.date} className="absolute top-0 h-full border-l border-border/40" style={{ left: t.day * dayWidth }} aria-hidden="true" />
              ))}
              {rows.list.map((row) => (
                <div key={row.id} className="absolute left-0 right-0 border-b border-border/60" style={{ top: row.y, height: row.height }} aria-hidden="true" />
              ))}
              {/* Dependencies: from the end of one bar to the start of the next. */}
              <svg className="pointer-events-none absolute inset-0" width={width} height={rows.height} aria-hidden="true">
                <defs>
                  <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" className="fill-text-secondary" />
                  </marker>
                </defs>
                {view.dependencies.map((d) => {
                  const a = barPos.get(`${d.from.buildingId}|${d.from.phaseKey}`)
                  const b = barPos.get(`${d.to.buildingId}|${d.to.phaseKey}`)
                  if (!a || !b) return null
                  const mid = Math.max(a.x2 + 8, Math.min(b.x1 - 8, (a.x2 + b.x1) / 2))
                  return <path key={d.id} d={`M${a.x2},${a.y} H${mid} V${b.y} H${b.x1 - 2}`} className="fill-none stroke-text-secondary" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#gantt-arrow)" />
                })}
              </svg>
              {rows.list.flatMap((row) =>
                row.bars.map((bar) => {
                  const live = drag?.key === bar.key ? draggedDates(bar, { mode: drag.mode, deltaDays: drag.delta }) : null
                  const span = live ? barSpan({ start: live.startDate ?? bar.start, target: live.targetDate }, range.from) : bar.span
                  const meta = phaseStatus[bar.status] ?? phaseStatus.not_started
                  const RiskIcon = RISK_ICON[bar.risk]
                  const title = `${codeOf.get(bar.buildingId)} · ${PHASE_LABELS[bar.phaseKey]} · ${bar.start ?? '—'} → ${bar.target} · ${meta.label} · ${RISK_LABEL[bar.risk]}${critical.has(bar.key) ? ' · critical path' : ''}${bar.completedOn ? ` · done ${bar.completedOn}` : ''}`
                  return (
                    <button
                      key={bar.key}
                      type="button"
                      title={title}
                      aria-label={title}
                      data-bar={bar.key}
                      onPointerDown={(e) => onPointerDown(e, bar, 'move')}
                      onPointerUp={() => onPointerUp(bar)}
                      onPointerCancel={() => setDrag(null)}
                      onClick={(e) => e.detail === 0 && onSelectBar?.(bar)}
                      className={`absolute flex items-center gap-1 overflow-hidden rounded px-1.5 text-[11px] font-medium ${FILL[meta.color]} ${critical.has(bar.key) ? 'ring-2 ring-text ring-offset-1' : ''} ${canEdit ? 'cursor-grab touch-none' : 'cursor-pointer'} ${drag?.key === bar.key ? 'opacity-80' : ''}`}
                      style={{ left: span.left * dayWidth, width: Math.max(span.width * dayWidth, 14), top: row.y + ROW_PAD + bar.lane * LANE + 3, height: LANE - 6, ...(bar.blocked ? HATCH : {}) }}
                    >
                      {RiskIcon && <RiskIcon size={12} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />}
                      {span.width * dayWidth >= 40 && <span className="truncate">{SHORT[bar.phaseKey]}</span>}
                      {canEdit && <span className="absolute right-0 top-0 h-full w-2 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, bar, 'end')} aria-hidden="true" />}
                    </button>
                  )
                })
              )}
              {rows.list.flatMap((row) =>
                row.milestones.map((m) => {
                  const left = (barSpan({ start: m.dueDate, target: m.dueDate }, range.from)?.left ?? 0) * dayWidth + dayWidth / 2 - 6
                  return (
                    <span
                      key={m.id}
                      title={`${m.name} · ${m.dueDate}${m.done ? ' · done' : ''}`}
                      className={`absolute h-3 w-3 rotate-45 border-2 ${m.done ? 'border-status-green bg-status-green' : 'border-brand bg-surface'}`}
                      style={{ left, top: row.id === 'project' ? row.y + row.height / 2 - 6 : row.y + 2 }}
                    />
                  )
                })
              )}
              <div className="pointer-events-none absolute top-0 h-full border-l-2 border-status-red" style={{ left: todayX + dayWidth / 2 }} data-testid="gantt-today" />
            </div>
          </div>
        </div>
      </div>
      <GanttLegend />
    </div>
  )
}

function GanttLegend() {
  const item = 'inline-flex items-center gap-1.5'
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border px-3 py-2 text-[11px] text-text-secondary">
      <span className={item}><span className="h-3 w-5 rounded border border-status-grey/60 bg-status-grey/25" />Not started</span>
      <span className={item}><span className="h-3 w-5 rounded bg-status-amber" />In progress</span>
      <span className={item}><span className="h-3 w-5 rounded bg-status-green" />Done</span>
      <span className={item}><span className="h-3 w-5 rounded bg-status-red" />Changes requested / blocked</span>
      <span className={item}><span className="h-3 w-5 rounded bg-status-amber" style={HATCH} />Open blocker</span>
      <span className={item}><span className="h-3 w-5 rounded ring-2 ring-text ring-offset-1" />Critical path</span>
      <span className={item}><span className="h-2.5 w-2.5 rotate-45 border-2 border-brand" />Milestone</span>
      <span className={item}><span className="h-3 border-l-2 border-status-red" />Today</span>
      <span className={item}><span className="w-6 border-t border-dashed border-text-secondary" />Dependency</span>
    </div>
  )
}
