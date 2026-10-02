import { describe, it, expect } from 'vitest'
import { computeChecklist, isReadyToCompile, computeDocumentStatus, handoverPhaseStatus, HANDOVER_DOCUMENTS } from './handoverModel.js'

const basePhaseStatus = {
  survey: 'approved',
  hld: 'approved',
  'solution-package': 'approved',
  bom: 'approved',
  deployment: 'completed',
}

function baseData(overrides = {}) {
  return {
    phaseStatus: basePhaseStatus,
    solutionPackageApproved: true,
    bomLines: [{ category: 'Network devices', procurementStatus: 'Delivered' }],
    deploymentDevices: [{ role: 'edge', status: 'tested' }],
    cmdbAwaitingAcceptance: 0,
    openExceptionCount: 0,
    signedOff: false,
    evidenceCount: 2,
    ...overrides,
  }
}

describe('computeChecklist', () => {
  it('every item is ok when all phases are done and nothing outstanding', () => {
    const checklist = computeChecklist(baseData())
    expect(checklist.filter((c) => c.id !== 'sign-off').every((c) => c.ok)).toBe(true)
  })

  it('flags an undelivered BOM line', () => {
    const checklist = computeChecklist(baseData({ bomLines: [{ category: 'Network devices', procurementStatus: 'Ordered' }] }))
    const bom = checklist.find((c) => c.id === 'bom')
    expect(bom.ok).toBe(false)
    expect(bom.detail).toContain('1')
  })

  it('flags an untested deployment device', () => {
    const checklist = computeChecklist(baseData({ deploymentDevices: [{ role: 'edge', status: 'installed' }] }))
    expect(checklist.find((c) => c.id === 'deployment').ok).toBe(false)
  })

  it('open exceptions never block the checklist — they are documented, not resolved', () => {
    const checklist = computeChecklist(baseData({ openExceptionCount: 3 }))
    const exc = checklist.find((c) => c.id === 'exceptions')
    expect(exc.ok).toBe(true)
    expect(exc.detail).toContain('3')
  })

  it('sign-off reflects the recorded client decision directly', () => {
    expect(computeChecklist(baseData({ signedOff: true })).find((c) => c.id === 'sign-off').ok).toBe(true)
    expect(computeChecklist(baseData({ signedOff: false })).find((c) => c.id === 'sign-off').ok).toBe(false)
  })
})

describe('isReadyToCompile', () => {
  it('is true even before sign-off, since sign-off only happens after delivery', () => {
    const checklist = computeChecklist(baseData({ signedOff: false }))
    expect(isReadyToCompile(checklist)).toBe(true)
  })

  it('is false when a real gate (not sign-off) fails', () => {
    const checklist = computeChecklist(baseData({ phaseStatus: { ...basePhaseStatus, hld: 'in_progress' } }))
    expect(isReadyToCompile(checklist)).toBe(false)
  })
})

describe('computeDocumentStatus', () => {
  it('exception register is ok only with zero open exceptions', () => {
    expect(computeDocumentStatus('exception-register', baseData({ openExceptionCount: 0 })).ok).toBe(true)
    expect(computeDocumentStatus('exception-register', baseData({ openExceptionCount: 1 })).ok).toBe(false)
  })

  it('photo evidence pack needs at least one recorded photo', () => {
    expect(computeDocumentStatus('photo-evidence', baseData({ evidenceCount: 0 })).ok).toBe(false)
    expect(computeDocumentStatus('photo-evidence', baseData({ evidenceCount: 1 })).ok).toBe(true)
  })

  it('every document id in HANDOVER_DOCUMENTS resolves to a status without throwing', () => {
    for (const doc of HANDOVER_DOCUMENTS) {
      expect(() => computeDocumentStatus(doc.id, baseData())).not.toThrow()
    }
  })
})

describe('handoverPhaseStatus', () => {
  it('maps the fine-grained workflow onto the shared 7-value badge vocabulary', () => {
    expect(handoverPhaseStatus('pending')).toBe('not_started')
    expect(handoverPhaseStatus('ready')).toBe('not_started')
    expect(handoverPhaseStatus('compiled')).toBe('in_progress')
    expect(handoverPhaseStatus('under_review')).toBe('awaiting_approval')
    expect(handoverPhaseStatus('delivered')).toBe('awaiting_approval')
    expect(handoverPhaseStatus('accepted')).toBe('approved')
    expect(handoverPhaseStatus('changes_requested')).toBe('changes_requested')
  })
})
