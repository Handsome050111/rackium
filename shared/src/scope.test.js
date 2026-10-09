import { describe, it, expect } from 'vitest'
import { scopeCoversBuilding, scopeCoversSal } from './scope.js'

const b001 = { id: 'b1', salId: 's1', countryId: 'c1' }
const b101 = { id: 'b2', salId: 's2', countryId: 'c1' }
const sal1 = { id: 's1', countryId: 'c1' }
const sal3 = { id: 's3', countryId: 'c2' }

describe('membership scope', () => {
  it('an empty scope is the whole project', () => {
    expect(scopeCoversBuilding([], b001)).toBe(true)
    expect(scopeCoversBuilding(undefined, b001)).toBe(true)
    expect(scopeCoversSal([], sal3)).toBe(true)
  })

  it('building, SAL and country scopes cover their buildings', () => {
    expect(scopeCoversBuilding([{ type: 'building', refId: 'b1' }], b001)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'building', refId: 'b1' }], b101)).toBe(false)
    expect(scopeCoversBuilding([{ type: 'sal', refId: 's2' }], b101)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'sal', refId: 's2' }], b001)).toBe(false)
    expect(scopeCoversBuilding([{ type: 'country', refId: 'c1' }], b101)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'building', refId: 'b1' }], null)).toBe(false)
  })

  it('SAL-level items: SAL and country scopes reach them, a building scope does not', () => {
    expect(scopeCoversSal([{ type: 'sal', refId: 's1' }], sal1)).toBe(true)
    expect(scopeCoversSal([{ type: 'country', refId: 'c1' }], sal1)).toBe(true)
    expect(scopeCoversSal([{ type: 'country', refId: 'c1' }], sal3)).toBe(false)
    expect(scopeCoversSal([{ type: 'building', refId: 'b1' }], sal1)).toBe(false)
    expect(scopeCoversSal([{ type: 'sal', refId: 's1' }], null)).toBe(false)
  })
})
