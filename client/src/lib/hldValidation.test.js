import { describe, it, expect } from 'vitest'
import { validateUplink, hasBlockingFailure } from './hldValidation.js'

const baseArgs = {
  sourcePortFree: true,
  destPortFree: true,
  media: 'om4',
  speed: '10G',
  sourceSfp: 'SFP-10G-SR',
  destSfp: 'SFP-10G-SR',
  estimatedLengthM: 84,
  patchPanelFreePorts: null,
}

describe('validateUplink — correcting the render\'s OM4/distance mistake', () => {
  it('an 84m OM4 link passes distance support — OM4 10G-SR reaches 400m', () => {
    const findings = validateUplink(baseArgs)
    expect(findings.find((f) => f.id === 'distance-support').status).toBe('pass')
  })

  it('a patch panel with 0 free ports blocks the uplink even though distance passes', () => {
    const findings = validateUplink({ ...baseArgs, patchPanelFreePorts: 0 })
    expect(findings.find((f) => f.id === 'distance-support').status).toBe('pass')
    expect(findings.find((f) => f.id === 'patch-panel-capacity').status).toBe('fail')
    expect(hasBlockingFailure(findings)).toBe(true)
  })

  it('switching the blocked OM4 link to OS2 does NOT clear the patch-panel block — medium is unrelated to port capacity', () => {
    const om4 = validateUplink({ ...baseArgs, media: 'om4', sourceSfp: 'SFP-10G-SR', destSfp: 'SFP-10G-SR', patchPanelFreePorts: 0 })
    const os2 = validateUplink({ ...baseArgs, media: 'os2', sourceSfp: 'SFP-10G-LR', destSfp: 'SFP-10G-LR', patchPanelFreePorts: 0 })
    expect(hasBlockingFailure(om4)).toBe(true)
    expect(hasBlockingFailure(os2)).toBe(true) // still blocked — only freeing a port fixes this
  })

  it('freeing a port (not changing medium) is what actually clears the block', () => {
    const findings = validateUplink({ ...baseArgs, patchPanelFreePorts: 1 })
    expect(hasBlockingFailure(findings)).toBe(false)
  })

  it('flags a length that genuinely exceeds the media limit (e.g. 500m over Cat6A)', () => {
    const findings = validateUplink({ ...baseArgs, media: 'cat6a', sourceSfp: null, destSfp: null, estimatedLengthM: 500 })
    expect(findings.find((f) => f.id === 'distance-support').status).toBe('fail')
  })

  it('does not require an SFP for Cat6A — it is RJ45 copper, not a pluggable optic', () => {
    const findings = validateUplink({ ...baseArgs, media: 'cat6a', sourceSfp: null, destSfp: null, estimatedLengthM: 50 })
    expect(findings.find((f) => f.id === 'sfp-compatibility').status).toBe('pass')
    expect(hasBlockingFailure(findings)).toBe(false)
  })

  it('flags an SFP that does not match the selected medium/speed', () => {
    const findings = validateUplink({ ...baseArgs, sourceSfp: 'SFP-10G-LR' }) // OS2 optic on an OM4 link
    expect(findings.find((f) => f.id === 'sfp-compatibility').status).toBe('fail')
  })

  it('flags an occupied port', () => {
    const findings = validateUplink({ ...baseArgs, destPortFree: false })
    expect(findings.find((f) => f.id === 'port-availability').status).toBe('fail')
  })

  it('marks an unsurveyed pathway as info, not a failure', () => {
    const findings = validateUplink({ ...baseArgs, estimatedLengthM: null })
    expect(findings.find((f) => f.id === 'surveyed-pathway').status).toBe('info')
    expect(hasBlockingFailure(findings)).toBe(false)
  })
})
