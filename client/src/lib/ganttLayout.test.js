import { describe, it, expect } from 'vitest'
import { ganttRange, barSpan, assignLanes, ganttTicks, dayAt, draggedDates } from './ganttLayout.js'

describe('Gantt layout (M7a-1)', () => {
  it('the range covers every bar, milestone and today with a margin', () => {
    const r = ganttRange({ bars: [{ start: '2026-10-05', target: '2026-10-20' }], milestones: [{ dueDate: '2026-11-02' }], today: '2026-10-19' })
    expect(r).toEqual({ from: '2026-09-28', to: '2026-11-16', days: 50 })
  })

  it('bars span from start to target inclusive; no start = one day; unscheduled = none', () => {
    expect(barSpan({ start: '2026-10-01', target: '2026-10-03' }, '2026-09-30')).toEqual({ left: 1, width: 3 })
    expect(barSpan({ start: null, target: '2026-10-03' }, '2026-09-30')).toEqual({ left: 3, width: 1 })
    expect(barSpan({ start: '2026-10-01', target: null }, '2026-09-30')).toBeNull()
  })

  it('overlapping bars of one row stack into lanes; sequential ones share a lane', () => {
    const { bars, lanes } = assignLanes(
      [
        { key: 'a', start: '2026-10-01', target: '2026-10-10' },
        { key: 'b', start: '2026-10-11', target: '2026-10-20' },
        { key: 'c', start: '2026-10-05', target: '2026-10-15' },
      ],
      '2026-10-01'
    )
    expect(bars.map((b) => [b.key, b.lane])).toEqual([['a', 0], ['b', 0], ['c', 1]])
    expect(lanes).toBe(2)
  })

  it('weekly ticks on Mondays when days are wide, monthly otherwise; a pixel lands on its day', () => {
    expect(ganttTicks({ from: '2026-10-19', days: 14, dayWidth: 20 }).map((t) => t.date)).toEqual(['2026-10-19', '2026-10-26'])
    expect(ganttTicks({ from: '2026-10-19', days: 60, dayWidth: 3 }).map((t) => t.date)).toEqual(['2026-11-01', '2026-12-01'])
    expect(dayAt(45, { from: '2026-10-19', dayWidth: 20 })).toBe('2026-10-21')
  })

  it('dragging moves start and target together; dragging the end moves the target, never before the start', () => {
    const bar = { start: '2026-10-10', startDate: null, target: '2026-10-20' }
    expect(draggedDates(bar, { mode: 'move', deltaDays: 3 })).toEqual({ startDate: '2026-10-13', targetDate: '2026-10-23' })
    expect(draggedDates(bar, { mode: 'end', deltaDays: 5 })).toEqual({ startDate: null, targetDate: '2026-10-25' })
    expect(draggedDates(bar, { mode: 'end', deltaDays: -30 })).toEqual({ startDate: null, targetDate: '2026-10-10' })
  })
})
