import { describe, it, expect } from 'vitest'
import { computeOverallProgress, findCurrentPhase, countByType } from './phaseCalculations.js'

describe('computeOverallProgress', () => {
  it('averages weighted status across all phases', () => {
    const phases = [
      { phaseId: 'cmo', status: 'completed' },
      { phaseId: 'survey', status: 'approved' },
      { phaseId: 'hld', status: 'approved' },
      { phaseId: 'lld', status: 'in_progress' },
      { phaseId: 'solution-package', status: 'not_started' },
      { phaseId: 'bom', status: 'in_progress' },
      { phaseId: 'deployment', status: 'not_started' },
      { phaseId: 'cmdb', status: 'not_started' },
      { phaseId: 'handover', status: 'not_started' },
    ]
    // (1 + 1 + 1 + 0.5 + 0 + 0.5 + 0 + 0 + 0) / 9 = 0.4444 -> 44%
    expect(computeOverallProgress(phases)).toBe(44)
  })

  it('returns 0 for an empty phase list', () => {
    expect(computeOverallProgress([])).toBe(0)
  })

  it('returns 100 when every phase is approved or completed', () => {
    const phases = [
      { phaseId: 'a', status: 'completed' },
      { phaseId: 'b', status: 'approved' },
    ]
    expect(computeOverallProgress(phases)).toBe(100)
  })
})

describe('findCurrentPhase', () => {
  const order = ['cmo', 'survey', 'hld', 'lld', 'bom']

  it('picks the first phase that is not approved or completed', () => {
    const phases = [
      { phaseId: 'cmo', status: 'completed' },
      { phaseId: 'survey', status: 'approved' },
      { phaseId: 'hld', status: 'approved' },
      { phaseId: 'lld', status: 'in_progress' },
      { phaseId: 'bom', status: 'not_started' },
    ]
    expect(findCurrentPhase(phases, order)).toBe('lld')
  })

  it('falls back to the last phase when everything is resolved', () => {
    const phases = order.map((phaseId) => ({ phaseId, status: 'completed' }))
    expect(findCurrentPhase(phases, order)).toBe('bom')
  })
})

describe('countByType', () => {
  it('counts only items matching the given type', () => {
    const items = [
      { type: 'blocker' },
      { type: 'blocker' },
      { type: 'approval' },
    ]
    expect(countByType(items, 'blocker')).toBe(2)
    expect(countByType(items, 'approval')).toBe(1)
    expect(countByType(items, 'other')).toBe(0)
  })
})
