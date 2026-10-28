import { describe, it, expect } from 'vitest'
import { cutoverRemovalOf } from './modeState.js'
import { handoverChecklist, checklistReady, oldGearCovered } from './documents/handover.js'
import { cmdbRowsOf } from './documents/assemble.js'
import { cutoverRemovalBody, oldGearOverrideBody } from './contracts.js'

// M7b-4b: after cutover (addendum v2.3 Q5; DATA-MODEL §5.22).

describe('What is removed after cutover', () => {
  it('interim kit, and CMO gear marked Replace or Remove; nothing else — not kept, undecided or applied gear, not generic surveyed gear', () => {
    expect(cutoverRemovalOf({ origin: 'planned', modeState: 'interim' })).toBe('interim')
    expect(cutoverRemovalOf({ origin: 'planned' })).toBe(null)
    expect(cutoverRemovalOf({ origin: 'existing', cmo: true, cmoDecision: { decision: 'replace' } })).toBe('cmo')
    expect(cutoverRemovalOf({ origin: 'existing', cmo: true, cmoDecision: { decision: 'remove' } })).toBe('cmo')
    expect(cutoverRemovalOf({ origin: 'existing', cmo: true, cmoDecision: { decision: 'keep' } })).toBe(null)
    expect(cutoverRemovalOf({ origin: 'existing', cmo: true, cmoDecision: null })).toBe(null)
    expect(cutoverRemovalOf({ origin: 'existing', cmo: true, modeState: 'future', cmoDecision: { decision: 'replace' } })).toBe(null)
    expect(cutoverRemovalOf({ origin: 'existing', cmoDecision: { decision: 'remove' } })).toBe(null)
  })
  it('the contracts: an optional note; keeping gear on site needs a reason (null withdraws it)', () => {
    expect(cutoverRemovalBody.safeParse({}).success).toBe(true)
    expect(cutoverRemovalBody.safeParse({ note: 'x', extra: 1 }).success).toBe(false)
    expect(oldGearOverrideBody.safeParse({ reason: '  ' }).success).toBe(false)
    expect(oldGearOverrideBody.safeParse({ reason: null }).success).toBe(true)
  })
})

describe('The handover checklist after cutover (decision 4 as ruled)', () => {
  const facts = (cutover, labels) => ({
    surveyVerified: true,
    hldApproved: true,
    lldApproved: true,
    spApproved: true,
    bom: { approved: true, lines: 1, undelivered: 0 },
    deployment: { planned: 1, accepted: 1 },
    cmdb: { designCount: 1, cmdbCount: 1 },
    exceptions: { open: 0, rejectedUncorrected: 0 },
    cutover,
    labels,
  })
  const item = (list, id) => list.find((i) => i.id === id)
  it('installed interim kit blocks; nothing left is green', () => {
    const blocked = handoverChecklist(facts({ interimOnSite: ['TMP-1'], cmoOnSite: [], override: null }))
    expect(item(blocked, 'interim')).toMatchObject({ ok: false, detail: '1 still installed: TMP-1' })
    expect(checklistReady(blocked)).toBe(false)
    expect(checklistReady(handoverChecklist(facts({ interimOnSite: [], cmoOnSite: [], override: null })))).toBe(true)
  })
  it('CMO gear left on site is a warning met by the PM keeping it with a reason — only for the devices covered then; labels are the project’s', () => {
    const onSite = [{ id: 'a', name: 'OLD-1' }, { id: 'b', name: 'OLD-2' }]
    const open = item(handoverChecklist(facts({ interimOnSite: [], cmoOnSite: onSite, override: null }, { current: 'As-Is', interim: 'Transition' })), 'old-gear')
    expect(open).toMatchObject({ ok: false, warning: true, overridable: true, label: 'As-Is gear marked Replace or Remove: removed', override: null })
    const covered = { interimOnSite: [], cmoOnSite: onSite, override: { reason: 'Spare', by: 'Pat PM', at: null, deviceIds: ['a', 'b'] } }
    expect(oldGearCovered(covered)).toBe(true)
    expect(item(handoverChecklist(facts(covered)), 'old-gear')).toMatchObject({ ok: true, detail: 'Kept on site (2): Spare — Pat PM', override: { reason: 'Spare', by: 'Pat PM' } })
    // A device not covered by the override: the warning is back.
    expect(oldGearCovered({ ...covered, cmoOnSite: [...onSite, { id: 'c', name: 'OLD-3' }] })).toBe(false)
    expect(item(handoverChecklist(facts({ interimOnSite: ['T'], cmoOnSite: [], override: null }, { interim: 'Transition' })), 'interim').label).toBe('Interim kit (Transition): removed after cutover')
  })
  it('a checklist without cutover facts is unchanged (older callers)', () => {
    const { cutover: _c, labels: _l, ...older } = facts(null)
    expect(handoverChecklist(older).map((i) => i.id)).not.toContain('interim')
  })
})

describe('The CMDB extract', () => {
  it('has the mode in the project’s words, after the legacy hostname', () => {
    expect(cmdbRowsOf([{ hostname: 'E-1', modeLabel: 'To-Be' }, { hostname: 'T-1' }]).map((r) => r.mode)).toEqual(['To-Be', ''])
  })
})
