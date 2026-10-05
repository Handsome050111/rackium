import { describe, it, expect } from 'vitest'
import { validateMapping, mediaCompatible, hasBlockingFailure } from './validation.js'

const basePorts = { sourcePortFree: true, destPortFree: true, sourceKind: 'copper', destKind: 'copper' }
const baseLength = { situation: 'same-rack', rawMeters: 0.59, suggested: 1, estimated: false, customLengthRequired: false }

describe('mediaCompatible', () => {
  it('accepts cat6a only when both ends are copper', () => {
    expect(mediaCompatible('cat6a', 'copper', 'copper')).toBe(true)
    expect(mediaCompatible('cat6a', 'copper', 'sfp')).toBe(false)
  })

  it('accepts fibre media only when neither end is copper', () => {
    expect(mediaCompatible('os2', 'sfp', 'sfp')).toBe(true)
    expect(mediaCompatible('os2', 'copper', 'sfp')).toBe(false)
  })
})

describe('validateMapping', () => {
  it('passes everything for a clean, unique mapping', () => {
    const findings = validateMapping({
      ...basePorts,
      media: 'cat6a',
      cableId: '26184740',
      existingCableIds: ['26184735'],
      excludeCableId: null,
      lengthResult: baseLength,
    })
    expect(hasBlockingFailure(findings)).toBe(false)
    expect(findings.find((f) => f.id === 'cable-length').message).toBe('1 m stock length')
  })

  it('fails when the destination port is already used', () => {
    const findings = validateMapping({
      ...basePorts,
      destPortFree: false,
      media: 'cat6a',
      cableId: '26184740',
      existingCableIds: [],
      excludeCableId: null,
      lengthResult: baseLength,
    })
    expect(findings.find((f) => f.id === 'dest-port-available').status).toBe('fail')
    expect(hasBlockingFailure(findings)).toBe(true)
  })

  it('rejects a duplicate cable id case-insensitively (VAL-013)', () => {
    const findings = validateMapping({
      ...basePorts,
      media: 'cat6a',
      cableId: 'abc123',
      existingCableIds: ['ABC123'],
      excludeCableId: null,
      lengthResult: baseLength,
    })
    expect(findings.find((f) => f.id === 'cable-id-unique').status).toBe('fail')
  })

  it('flags a media/port mismatch', () => {
    const findings = validateMapping({
      sourcePortFree: true,
      destPortFree: true,
      sourceKind: 'copper',
      destKind: 'sfp',
      media: 'cat6a',
      cableId: '1',
      existingCableIds: [],
      excludeCableId: null,
      lengthResult: baseLength,
    })
    expect(findings.find((f) => f.id === 'media-compatible').status).toBe('fail')
  })

  it('flags a length beyond the media limit (VAL-011)', () => {
    const findings = validateMapping({
      ...basePorts,
      media: 'cat6a',
      cableId: '1',
      existingCableIds: [],
      excludeCableId: null,
      lengthResult: { situation: 'cross-room', rawMeters: 150, suggested: null, estimated: false, customLengthRequired: false },
    })
    expect(findings.find((f) => f.id === 'cable-length').status).toBe('fail')
  })
})
