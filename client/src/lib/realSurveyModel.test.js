import { describe, it, expect } from 'vitest'
import { pickedFromCmo, toPlacementBody } from './realSurveyModel.js'

// fix/cmo-naming-gaps: what the Rack Survey sends when an item is picked from
// the building's CMO, and the existing label it records.
const placed = { id: 'new1', deviceId: 'new1', kind: 'device', ru: 10, heightU: 1, face: 'front', fullDepth: false, mounting: 'rack', category: 'Patch panels', label: '48-port patch panel', sublabel: '1U' }
const cmo = { deviceId: 'cmo1', serial: null, mac: null, expectedHostname: 'VT-A-01', vendor: 'Panduit', model: 'Patch panel 48' }

describe('pickedFromCmo', () => {
  it('keeps what was placed as the label — the kind and port count (regression: the CMO hostname replaced it, so a 48-port panel counted 24)', () => {
    const p = pickedFromCmo(placed, cmo)
    expect(p).toMatchObject({ id: 'cmo1', deviceId: 'cmo1', fromCmo: true, label: '48-port patch panel', sublabel: 'Patch panel 48', serial: null, identityEdited: false })
    expect(toPlacementBody([p])[0].label).toBe('48-port patch panel')
  })

  it('pre-fills the existing label from the CMO hostname, unless the surveyor typed one', () => {
    expect(pickedFromCmo(placed, cmo).existingLabel).toBe('VT-A-01')
    expect(pickedFromCmo({ ...placed, existingLabel: 'Feld A' }, cmo).existingLabel).toBe('Feld A')
    expect(pickedFromCmo({ ...placed, existingLabel: '  ' }, cmo).existingLabel).toBe('VT-A-01')
    expect(pickedFromCmo(placed, { ...cmo, expectedHostname: null }).existingLabel).toBeNull()
  })
})

describe('toPlacementBody: existing label', () => {
  it('sends the trimmed existing label, or null to clear it; never pattern-checked', () => {
    const [a, b] = toPlacementBody([
      { ...placed, existingLabel: '  Schrank 3 / Feld A ' },
      { ...placed, id: 'new2', deviceId: 'new2', existingLabel: '' },
    ])
    expect(a.existingLabel).toBe('Schrank 3 / Feld A')
    expect(b.existingLabel).toBeNull()
  })
})
