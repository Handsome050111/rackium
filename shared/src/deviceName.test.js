import { describe, it, expect } from 'vitest'
import { deviceDisplayName, cleanExistingLabel, EXISTING_LABEL_MAX } from './deviceName.js'

describe('deviceDisplayName (fix/cmo-naming-gaps)', () => {
  it("a surveyed item shows its recorded existing label instead of the library name", () => {
    expect(deviceDisplayName({ origin: 'existing', label: '24-port patch panel', existingLabel: 'VT-A-01' })).toBe('VT-A-01')
    expect(deviceDisplayName({ origin: 'existing', label: '24-port patch panel', existingLabel: '   ' })).toBe('24-port patch panel')
  })

  it('the existing label wins over a CMO hostname; without one the hostname, then what was placed, then the model', () => {
    expect(deviceDisplayName({ hostname: 'SW-OLD-01', label: '48-port switch', existingLabel: 'Switch A (old)' })).toBe('Switch A (old)')
    expect(deviceDisplayName({ hostname: 'SW-OLD-01', label: '48-port switch' })).toBe('SW-OLD-01')
    expect(deviceDisplayName({ model: 'C9300-48UX' })).toBe('C9300-48UX')
    expect(deviceDisplayName(null, 'the panel')).toBe('the panel')
  })

  it('takes any free text — no naming pattern — trimmed and at most 120 characters', () => {
    expect(cleanExistingLabel('  Schrank 3 / Feld A ')).toBe('Schrank 3 / Feld A')
    expect(cleanExistingLabel('x'.repeat(200))).toHaveLength(EXISTING_LABEL_MAX)
    expect(cleanExistingLabel('')).toBeNull()
    expect(cleanExistingLabel(null)).toBeNull()
  })
})
