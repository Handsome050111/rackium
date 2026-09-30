import { describe, it, expect } from 'vitest'
import { isWithinBoundary, findConflicts, isPlacementValid, computeFreeRU, occupiesFaces } from './rackValidation.js'

describe('isWithinBoundary (ru = lowest RU)', () => {
  it('rejects a 2U device at the top RU (would exceed the rack)', () => {
    expect(isWithinBoundary(42, 2, 42)).toBe(false)
  })

  it('accepts a 2U device at RU(top-1)', () => {
    expect(isWithinBoundary(41, 2, 42)).toBe(true)
  })

  it('rejects ru below 1', () => {
    expect(isWithinBoundary(0, 1, 42)).toBe(false)
  })

  it('accepts a 1U device exactly at the top RU', () => {
    expect(isWithinBoundary(42, 1, 42)).toBe(true)
  })
})

describe('findConflicts — RU overlap per face', () => {
  const rackHeightU = 42

  it('reports the boundary type and the conflicting placement id', () => {
    const overBoundary = findConflicts({ id: 'b', ru: 42, heightU: 2, face: 'front' }, [], rackHeightU)
    expect(overBoundary).toEqual([{ type: 'boundary', message: 'Outside rack boundary' }])

    const existing = [{ id: 'a', ru: 40, heightU: 1, face: 'front', label: 'Edge switch' }]
    const overlap = findConflicts({ id: 'b', ru: 40, heightU: 1, face: 'front' }, existing, rackHeightU)
    expect(overlap).toEqual([{ type: 'overlap', message: 'Conflicts with Edge switch', withId: 'a' }])
  })

  it('flags overlapping placements on the same face', () => {
    const existing = [{ id: 'a', ru: 40, heightU: 2, face: 'front', label: 'Edge switch' }]
    const candidate = { id: 'b', ru: 41, heightU: 1, face: 'front' }
    expect(isPlacementValid(candidate, existing, rackHeightU)).toBe(false)
  })

  it('does not flag the same RU range on the opposite face', () => {
    const existing = [{ id: 'a', ru: 40, heightU: 1, face: 'front', label: 'Front device' }]
    const candidate = { id: 'b', ru: 40, heightU: 1, face: 'rear' }
    expect(isPlacementValid(candidate, existing, rackHeightU)).toBe(true)
  })

  it('excludes a placement from conflicting with its own prior position when moving', () => {
    const existing = [{ id: 'a', ru: 40, heightU: 1, face: 'front', label: 'Device A' }]
    const candidate = { id: 'a', ru: 41, heightU: 1, face: 'front' }
    expect(isPlacementValid(candidate, existing, rackHeightU, 'a')).toBe(true)
  })

  it('ignores 0U items in overlap checks', () => {
    const existing = [{ id: 'pdu', ru: 0, heightU: 0, face: 'rear', label: 'PDU-A' }]
    const candidate = { id: 'b', ru: 1, heightU: 1, face: 'rear' }
    expect(isPlacementValid(candidate, existing, rackHeightU)).toBe(true)
  })
})

describe('full_depth and blocked occupy both faces', () => {
  const rackHeightU = 42

  it('occupiesFaces: blocked applies to both faces regardless of its own face field', () => {
    expect(occupiesFaces({ kind: 'blocked', face: 'front' })).toEqual(['front', 'rear'])
  })

  it('occupiesFaces: fullDepth applies to both faces', () => {
    expect(occupiesFaces({ fullDepth: true, face: 'front' })).toEqual(['front', 'rear'])
  })

  it('occupiesFaces: reserved applies only to its own face', () => {
    expect(occupiesFaces({ kind: 'reserved', face: 'front' })).toEqual(['front'])
  })

  it('a full-depth candidate conflicts with an existing rear-only device', () => {
    const existing = [{ id: 'a', ru: 40, heightU: 1, face: 'rear', label: 'Rear device' }]
    const candidate = { id: 'b', ru: 40, heightU: 1, face: 'front', fullDepth: true }
    expect(isPlacementValid(candidate, existing, rackHeightU)).toBe(false)
  })

  it('a blocked RU on one face blocks a placement attempted on the other face', () => {
    const existing = [{ id: 'blk', kind: 'blocked', ru: 40, heightU: 1, face: 'front', label: 'Blocked' }]
    const candidate = { id: 'b', ru: 40, heightU: 1, face: 'rear' }
    expect(isPlacementValid(candidate, existing, rackHeightU)).toBe(false)
  })
})

describe('computeFreeRU', () => {
  it('counts all RU free on an empty 23U rack', () => {
    expect(computeFreeRU([], 23, 'front')).toEqual({ availableRU: 23, contiguousFreeRU: 23 })
  })

  it('splits contiguous free RU around an occupied block', () => {
    const placements = [{ id: 'a', ru: 20, heightU: 1, face: 'front', label: 'Edge' }]
    const result = computeFreeRU(placements, 23, 'front')
    expect(result.availableRU).toBe(22)
    // free above (21-23 = 3) and below (1-19 = 19); longest run is 19
    expect(result.contiguousFreeRU).toBe(19)
  })

  it('a full-depth device reduces free RU on both faces', () => {
    const placements = [{ id: 'a', ru: 10, heightU: 1, face: 'front', fullDepth: true, label: 'Chassis' }]
    expect(computeFreeRU(placements, 42, 'front').availableRU).toBe(41)
    expect(computeFreeRU(placements, 42, 'rear').availableRU).toBe(41)
  })

  it('a reserved RU on the front face does not reduce the rear face free count', () => {
    const placements = [{ id: 'a', ru: 10, heightU: 1, face: 'front', kind: 'reserved', label: 'Reserved for FMO' }]
    expect(computeFreeRU(placements, 42, 'front').availableRU).toBe(41)
    expect(computeFreeRU(placements, 42, 'rear').availableRU).toBe(42)
  })
})
