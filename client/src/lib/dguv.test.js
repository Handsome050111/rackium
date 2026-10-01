import { describe, it, expect } from 'vitest'
import { computeDguvStatus, addMonths } from './dguv.js'

const today = new Date('2026-10-01T00:00:00Z')

describe('computeDguvStatus', () => {
  it('returns null for a non-mains-powered device — no DGUV obligation at all', () => {
    expect(computeDguvStatus({ lastInspectionDate: '2024-01-01', mainsPowered: false }, today)).toBeNull()
  })

  it('is overdue when there is no recorded inspection yet', () => {
    const result = computeDguvStatus({ lastInspectionDate: null, mainsPowered: true }, today)
    expect(result.status).toBe('overdue')
  })

  it('is valid comfortably inside the 48-month interval', () => {
    // Inspected 1 month ago -> due in 47 months, nowhere near any threshold.
    const result = computeDguvStatus({ lastInspectionDate: '2026-09-01', mainsPowered: true }, today)
    expect(result.status).toBe('valid')
  })

  it('is "expiring soon" at exactly 90 days out', () => {
    const dueIn90Days = addMonths(today, -48)
    dueIn90Days.setDate(dueIn90Days.getDate() + 90)
    const result = computeDguvStatus({ lastInspectionDate: dueIn90Days.toISOString(), mainsPowered: true }, today)
    expect(result.status).toBe('expiring_soon')
    expect(result.daysRemaining).toBe(90)
  })

  it('is "expiring" at exactly 30 days out', () => {
    const dueIn30Days = addMonths(today, -48)
    dueIn30Days.setDate(dueIn30Days.getDate() + 30)
    const result = computeDguvStatus({ lastInspectionDate: dueIn30Days.toISOString(), mainsPowered: true }, today)
    expect(result.status).toBe('expiring')
  })

  it('is overdue once the due date has passed', () => {
    const result = computeDguvStatus({ lastInspectionDate: '2020-01-01', mainsPowered: true }, today)
    expect(result.status).toBe('overdue')
    expect(result.daysRemaining).toBeLessThan(0)
  })

  it('is valid just past the 90-day boundary (91 days out)', () => {
    const dueIn91Days = addMonths(today, -48)
    dueIn91Days.setDate(dueIn91Days.getDate() + 91)
    const result = computeDguvStatus({ lastInspectionDate: dueIn91Days.toISOString(), mainsPowered: true }, today)
    expect(result.status).toBe('valid')
  })
})
