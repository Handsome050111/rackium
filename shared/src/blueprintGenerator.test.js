import { describe, it, expect } from 'vitest'
import { generateBlueprintSuggestions } from './blueprintGenerator.js'

describe('generateBlueprintSuggestions', () => {
  it('suggests Fusion and Border in the main room when neither exists', () => {
    const result = generateBlueprintSuggestions({ roomContexts: [], hasFusion: false, hasBorder: false, mainRoomId: 'room-main' })
    expect(result.devices).toEqual([
      { role: 'fusion', roomId: 'room-main' },
      { role: 'border', roomId: 'room-main' },
    ])
  })

  it('suggests nothing for a building that already has everything (idempotent)', () => {
    const roomContexts = [{ roomId: 'room-a', hasRack: true, hasEdge: true, hasAp: true, floorToken: 'EG' }]
    const result = generateBlueprintSuggestions({ roomContexts, hasFusion: true, hasBorder: true, mainRoomId: 'room-main' })
    expect(result.devices).toHaveLength(0)
    expect(result.uplinks).toHaveLength(0)
  })

  it('suggests Edge + AP + a Border uplink for a room with a rack but no Edge yet', () => {
    const roomContexts = [{ roomId: 'room-b', hasRack: true, hasEdge: false, hasAp: false, floorToken: '1.OG' }]
    const result = generateBlueprintSuggestions({ roomContexts, hasFusion: true, hasBorder: true, mainRoomId: 'room-main' })
    expect(result.devices).toContainEqual({ role: 'edge', roomId: 'room-b', floorToken: '1.OG' })
    expect(result.devices).toContainEqual({ role: 'ap', roomId: 'room-b', floorToken: '1.OG' })
    expect(result.uplinks).toContainEqual({ toRoomId: 'room-b' })
  })

  it('skips a room with no rack yet — nothing to connect', () => {
    const roomContexts = [{ roomId: 'room-c', hasRack: false, hasEdge: false, hasAp: false, floorToken: 'EG' }]
    const result = generateBlueprintSuggestions({ roomContexts, hasFusion: true, hasBorder: true, mainRoomId: 'room-main' })
    expect(result.devices).toHaveLength(0)
  })

  it('skips the main room itself when scanning for edge rooms', () => {
    const roomContexts = [{ roomId: 'room-main', hasRack: true, hasEdge: false, hasAp: false, floorToken: 'FU1' }]
    const result = generateBlueprintSuggestions({ roomContexts, hasFusion: true, hasBorder: true, mainRoomId: 'room-main' })
    expect(result.devices).toHaveLength(0)
    expect(result.uplinks).toHaveLength(0)
  })
})
