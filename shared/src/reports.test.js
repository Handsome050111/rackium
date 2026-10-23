import { describe, it, expect } from 'vitest'
import { scheduleDueOn, nextScheduleDate, describeSchedule, phaseDurations, blockerFrequency, blockerResolution, bomVariance, surveyCompletion, approvalTurnaround, monthlyTrend, daysBetween, REPORTS } from './reports.js'
import { DOCUMENT_TYPES, requestProblem, isPersonalDocument } from './documents/types.js'
import { REPORT_ASSEMBLERS, bomSummary, surveyProgress, reportCsv } from './documents/reports.js'
import { plainText } from './documents/model.js'

describe('report schedules: sent on their local day once the local time is reached (M7a-3)', () => {
  const weekly = { frequency: 'weekly', weekday: 1, time: '07:00', lastSentOn: null }
  it('Berlin, Monday 07:00 across the October DST change (CEST → CET)', () => {
    // 2026-10-19 is a Monday in CEST (UTC+2); 2026-10-26 a Monday in CET (UTC+1).
    expect(scheduleDueOn(weekly, new Date('2026-10-19T04:59:00Z'), 'Europe/Berlin')).toBeNull()
    expect(scheduleDueOn(weekly, new Date('2026-10-19T05:00:00Z'), 'Europe/Berlin')).toBe('2026-10-19')
    expect(scheduleDueOn(weekly, new Date('2026-10-26T05:30:00Z'), 'Europe/Berlin')).toBeNull()
    expect(scheduleDueOn(weekly, new Date('2026-10-26T06:00:00Z'), 'Europe/Berlin')).toBe('2026-10-26')
    // Once sent that day, not again; another weekday never.
    expect(scheduleDueOn({ ...weekly, lastSentOn: '2026-10-26' }, new Date('2026-10-26T10:00:00Z'), 'Europe/Berlin')).toBeNull()
    expect(scheduleDueOn(weekly, new Date('2026-10-27T06:00:00Z'), 'Europe/Berlin')).toBeNull()
  })
  it('New York and a monthly day; the local date decides, not UTC', () => {
    const monthly = { frequency: 'monthly', dayOfMonth: 2, time: '07:00' }
    // 2026-11-02 07:00 EST is 12:00Z; at 03:00Z it is still Nov 1 in New York.
    expect(scheduleDueOn(monthly, new Date('2026-11-02T03:00:00Z'), 'America/New_York')).toBeNull()
    expect(scheduleDueOn(monthly, new Date('2026-11-02T11:59:00Z'), 'America/New_York')).toBeNull()
    expect(scheduleDueOn(monthly, new Date('2026-11-02T12:00:00Z'), 'America/New_York')).toBe('2026-11-02')
    expect(nextScheduleDate(monthly, new Date('2026-11-02T13:00:00Z'), 'America/New_York')).toBe('2026-12-02')
    expect(nextScheduleDate(weekly, new Date('2026-10-26T04:00:00Z'), 'Europe/Berlin')).toBe('2026-10-26')
    expect(describeSchedule(weekly)).toBe('Weekly on Monday at 07:00')
  })
})

describe('analytics: six metrics with monthly trends; unknown dates left out and counted', () => {
  it('phase duration: previous phase’s completion (or the planned start) to completion; unknown dates excluded', () => {
    const history = [
      { buildingId: 'b1', phaseKey: 'cmo', event: 'completed', on: '2026-06-10', dateKnown: true },
      { buildingId: 'b1', phaseKey: 'survey', event: 'completed', on: '2026-07-10', dateKnown: true },
      { buildingId: 'b2', phaseKey: 'cmo', event: 'completed', on: null, dateKnown: false },
      { buildingId: 'b2', phaseKey: 'survey', event: 'completed', on: '2026-07-01', dateKnown: true },
      // Reopened: no current completion, not counted at all.
      { buildingId: 'b1', phaseKey: 'hld', event: 'completed', on: '2026-07-20', dateKnown: true },
      { buildingId: 'b1', phaseKey: 'hld', event: 'reopened', on: '2026-07-21', dateKnown: true },
    ]
    const out = phaseDurations({ history, phaseKeys: ['cmo', 'survey', 'hld'], buildingIds: ['b1', 'b2'], startOf: (b) => (b === 'b1' ? '2026-06-01' : null) })
    expect(out.phases).toEqual([{ phaseKey: 'cmo', avgDays: 9, count: 1 }, { phaseKey: 'survey', avgDays: 30, count: 1 }, { phaseKey: 'hld', avgDays: null, count: 0 }])
    // b2: CMO date unknown, and so its survey's start → both excluded.
    expect(out.excluded).toBe(2)
    expect(out.trend).toEqual([{ period: '2026-06', value: 9, count: 1 }, { period: '2026-07', value: 30, count: 1 }])
  })
  it('blocker frequency and resolution; approval turnaround without the PM’s BOM sign-off', () => {
    const blockers = [
      { phaseKey: 'survey', status: 'resolved', raisedOn: '2026-08-01', resolvedOn: '2026-08-05' },
      { phaseKey: 'survey', status: 'open', raisedOn: '2026-08-20', resolvedOn: null },
      { phaseKey: 'hld', status: 'resolved', raisedOn: '2026-09-01', resolvedOn: null },
    ]
    expect(blockerFrequency({ blockers })).toMatchObject({ total: 3, byPhase: { survey: 2, hld: 1 }, excluded: 0, trend: [{ period: '2026-08', value: 2 }, { period: '2026-09', value: 1 }] })
    expect(blockerResolution({ blockers })).toMatchObject({ avgDays: 4, count: 1, open: 1, excluded: 1 })
    const approvals = [
      { gate: 'hld_internal', status: 'approved', submittedAt: '2026-08-01T08:00:00Z', decidedAt: '2026-08-03T08:00:00Z' },
      { gate: 'sp_client', status: 'changes_requested', submittedAt: '2026-08-10T08:00:00Z', decidedAt: '2026-08-11T20:00:00Z' },
      { gate: 'lld_internal', status: 'approved', submittedAt: null, decidedAt: '2026-08-12T08:00:00Z' },
      { gate: 'lld_internal', status: 'pending', submittedAt: '2026-08-15T08:00:00Z', decidedAt: null },
      { gate: 'bom_pm', status: 'approved', submittedAt: '2026-08-15T08:00:00Z', decidedAt: '2026-08-15T08:00:00Z' },
    ]
    const t = approvalTurnaround({ approvals })
    expect(t).toMatchObject({ avgDays: 1.8, count: 2, pending: 1, excluded: 1 })
    expect(t.byGate).toEqual([{ gate: 'hld_internal', avgDays: 2, count: 1 }, { gate: 'sp_client', avgDays: 1.5, count: 1 }])
  })
  it('BOM variance: latest approved procurement BOM against the first; unreadable versions excluded', () => {
    const lines = (q) => [{ key: 'device:a', qty: 1 }, { key: 'cable:x', qty: q }]
    const out = bomVariance({
      versions: [
        { buildingId: 'b1', number: 1, on: '2026-08-01', lines: lines(9) },
        { buildingId: 'b1', number: 2, on: '2026-09-01', lines: [...lines(14), { key: 'device:b', qty: 1 }] },
        { buildingId: 'b2', number: 1, on: '2026-08-15', lines: lines(4) },
        { buildingId: 'b3', number: 1, on: '2026-08-15', lines: null },
      ],
    })
    expect(out.buildings).toEqual([{ buildingId: 'b1', versions: 2, variancePct: 60 }, { buildingId: 'b2', versions: 1, variancePct: 0 }])
    expect(out).toMatchObject({ avgVariancePct: 30, changed: 1, excluded: 1 })
  })
  it('survey completion overall and per technician; verified tabs without a date excluded from the trend', () => {
    const out = surveyCompletion({
      expected: 4,
      records: [
        { status: 'verified', submittedBy: 'u1', verifiedOn: '2026-08-02' },
        { status: 'rejected', submittedBy: 'u1', verifiedOn: null },
        { status: 'imported', submittedBy: 'u2', verifiedOn: '2026-09-02' },
        { status: 'verified', submittedBy: null, verifiedOn: null },
      ],
    })
    expect(out).toMatchObject({ verified: 3, completionPct: 75, excluded: 1 })
    expect(out.byTechnician.map((x) => [x.userId, x.submitted, x.verified, x.rejected, x.completionPct])).toEqual([['u1', 2, 1, 1, 50], ['u2', 1, 1, 0, 100]])
  })
  it('trend helpers', () => {
    expect(monthlyTrend([{ on: '2026-02-01' }, { on: '2026-01-31' }, { on: '2026-02-28' }], 'sum')).toEqual([{ period: '2026-01', value: 1, count: 1 }, { period: '2026-02', value: 2, count: 2 }])
    // Calendar days: the DST change on 2026-10-25 does not make it 6.96.
    expect(daysBetween('2026-10-22', '2026-10-29')).toBe(7)
  })
})

describe('the seven standard reports in the document engine', () => {
  it('are project-level document types in PDF, CSV and Excel, each with an assembler', () => {
    for (const r of REPORTS) {
      const t = DOCUMENT_TYPES.find((x) => x.key === r.key)
      expect(t, r.key).toMatchObject({ scope: 'project', report: true, formats: ['pdf', 'csv', 'xlsx'] })
      expect(typeof REPORT_ASSEMBLERS[r.key]).toBe('function')
      expect(isPersonalDocument({ typeKey: r.key })).toBe(true)
    }
    expect(REPORTS).toHaveLength(7)
    expect(isPersonalDocument({ typeKey: 'audit-log' })).toBe(false)
  })
  it('Resource Utilisation: Org Admin and PM only; BOM Summary prices follow the price rules', () => {
    for (const roles of [['architect'], ['reviewer'], ['field_engineer'], ['viewer']]) expect(requestProblem({ typeKey: 'resource-utilisation', format: 'pdf', roles })).toMatch(/Org Admin or PM/)
    expect(requestProblem({ typeKey: 'resource-utilisation', format: 'csv', roles: ['pm'] })).toBeNull()
    expect(requestProblem({ typeKey: 'bom-summary', format: 'xlsx', options: { prices: 'sell' }, roles: ['viewer'], canSeePrices: false })).toMatch(/may see prices/)
    expect(requestProblem({ typeKey: 'bom-summary', format: 'xlsx', options: { prices: 'cost' }, roles: ['architect'], canSeePrices: true })).toMatch(/cost prices/)
    expect(requestProblem({ typeKey: 'survey-progress', format: 'pdf', options: { prices: 'sell' }, roles: ['pm'], canSeePrices: true })).toMatch(/no prices/)
  })
  it('BOM Summary shows a client price, a cost (marked internal) or no value at all', () => {
    const data = { today: '2026-10-23', timeZone: 'Europe/Berlin', scope: { buildings: 1, limited: false }, currency: 'EUR', marginPercent: 20, buildings: [{ code: 'B001', approved: 'v1', lines: 3, serialised: 2, unpriced: 0, statuses: { delivered: 1 }, costMinor: 100000 }] }
    const ctx = { project: { name: 'P' } }
    const none = bomSummary(ctx, data, { prices: 'none' })
    expect(plainText(none.doc)).not.toMatch(/EUR|1000|1200/)
    expect(none.sheets[0].rows[0]).not.toContain('Value — cost (EUR)')
    const sell = bomSummary(ctx, data, { prices: 'sell' })
    expect(plainText(sell.doc)).toMatch(/Total — client price: EUR 1200\.00/)
    expect(plainText(sell.doc)).not.toMatch(/cost|1000\.00/i)
    const cost = bomSummary(ctx, data, { prices: 'cost' })
    expect(plainText(cost.doc)).toMatch(/INTERNAL — cost prices/)
    expect(reportCsv(cost.sheets, { internal: true }).split('\r\n')[0]).toBe('INTERNAL — cost prices')
  })
  it('Survey Progress lists technicians only when the data has them', () => {
    const data = { today: '2026-10-23', timeZone: 'Europe/Berlin', scope: { buildings: 1, limited: true }, buildings: [{ code: 'B001', expected: 4, verified: 2, submitted: 1, rejected: 0, draft: 1, pct: 50 }] }
    expect(surveyProgress({}, data).doc.sections.map((s) => s.id)).toEqual(['summary', 'buildings'])
    const withPeople = surveyProgress({}, { ...data, byTechnician: [{ name: 'Fe One', submitted: 2, verified: 2, rejected: 0, pct: 100 }] })
    expect(plainText(withPeople.doc)).toMatch(/Fe One/)
    expect(plainText(surveyProgress({}, data).doc)).toMatch(/the buildings in your scope/)
  })
})
