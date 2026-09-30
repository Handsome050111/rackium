import { describe, it, expect } from 'vitest'
import { buildHostname, floorToken } from './naming.js'

describe('floorToken', () => {
  it('strips dots and spaces from floor tokens', () => {
    expect(floorToken('1.OG')).toBe('1OG')
    expect(floorToken('EG')).toBe('EG')
    expect(floorToken('FU 1')).toBe('FU1')
  })
})

describe('buildHostname', () => {
  it('builds the standard pattern with zero-padded sequence', () => {
    const hostname = buildHostname({
      role: 'F',
      country: 'DE',
      sal: 'ERL',
      campus: 'C01',
      building: 'B001',
      floor: 'FU1',
      seq: 1,
    })
    expect(hostname).toBe('F-DE-ERL-C01-B001-FU1-001')
  })

  it('removes dots from the floor token in the hostname', () => {
    const hostname = buildHostname({
      role: 'E',
      country: 'DE',
      sal: 'ERL',
      campus: 'C01',
      building: 'B001',
      floor: '1.OG',
      seq: 2,
    })
    expect(hostname).toBe('E-DE-ERL-C01-B001-1OG-002')
  })
})
