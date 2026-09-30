import { describe, it, expect } from 'vitest'
import { findSurveyedDistance } from './pathway.js'
import { computeSuggestedLength } from './cableLength.js'

const connections = [
  { id: 'c1', fromRoomId: 'room-a', toRoomId: 'room-b', routeStatus: 'surveyed', distanceM: 40 },
  { id: 'c2', fromRoomId: 'room-c', toRoomId: 'room-d', routeStatus: 'estimated', distanceM: 25 },
]

describe('findSurveyedDistance', () => {
  it('finds a surveyed connection regardless of direction', () => {
    expect(findSurveyedDistance('room-a', 'room-b', connections)).toBe(40)
    expect(findSurveyedDistance('room-b', 'room-a', connections)).toBe(40)
  })

  it('ignores a connection that is only estimated, not surveyed', () => {
    expect(findSurveyedDistance('room-c', 'room-d', connections)).toBeNull()
  })

  it('returns null when no connection exists between the two rooms', () => {
    expect(findSurveyedDistance('room-x', 'room-y', connections)).toBeNull()
  })

  it('feeds cableLength.js\'s cross-room formula directly: surveyed distance + 2m slack, rounded to stock', () => {
    const distance = findSurveyedDistance('room-a', 'room-b', connections)
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-a' },
      dest: { rackId: 'rack-2', roomId: 'room-b', surveyedPathwayLength: distance },
      media: 'os2',
    })
    expect(result.estimated).toBe(false)
    expect(result.rawMeters).toBe(42) // 40m surveyed + 2m slack
    expect(result.suggested).toBe(50) // next OS2 stock length
  })

  it('without a surveyed connection, cableLength.js correctly falls back to Estimated', () => {
    const distance = findSurveyedDistance('room-x', 'room-y', connections)
    const result = computeSuggestedLength({
      source: { rackId: 'rack-1', roomId: 'room-x' },
      dest: { rackId: 'rack-2', roomId: 'room-y', surveyedPathwayLength: distance },
      media: 'os2',
    })
    expect(result.estimated).toBe(true)
    expect(result.suggested).toBeNull()
  })
})
