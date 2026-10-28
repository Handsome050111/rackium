import { describe, it, expect } from 'vitest'
import { modeOf, resolveModeLabels, inFuture, modeStatesOf, applyModeView, decisionText, DEFAULT_MODE_LABELS, DEFAULT_MODE_VIEW } from './modeState.js'
import { modeFindings, uplinkChecks, HLD_RULES } from './hldRules.js'
import { diffDesigns } from './lldDesign.js'
import { buildBom } from './bomCalc.js'
import { hldCmoDecisionBody, projectModeLabelsBody, hldDeviceCreateBody, hldUplinkUpdateBody } from './contracts.js'

// M7b-4a: mode states CMO / IMO / FMO (addendum v2.3 Q5; DATA-MODEL §5.21).
const ID = (n) => String(n).padStart(24, '0')

describe('Mode states: Rackium values, configured labels', () => {
  it('a record without a mode reads as current when existing, future when designed', () => {
    expect(modeOf({ origin: 'existing' })).toBe('current')
    expect(modeOf({ origin: 'planned' })).toBe('future')
    expect(modeOf({})).toBe('future')
    expect(modeOf({ origin: 'planned', modeState: 'interim' })).toBe('interim')
    expect(modeOf({ origin: 'planned', modeState: 'bogus' })).toBe('future')
  })
  it('labels: CMO / IMO / FMO, the organisation’s over them, the project’s over those; blanks are ignored', () => {
    expect(resolveModeLabels()).toEqual(DEFAULT_MODE_LABELS)
    expect(resolveModeLabels({ current: 'As-Is', future: '  ' }, { future: 'To-Be', interim: null })).toEqual({ current: 'As-Is', interim: 'IMO', future: 'To-Be' })
  })
  it('the contracts: labels 1–24 characters or null; a decision names what it needs and nothing else', () => {
    expect(projectModeLabelsBody.safeParse({ modeLabels: { current: 'As-Is' } }).success).toBe(true)
    expect(projectModeLabelsBody.safeParse({ modeLabels: { current: null } }).success).toBe(true)
    expect(projectModeLabelsBody.safeParse({ modeLabels: { current: 'x'.repeat(25) } }).success).toBe(false)
    expect(projectModeLabelsBody.safeParse({ modeLabels: {} }).success).toBe(false)
    expect(hldCmoDecisionBody.safeParse({ decision: 'keep', role: 'edge', baseRevision: 1 }).success).toBe(true)
    expect(hldCmoDecisionBody.safeParse({ decision: 'keep', baseRevision: 1 }).success).toBe(false)
    expect(hldCmoDecisionBody.safeParse({ decision: 'replace', replacedById: ID(1), baseRevision: 1 }).success).toBe(true)
    expect(hldCmoDecisionBody.safeParse({ decision: 'remove', replacedById: ID(1), baseRevision: 1 }).success).toBe(false)
    // Design writes take interim or future, never current (that is existing gear's).
    expect(hldDeviceCreateBody.safeParse({ buildingId: ID(1), role: 'edge', roomId: ID(2), modeState: 'current', baseRevision: 0 }).success).toBe(false)
    expect(hldUplinkUpdateBody.safeParse({ modeState: 'interim', baseRevision: 0 }).success).toBe(true)
  })
})

describe('Which devices are in the future design, and where the canvas draws them', () => {
  const planned = { id: 'p', origin: 'planned' }
  const temp = { id: 't', origin: 'planned', modeState: 'interim' }
  const undecided = { id: 'u', origin: 'existing', cmo: true, cmoDecision: null }
  const kept = { id: 'k', origin: 'existing', cmo: true, cmoDecision: { decision: 'keep' } }
  const removed = { id: 'r', origin: 'existing', cmo: true, cmoDecision: { decision: 'remove' } }
  const applied = { id: 'a', origin: 'existing', cmo: true, modeState: 'future', cmoDecision: null }
  const shelf = { id: 's', origin: 'existing' }
  it('designed future gear is; interim kit never; CMO gear when kept (or applied); undecided CMO gear is not judged; surveyed generic gear stays', () => {
    expect([planned, temp, undecided, kept, removed, applied, shelf].map(inFuture)).toEqual([true, false, null, true, false, true, true])
    expect(modeStatesOf(kept)).toEqual(['current', 'future'])
    expect(modeStatesOf(removed)).toEqual(['current'])
    expect(modeStatesOf(temp)).toEqual(['interim'])
  })
  it('each state shown, overlaid (a ghost) or hidden; a link needs both ends drawn and is a ghost with a ghost end', () => {
    const devices = [planned, temp, kept, removed]
    const connections = [
      { id: 'c1', source: { deviceId: 'p' }, dest: { deviceId: 'k' } },
      { id: 'c2', source: { deviceId: 'p' }, dest: { deviceId: 't' }, modeState: 'interim' },
      { id: 'c3', source: { deviceId: 'p' }, dest: { deviceId: 'r' } },
    ]
    // The default: CMO hidden — a kept device still shows, as part of the FMO.
    const def = applyModeView({ devices, connections }, DEFAULT_MODE_VIEW)
    expect(def.devices.map((d) => [d.id, d.ghost])).toEqual([['p', false], ['t', false], ['k', false]])
    expect(def.connections.map((c) => c.id)).toEqual(['c1', 'c2'])
    // CMO overlaid, IMO hidden: the removed device is a ghost, its link too.
    const overlay = applyModeView({ devices, connections }, { current: 'overlay', interim: 'hide', future: 'show' })
    expect(overlay.devices.map((d) => [d.id, d.ghost])).toEqual([['p', false], ['k', false], ['r', true]])
    expect(overlay.connections.map((c) => [c.id, c.ghost])).toEqual([['c1', false], ['c3', true]])
    // Only the CMO: what is there today.
    const cmo = applyModeView({ devices, connections }, { current: 'show', interim: 'hide', future: 'hide' })
    expect(cmo.devices.map((d) => d.id)).toEqual(['k', 'r'])
    expect(cmo.connections).toEqual([])
  })
  it('the line under a CMO device names its decision, in the configured words', () => {
    expect(decisionText(null)).toBe('No decision yet')
    expect(decisionText({ decision: 'keep', hostname: 'E-1' })).toBe('Keep → E-1')
    expect(decisionText({ decision: 'replace', replacedByName: 'E-2' })).toBe('Replaced by E-2')
    expect(decisionText({ decision: 'remove' }, { ...DEFAULT_MODE_LABELS, current: 'As-Is' })).toBe('Remove (As-Is only)')
  })
})

describe('The mode rules (shared by the HLD and the LLD)', () => {
  const devices = [
    { id: 'p', origin: 'planned', label: 'B-1' },
    { id: 't', origin: 'planned', modeState: 'interim', label: 'TMP-1' },
    { id: 'r', origin: 'existing', cmo: true, label: 'OLD-1', cmoDecision: { decision: 'remove' } },
    { id: 'x', origin: 'existing', cmo: true, label: 'OLD-2', cmoDecision: { decision: 'replace', replacedById: 'gone' } },
    { id: 'u', origin: 'existing', cmo: true, label: 'OLD-3', cmoDecision: null },
  ]
  const deviceById = new Map(devices.map((d) => [d.id, d]))
  const link = (id, dest, modeState) => ({ id, source: { deviceId: 'p' }, dest: { deviceId: dest }, ...(modeState ? { modeState } : {}) })
  it('E-MODE-LINK: an FMO link to interim kit or to CMO gear marked Remove or Replace is Critical; an IMO link, or one to undecided gear, is not', () => {
    expect(HLD_RULES['E-MODE-LINK'].severity).toBe('critical')
    const found = modeFindings({ connections: [link('1', 't'), link('2', 'r'), link('3', 'x'), link('4', 'u'), link('5', 't', 'interim')], deviceById })
    expect(found.map((f) => f.objectId)).toEqual(['1', '2', '3'])
    expect(found[0].message).toBe('B-1 → TMP-1: this FMO link ends on TMP-1, which is IMO only — make the link IMO, or change the device')
    expect(found[1].message).toMatch(/ends on OLD-1, which is marked Remove \(CMO only\)/)
    expect(found[2].message).toMatch(/ends on OLD-2, which is being replaced \(CMO only\)/)
  })
  it('W-NO-DECISION: CMO gear without a decision, or whose replacement left the design — a warning; messages use the configured labels', () => {
    expect(HLD_RULES['W-NO-DECISION'].severity).toBe('warning')
    const labels = { current: 'As-Is', interim: 'Transition', future: 'To-Be' }
    const found = modeFindings({ connections: [], deviceById, cmoDevices: devices.filter((d) => d.cmo), labels })
    expect(found.map((f) => [f.objectId, f.rule])).toEqual([['x', 'W-NO-DECISION'], ['u', 'W-NO-DECISION']])
    expect(found[1].message).toBe('OLD-3: no decision yet — keep it in the To-Be, replace it or remove it')
    expect(modeFindings({ connections: [link('1', 't')], deviceById, labels })[0].message).toBe('B-1 → TMP-1: this To-Be link ends on TMP-1, which is Transition only — make the link Transition, or change the device')
  })
  it('the Edit Uplink check fails a draft FMO link to interim kit and blocks it', () => {
    const ctx = { deviceById, itemOf: () => null, opticOf: () => null, patchPanelFreePorts: () => null }
    const res = uplinkChecks({ ...link('d', 't'), media: 'cat6a', speed: '1G', lengthM: 5 }, ctx)
    expect(res.blocked).toBe(true)
    expect(res.checks.find((c) => c.id === 'mode-state')).toMatchObject({ status: 'fail' })
    expect(uplinkChecks({ ...link('d', 't', 'interim'), media: 'cat6a', speed: '1G', lengthM: 5 }, ctx).checks.find((c) => c.id === 'mode-state')).toBeUndefined()
  })
})

describe('Diffs and the BOM', () => {
  it('a change of mode or of a CMO decision is a change; snapshots from before carry no mode and read as FMO', () => {
    const before = { devices: [{ id: 'd1', hostname: 'E-1', role: 'edge' }], connections: [], cmoDecisions: [] }
    const after = { devices: [{ id: 'd1', hostname: 'E-1', role: 'edge', origin: 'planned', modeState: 'future' }], connections: [], cmoDecisions: [{ deviceId: 'c1', name: 'OLD-1', decision: 'keep', hostname: 'E-2', replacedById: null }] }
    const diff = diffDesigns(before, after)
    expect(diff.devices.changed).toEqual([])
    expect(diff.decisions.added).toEqual([{ id: 'c1', label: 'OLD-1' }])
    expect(diff.total).toBe(1)
    const interim = diffDesigns(after, { ...after, devices: [{ ...after.devices[0], modeState: 'interim' }] })
    expect(interim.devices.changed[0].fields).toEqual([{ field: 'modeState', before: 'future', after: 'interim' }])
    // LLD snapshots carry no decisions: no key, as before.
    expect(diffDesigns({ devices: [], connections: [] }, { devices: [], connections: [] })).not.toHaveProperty('decisions')
  })
  it('interim kit is bought like the rest, and its lines say "Interim" with the configured label', () => {
    const design = {
      devices: [{ id: 'e1', role: 'edge', category: 'switch', hostname: 'TMP-1', modeState: 'interim' }],
      connections: [{ id: 'c1', cableId: 'C-1', media: 'cat6a', source: { deviceId: 'e1' }, dest: { deviceId: 'e2' }, hops: [], lengths: { effectiveM: 5 }, modeState: 'interim' }],
    }
    const bom = buildBom(design, { stage: 'hld', catalogue: [], modeLabels: { interim: 'Transition' } })
    const device = bom.lines.find((l) => l.key === 'device:e1')
    expect(device.basis).toBe('Planned edge in the HLD — Interim (Transition)')
    expect(bom.lines.find((l) => l.key.startsWith('cable:cat6a')).basis).toMatch(/C-1 at 5 m \(Suggested\) — Interim \(Transition\)$/)
    expect(buildBom({ ...design, devices: [{ ...design.devices[0], modeState: 'future' }] }, { stage: 'hld', catalogue: [] }).lines.find((l) => l.key === 'device:e1').basis).toBe('Planned edge in the HLD')
  })
})
