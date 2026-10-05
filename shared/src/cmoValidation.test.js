import { describe, it, expect } from 'vitest'
import { matchSerial } from './cmoValidation.js'

const roomCmo = [{ serial: 'FCW1234ABCD' }, { serial: 'FCW5678EFGH' }]
const allProjectSerials = [
  { deviceId: 'dev-1', serial: 'FCW1234ABCD' },
  { deviceId: 'dev-2', serial: 'FCW5678EFGH' },
]

describe('matchSerial', () => {
  it('returns validated when the serial is in the room CMO list', () => {
    expect(matchSerial('FCW1234ABCD', roomCmo, allProjectSerials, 'dev-1')).toBe('validated')
  })

  it('is case-insensitive for validated matches', () => {
    expect(matchSerial('fcw1234abcd', roomCmo, allProjectSerials, 'dev-1')).toBe('validated')
  })

  it('returns not-in-cmo for a serial absent from the room CMO list', () => {
    expect(matchSerial('NEWDEVICE999', roomCmo, [], null)).toBe('not-in-cmo')
  })

  it('returns duplicate when the serial is already used by another device in the project', () => {
    expect(matchSerial('FCW5678EFGH', roomCmo, allProjectSerials, 'dev-1')).toBe('duplicate')
  })

  it('does not flag a device as duplicate of itself', () => {
    expect(matchSerial('FCW1234ABCD', roomCmo, allProjectSerials, 'dev-1')).not.toBe('duplicate')
  })

  it('returns null for empty input', () => {
    expect(matchSerial('   ', roomCmo, allProjectSerials)).toBeNull()
  })
})
