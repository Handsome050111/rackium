import { describe, it, expect } from 'vitest'
import { isValidCidr, isValidVlanId, validateAddressingEntries } from './networkAddressingValidation.js'

describe('isValidCidr', () => {
  it('accepts a well-formed CIDR', () => {
    expect(isValidCidr('10.10.20.0/23')).toBe(true)
  })
  it('rejects malformed input', () => {
    expect(isValidCidr('not-a-cidr')).toBe(false)
    expect(isValidCidr('10.10.20.0')).toBe(false)
    expect(isValidCidr('10.10.20.0/33')).toBe(false)
    expect(isValidCidr('999.1.1.0/24')).toBe(false)
  })
})

describe('isValidVlanId', () => {
  it('accepts the full 1-4094 range', () => {
    expect(isValidVlanId(1)).toBe(true)
    expect(isValidVlanId(4094)).toBe(true)
  })
  it('rejects out-of-range or non-integer values', () => {
    expect(isValidVlanId(0)).toBe(false)
    expect(isValidVlanId(4095)).toBe(false)
    expect(isValidVlanId('abc')).toBe(false)
    expect(isValidVlanId(10.5)).toBe(false)
  })
})

describe('validateAddressingEntries', () => {
  it('passes a clean set of non-overlapping subnets with unique VLANs', () => {
    const entries = [
      { id: 'e1', vlanId: 10, cidr: '10.10.10.0/24' },
      { id: 'e2', vlanId: 20, cidr: '10.10.20.0/23' },
    ]
    expect(validateAddressingEntries(entries).ok).toBe(true)
  })

  it('flags a duplicate VLAN ID', () => {
    const entries = [
      { id: 'e1', vlanId: 10, cidr: '10.10.10.0/24' },
      { id: 'e2', vlanId: 10, cidr: '10.10.20.0/24' },
    ]
    const { findings } = validateAddressingEntries(entries)
    expect(findings.some((f) => f.message.includes('already used'))).toBe(true)
  })

  it('flags an overlapping subnet', () => {
    const entries = [
      { id: 'e1', vlanId: 10, cidr: '10.10.0.0/16' },
      { id: 'e2', vlanId: 20, cidr: '10.10.20.0/24' }, // inside the /16 above
    ]
    const { findings } = validateAddressingEntries(entries)
    expect(findings.some((f) => f.message.includes('overlaps'))).toBe(true)
  })

  it('does not flag two genuinely disjoint subnets', () => {
    const entries = [
      { id: 'e1', vlanId: 10, cidr: '10.10.10.0/24' },
      { id: 'e2', vlanId: 20, cidr: '10.10.11.0/24' },
    ]
    expect(validateAddressingEntries(entries).ok).toBe(true)
  })

  it('flags a VLAN ID out of range', () => {
    const entries = [{ id: 'e1', vlanId: 9999, cidr: '10.10.10.0/24' }]
    const { findings } = validateAddressingEntries(entries)
    expect(findings.some((f) => f.field === 'vlanId')).toBe(true)
  })

  it('flags an invalid CIDR', () => {
    const entries = [{ id: 'e1', vlanId: 10, cidr: 'garbage' }]
    const { findings } = validateAddressingEntries(entries)
    expect(findings.some((f) => f.field === 'cidr')).toBe(true)
  })
})
