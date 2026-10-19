import { addDays } from '@rackium/shared/timeZone.js'
import { daysBetween } from '@rackium/shared/schedule.js'

// Gantt geometry (M7a-1), built in-house (no third-party Gantt library): the
// visible date range, a bar's position in days, lanes for bars that overlap
// in one building's row, the week/month ticks, and the day a drag lands on.
// Pure — the component turns days into pixels with `dayWidth`.

// The range: from a week before the earliest date to two weeks after the
// latest (today included), so the today marker and the ends are visible.
export function ganttRange({ bars, milestones = [], today }) {
  const dates = [today]
  for (const b of bars) {
    if (b.start) dates.push(b.start)
    if (b.target) dates.push(b.target)
    if (b.completedOn) dates.push(b.completedOn)
  }
  for (const m of milestones) if (m.dueDate) dates.push(m.dueDate)
  const sorted = dates.sort()
  const from = addDays(sorted[0], -7)
  const to = addDays(sorted[sorted.length - 1], 14)
  return { from, to, days: daysBetween(from, to) + 1 }
}

// A bar's left edge and width in days. A bar with no start is a single day
// at its target; an unscheduled bar is not drawn.
export function barSpan(bar, from) {
  if (!bar.target) return null
  const start = bar.start ?? bar.target
  return { left: daysBetween(from, start), width: Math.max(1, daysBetween(start, bar.target) + 1) }
}

// Stacks overlapping bars of one row into lanes (first lane that is free).
export function assignLanes(bars, from) {
  const laneEnds = []
  const out = []
  for (const bar of bars) {
    const span = barSpan(bar, from)
    if (!span) continue
    let lane = laneEnds.findIndex((end) => end <= span.left)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = span.left + span.width
    out.push({ ...bar, span, lane })
  }
  return { bars: out, lanes: Math.max(1, laneEnds.length) }
}

// Ticks: every Monday when a day is wide enough, otherwise the 1st of each month.
export function ganttTicks({ from, days, dayWidth }) {
  const ticks = []
  const weekly = dayWidth >= 6
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i)
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (weekly ? dow === 1 : date.endsWith('-01')) ticks.push({ day: i, date, label: weekly ? date.slice(5) : date.slice(0, 7) })
  }
  return ticks
}

// The day a pointer at `x` pixels (from the chart's left) falls on.
export const dayAt = (x, { from, dayWidth }) => addDays(from, Math.floor(x / dayWidth))

// A dragged bar: moving it shifts start and target together; dragging its
// end moves the target (never before the start).
export function draggedDates(bar, { mode, deltaDays }) {
  const start = bar.start ?? bar.target
  if (mode === 'end') {
    const target = addDays(bar.target, deltaDays)
    return { startDate: bar.startDate ?? null, targetDate: target < start ? start : target }
  }
  return { startDate: addDays(start, deltaDays), targetDate: addDays(bar.target, deltaDays) }
}
