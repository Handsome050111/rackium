import { describe, it, expect } from 'vitest'
import { computeSuggestedLength, determineSituation } from './cableLength.js'

describe('determineSituation', () => {
  it('is same-rack when both ends share a rack', () => {
    expect(determineSituation({ sourceRackId: 'r1', destRackId: 'r1' })).toBe('same-rack')
  })

  it('is same-room when racks differ but the room matches', () => {
    expect(
      determineSituation({ sourceRackId: 'r1', destRackId: 'r2', sourceRoomId: 'room1', destRoomId: 'room1' })
    ).toBe('same-room')
  })

  it('is cross-room otherwise', () => {
    expect(
      determineSituation({ sourceRackId: 'r1', destRackId: 'r2', sourceRoomId: 'room1', destRoomId: 'room2' })
    ).toBe('cross-room')
  })
})

describe('computeSuggestedLength', () => {
  it('matches the §6.3 worked example: RU40 to RU42 same rack -> 1m', () => {
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', ru: 40 },
      dest: { rackId: 'rack-1', ru: 42 },
      media: 'cat6a',
    })
    expect(result.situation).toBe('same-rack')
    expect(result.rawMeters).toBeCloseTo(0.59)
    expect(result.suggested).toBe(1)
  })

  it('matches the §6.3 worked example: neighbouring racks in one room -> 5m', () => {
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-1', rackPosition: 1 },
      dest: { rackId: 'rack-2', roomId: 'room-1', rackPosition: 2 },
      media: 'cat6a',
    })
    expect(result.situation).toBe('same-room')
    expect(result.rawMeters).toBeCloseTo(3.3)
    expect(result.suggested).toBe(5)
  })

  it('flags cross-room with no surveyed pathway as estimated, no suggestion', () => {
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-1' },
      dest: { rackId: 'rack-2', roomId: 'room-2' },
      media: 'os2',
    })
    expect(result.situation).toBe('cross-room')
    expect(result.estimated).toBe(true)
    expect(result.suggested).toBeNull()
  })

  it('adds the 2m slack to a surveyed cross-room pathway', () => {
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-1' },
      dest: { rackId: 'rack-2', roomId: 'room-2', surveyedPathwayLength: 40 },
      media: 'os2',
    })
    expect(result.rawMeters).toBe(42)
    expect(result.suggested).toBe(50)
  })

  it('flags custom length required when nothing in stock is long enough', () => {
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-1' },
      dest: { rackId: 'rack-2', roomId: 'room-2', surveyedPathwayLength: 600 },
      media: 'om4',
    })
    expect(result.customLengthRequired).toBe(true)
    expect(result.suggested).toBeNull()
  })
})
