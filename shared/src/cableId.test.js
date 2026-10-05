import { describe, it, expect } from 'vitest'
import { suggestNextCableId, isCableIdUnique, isCableIdValid } from './cableId.js'

describe('suggestNextCableId', () => {
  it('returns the start value when nothing is taken', () => {
    expect(suggestNextCableId([], 100)).toBe('100')
  })

  it('skips ids already in use', () => {
    expect(suggestNextCableId(['100', '101'], 100)).toBe('102')
  })

  it('ignores unrelated non-numeric existing ids', () => {
    expect(suggestNextCableId(['D6'], 100)).toBe('100')
  })
})

describe('isCableIdUnique', () => {
  it('rejects a duplicate regardless of case', () => {
    expect(isCableIdUnique('abc123', ['ABC123'])).toBe(false)
  })

  it('allows a value that only conflicts with itself when excluded', () => {
    expect(isCableIdUnique('ABC123', ['ABC123'], 'ABC123')).toBe(true)
  })

  it('accepts a value not present in the list', () => {
    expect(isCableIdUnique('NEW1', ['ABC123'])).toBe(true)
  })
})

describe('isCableIdValid', () => {
  it('rejects empty input', () => {
    expect(isCableIdValid('   ')).toBe(false)
  })

  it('rejects input over 32 characters', () => {
    expect(isCableIdValid('a'.repeat(33))).toBe(false)
  })

  it('accepts normal input', () => {
    expect(isCableIdValid('26184735')).toBe(true)
  })
})

describe('HLD connections that have no Cable ID yet', () => {
  it('suggest and uniqueness checks ignore null entries instead of throwing', () => {
    expect(suggestNextCableId([null, '100', undefined], 100)).toBe('101')
    expect(isCableIdUnique('100', [null, '100'])).toBe(false)
    expect(isCableIdUnique('200', [null, '100'])).toBe(true)
  })
})
