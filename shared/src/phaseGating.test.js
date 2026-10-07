import { describe, it, expect } from 'vitest'
import { canAddPhase, canRemovePhase, applyActivePhases, PRESETS } from './phaseGating.js'
import { PHASE_KEYS } from './phaseCalculations.js'

const noData = () => false
const hasData = (key) => key === 'survey'

describe('canAddPhase / canRemovePhase', () => {
  it('a phase not yet active can be added', () => {
    expect(canAddPhase('hld', ['cmo'])).toBe(true)
  })
  it('a phase already active cannot be added again', () => {
    expect(canAddPhase('cmo', ['cmo'])).toBe(false)
  })
  it('an unknown phase key cannot be added', () => {
    expect(canAddPhase('not-a-phase', [])).toBe(false)
  })
  it('a phase with no data can be removed; one with data cannot', () => {
    expect(canRemovePhase('cmo', noData)).toBe(true)
    expect(canRemovePhase('survey', hasData)).toBe(false)
  })
})

describe('applyActivePhases', () => {
  it('orders the result by brief order, regardless of input order', () => {
    const result = applyActivePhases({ currentActivePhases: [], nextPhaseKeys: ['hld', 'cmo', 'survey'], phaseHasData: noData })
    expect(result.ok).toBe(true)
    expect(result.activePhases).toEqual([
      { phaseKey: 'cmo', position: 0 },
      { phaseKey: 'survey', position: 1 },
      { phaseKey: 'hld', position: 2 },
    ])
  })

  it('refuses to remove a phase that has data', () => {
    const result = applyActivePhases({ currentActivePhases: PHASE_KEYS, nextPhaseKeys: PHASE_KEYS.filter((k) => k !== 'survey'), phaseHasData: hasData })
    expect(result).toEqual({ ok: false, error: 'Cannot remove survey: it already has data' })
  })

  it('allows removing a phase with no data', () => {
    const result = applyActivePhases({ currentActivePhases: PHASE_KEYS, nextPhaseKeys: PHASE_KEYS.filter((k) => k !== 'cmdb'), phaseHasData: noData })
    expect(result.ok).toBe(true)
    expect(result.activePhases.map((p) => p.phaseKey)).not.toContain('cmdb')
  })

  it('refuses duplicates, unknown phases and an empty list', () => {
    expect(applyActivePhases({ currentActivePhases: [], nextPhaseKeys: ['cmo', 'cmo'], phaseHasData: noData }).ok).toBe(false)
    expect(applyActivePhases({ currentActivePhases: [], nextPhaseKeys: ['not-a-phase'], phaseHasData: noData }).ok).toBe(false)
    expect(applyActivePhases({ currentActivePhases: [], nextPhaseKeys: [], phaseHasData: noData }).ok).toBe(false)
  })
})

describe('presets', () => {
  it('Full Network Deployment is all nine phases in order', () => {
    expect(PRESETS.full_network_deployment).toEqual(PHASE_KEYS)
  })
  it('Survey & Design Only stops at Solution Package', () => {
    expect(PRESETS.survey_and_design_only).toEqual(['cmo', 'survey', 'hld', 'lld', 'solution-package'])
  })
})
