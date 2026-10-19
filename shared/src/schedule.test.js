import { describe, it, expect } from 'vitest'
import { localDate } from './timeZone.js'
import { isLocalDate, daysBetween, phaseRisk, scheduleBars, criticalPath, createsCycle, standardMilestones, nextMilestone, slaItemKeys, slaStatus, slaBurndown, phaseProgress, keyOf } from './schedule.js'

const P = ['survey', 'hld', 'lld']

describe('local dates', () => {
  it('validates calendar dates and counts calendar days', () => {
    expect(isLocalDate('2026-02-28')).toBe(true)
    expect(isLocalDate('2026-02-30')).toBe(false)
    expect(isLocalDate('2026-1-5')).toBe(false)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    // DST changes (Europe/Berlin 2026-10-25, 2027-03-28) are whole days.
    expect(daysBetween('2027-03-27', '2027-03-29')).toBe(2)
  })

  it("an SLA due on a DST day is breached exactly at the organisation's local midnight (Berlin, autumn and spring; New York)", () => {
    const sla = { startDate: '2026-10-01', dueDate: '2026-10-25' }
    const items = [{ done: false, events: [] }]
    const at = (iso, tz = 'Europe/Berlin') => slaStatus({ sla, items, today: localDate(new Date(iso), tz) }).status
    // 2026-10-25 23:59 CET = 22:59Z: still the due day; 00:00 CET on the 26th = 23:00Z: breached.
    expect(at('2026-10-25T22:59:00Z')).not.toBe('breached')
    expect(at('2026-10-25T23:00:00Z')).toBe('breached')
    const spring = { startDate: '2027-03-01', dueDate: '2027-03-28' }
    const atSpring = (iso) => slaStatus({ sla: spring, items, today: localDate(new Date(iso), 'Europe/Berlin') }).status
    // 2027-03-28 23:59 CEST = 21:59Z; midnight CEST = 22:00Z.
    expect(atSpring('2027-03-28T21:59:00Z')).not.toBe('breached')
    expect(atSpring('2027-03-28T22:00:00Z')).toBe('breached')
    // New York's midnight (EDT until 2026-11-01): 04:00Z.
    expect(at('2026-10-26T03:59:00Z', 'America/New_York')).not.toBe('breached')
    expect(at('2026-10-26T04:00:00Z', 'America/New_York')).toBe('breached')
  })
})

describe('phase bars and risk (v2.2 §21.4)', () => {
  const settings = { riskElapsedPct: 80, riskProgressPct: 50 }
  it('done, unscheduled, overdue, blocked, at risk, on track', () => {
    const base = { start: '2026-10-01', target: '2026-10-11', today: '2026-10-05', progress: 0, settings }
    expect(phaseRisk({ ...base, status: 'approved' })).toBe('done')
    expect(phaseRisk({ ...base, status: 'in_progress', target: null })).toBe('unscheduled')
    expect(phaseRisk({ ...base, status: 'in_progress', today: '2026-10-12' })).toBe('overdue')
    expect(phaseRisk({ ...base, status: 'in_progress', blocked: true })).toBe('blocked')
    expect(phaseRisk({ ...base, status: 'in_progress', predecessorsDone: false })).toBe('blocked')
    // 80 % of the time used (day 8 of 10) and under 50 % done.
    expect(phaseRisk({ ...base, status: 'in_progress', today: '2026-10-09', progress: 0.4 })).toBe('at_risk')
    expect(phaseRisk({ ...base, status: 'in_progress', today: '2026-10-09', progress: 0.5 })).toBe('on_track')
    expect(phaseRisk({ ...base, status: 'in_progress', today: '2026-10-07', progress: 0 })).toBe('on_track')
    // The thresholds are settings.
    expect(phaseRisk({ ...base, status: 'in_progress', today: '2026-10-07', progress: 0, settings: { riskElapsedPct: 60, riskProgressPct: 50 } })).toBe('at_risk')
  })

  it('a bar starts at the previous phase target unless its own start is set; progress uses the measure', () => {
    const rows = {
      [keyOf('b1', 'survey')]: { status: 'approved', startDate: '2026-09-01', targetDate: '2026-09-30', completedOn: '2026-09-27' },
      [keyOf('b1', 'hld')]: { status: 'in_progress', targetDate: '2026-10-20' },
      [keyOf('b1', 'lld')]: { status: 'not_started', startDate: '2026-10-25', targetDate: '2026-11-15' },
    }
    const { bars } = scheduleBars({ buildingIds: ['b1'], phaseKeys: P, rows, today: '2026-10-10' })
    expect(bars.map((b) => [b.phaseKey, b.start, b.target, b.risk])).toEqual([
      ['survey', '2026-09-01', '2026-09-30', 'done'],
      ['hld', '2026-09-30', '2026-10-20', 'on_track'],
      ['lld', '2026-10-25', '2026-11-15', 'on_track'],
    ])
    expect(phaseProgress('in_progress', 0.3)).toBe(0.3)
    expect(phaseProgress('in_progress')).toBe(0.5)
    expect(phaseProgress('approved', 0.1)).toBe(1)
  })

  it('a parallel phase has no predecessor in its building; a cross-building dependency blocks once the bar should have started', () => {
    const rows = {
      [keyOf('b1', 'survey')]: { status: 'in_progress', targetDate: '2026-10-30' },
      [keyOf('b2', 'survey')]: { status: 'in_progress', startDate: '2026-10-01', targetDate: '2026-10-20' },
      [keyOf('b2', 'hld')]: { status: 'not_started', targetDate: '2026-11-10' },
    }
    const dependencies = [{ from: { buildingId: 'b1', phaseKey: 'survey' }, to: { buildingId: 'b2', phaseKey: 'hld' } }]
    const { bars } = scheduleBars({ buildingIds: ['b1', 'b2'], phaseKeys: P, parallelPhases: ['hld'], dependencies, rows, today: '2026-10-22' })
    const b2hld = bars.find((b) => b.key === keyOf('b2', 'hld'))
    expect(b2hld.predecessors).toEqual([keyOf('b1', 'survey')])
    expect(b2hld.risk).toBe('blocked')
    // It starts (b2 survey target) before its dependency finishes (b1 survey target): a conflict.
    expect(b2hld.conflicts).toEqual([keyOf('b1', 'survey')])
  })

  it('the critical path follows the predecessor that finishes last, across buildings', () => {
    const rows = {
      [keyOf('b1', 'survey')]: { targetDate: '2026-10-10' },
      [keyOf('b1', 'hld')]: { targetDate: '2026-10-20' },
      [keyOf('b2', 'survey')]: { targetDate: '2026-10-25' },
      [keyOf('b2', 'hld')]: { targetDate: '2026-11-30' },
    }
    const dependencies = [{ from: { buildingId: 'b1', phaseKey: 'hld' }, to: { buildingId: 'b2', phaseKey: 'hld' } }]
    const { bars, critical, end } = scheduleBars({ buildingIds: ['b1', 'b2'], phaseKeys: ['survey', 'hld'], dependencies, rows, today: '2026-10-01' })
    expect(end).toBe('2026-11-30')
    // b2 hld's predecessors: b2 survey (10-25) and b1 hld (10-20) → b2 survey.
    expect(critical).toEqual([keyOf('b2', 'hld'), keyOf('b2', 'survey')])
    expect(criticalPath(bars).has(keyOf('b1', 'hld'))).toBe(false)
  })

  it('a dependency that closes a loop is refused, counting the phase order inside each building', () => {
    const args = { buildingIds: ['b1', 'b2'], phaseKeys: P, parallelPhases: [], dependencies: [{ from: { buildingId: 'b1', phaseKey: 'lld' }, to: { buildingId: 'b2', phaseKey: 'survey' } }] }
    expect(createsCycle({ ...args, candidate: { from: { buildingId: 'b2', phaseKey: 'hld' }, to: { buildingId: 'b1', phaseKey: 'survey' } } })).toBe(true)
    expect(createsCycle({ ...args, candidate: { from: { buildingId: 'b2', phaseKey: 'hld' }, to: { buildingId: 'b1', phaseKey: 'survey' } }, dependencies: [] })).toBe(false)
  })
})

describe('milestones (v2.2 §21.3)', () => {
  it('standard milestones follow their phase (due = target) and the procurement lines; overrides move the due date; the next is the earliest open', () => {
    const list = standardMilestones({
      buildingId: 'b1',
      phaseKeys: ['survey', 'hld', 'bom'],
      barsByPhase: { survey: { status: 'approved', target: '2026-10-01', completedOn: '2026-09-29' }, hld: { status: 'in_progress', target: '2026-10-20' }, bom: { status: 'not_started', target: '2026-11-05' } },
      procurement: { ordered: { done: false }, delivered: { done: false } },
      overrides: { materials_delivered: '2026-11-20' },
    })
    expect(list.map((m) => [m.standardKey, m.dueDate, m.done])).toEqual([
      ['survey_complete', '2026-10-01', true],
      ['hld_approved', '2026-10-20', false],
      ['bom_approved', '2026-11-05', false],
      ['materials_ordered', '2026-11-05', false],
      ['materials_delivered', '2026-11-20', false],
    ])
    expect(nextMilestone([...list, { name: 'Kick-off', dueDate: '2026-10-15', done: false }]).name).toBe('Kick-off')
  })
})

describe('SLAs (v2.2 §21.8)', () => {
  const sla = { startDate: '2026-10-01', dueDate: '2026-10-31' }
  const done = (on) => ({ done: true, events: [{ event: 'completed', on, dateKnown: Boolean(on) }] })
  const open = { done: false, events: [] }
  it('work items are the buildings × phases in scope', () => {
    expect(slaItemKeys({ sla: { buildingId: 'b2', phaseKey: null }, buildingIds: ['b1', 'b2'], phaseKeys: P })).toEqual(P.map((p) => keyOf('b2', p)))
    expect(slaItemKeys({ sla: { buildingId: null, phaseKey: 'hld' }, buildingIds: ['b1', 'b2'], phaseKeys: P })).toEqual([keyOf('b1', 'hld'), keyOf('b2', 'hld')])
  })
  it('met, breached, at risk by the linear projection, on track', () => {
    expect(slaStatus({ sla, items: [done('2026-10-05')], today: '2026-11-02' }).status).toBe('met')
    expect(slaStatus({ sla, items: [open], today: '2026-11-01' }).status).toBe('breached')
    // 1 of 4 done in 10 days → 3 left at 0.1/day → 30 more days → after the due date.
    const slow = slaStatus({ sla, items: [done('2026-10-05'), open, open, open], today: '2026-10-11' })
    expect(slow).toMatchObject({ status: 'at_risk', remaining: 3, projectedOn: '2026-11-10' })
    expect(slaStatus({ sla, items: [done('2026-10-02'), done('2026-10-03'), open], today: '2026-10-04' }).status).toBe('on_track')
    // Nothing done: at risk once half the time has gone.
    expect(slaStatus({ sla, items: [open], today: '2026-10-10' }).status).toBe('on_track')
    expect(slaStatus({ sla, items: [open], today: '2026-10-17' }).status).toBe('at_risk')
  })
  it('burn-down: remaining per day with the ideal line; a completion with no known date is done from the start; a reopened item counts again', () => {
    const items = [done(null), done('2026-10-03'), { done: false, events: [{ event: 'completed', on: '2026-10-02' }, { event: 'reopened', on: '2026-10-04' }] }, open]
    const series = slaBurndown({ sla: { startDate: '2026-10-01', dueDate: '2026-10-05' }, items, today: '2026-10-04' })
    expect(series.map((d) => [d.date, d.actual, d.ideal])).toEqual([
      ['2026-10-01', 3, 4],
      ['2026-10-02', 2, 3],
      ['2026-10-03', 1, 2],
      ['2026-10-04', 2, 1],
      ['2026-10-05', null, 0],
    ])
  })
})
