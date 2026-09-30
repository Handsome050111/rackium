import { describe, it, expect } from 'vitest'
import { validateStructure } from './siteValidation.js'

const hasRoomMeta = (id) => id === 'room-1'

describe('validateStructure', () => {
  it('flags a room with no rack', () => {
    const findings = validateStructure({
      rooms: [{ id: 'room-1', code: 'TR-01' }],
      racks: [],
      connections: [],
      hasRoomMeta,
    })
    expect(findings.find((f) => f.type === 'room-without-rack')).toMatchObject({ objectId: 'room-1' })
  })

  it('does not flag a room that has a rack', () => {
    const findings = validateStructure({
      rooms: [{ id: 'room-1', code: 'TR-01' }],
      racks: [{ id: 'rack-1', code: 'R01', roomId: 'room-1' }],
      connections: [],
      hasRoomMeta,
    })
    expect(findings.find((f) => f.type === 'room-without-rack')).toBeUndefined()
  })

  it('flags a rack whose room has no survey details captured', () => {
    const findings = validateStructure({
      rooms: [{ id: 'room-2', code: 'TR-02' }],
      racks: [{ id: 'rack-2', code: 'R01', roomId: 'room-2' }],
      connections: [],
      hasRoomMeta, // room-2 has no meta
    })
    expect(findings.find((f) => f.type === 'rack-without-room-details')).toMatchObject({ objectId: 'rack-2' })
  })

  it('flags a connection with no distance recorded', () => {
    const findings = validateStructure({
      rooms: [],
      racks: [],
      connections: [{ id: 'conn-1', fromRoomCode: 'TR-01', toRoomCode: 'TR-02', distanceM: null }],
      hasRoomMeta,
    })
    expect(findings.find((f) => f.type === 'connection-without-distance')).toMatchObject({ objectId: 'conn-1' })
  })

  it('does not flag a connection that has a distance', () => {
    const findings = validateStructure({
      rooms: [],
      racks: [],
      connections: [{ id: 'conn-1', fromRoomCode: 'TR-01', toRoomCode: 'TR-02', distanceM: 40 }],
      hasRoomMeta,
    })
    expect(findings.find((f) => f.type === 'connection-without-distance')).toBeUndefined()
  })

  it('flags duplicate room IDs (codes)', () => {
    const findings = validateStructure({
      rooms: [
        { id: 'room-1', code: 'TR-01' },
        { id: 'room-2', code: 'TR-01' },
      ],
      racks: [],
      connections: [],
      hasRoomMeta,
    })
    const finding = findings.find((f) => f.type === 'duplicate-room-id')
    expect(finding.message).toContain('TR-01')
  })
})
