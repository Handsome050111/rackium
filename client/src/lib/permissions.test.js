import { describe, it, expect } from 'vitest'
import { canMoveDevices, canReserve, canBlock, getRackPermissions, canEditSiteStructure, getSiteStructurePermissions } from './permissions.js'

describe('rack permissions', () => {
  it('only Field Engineer moves devices', () => {
    expect(canMoveDevices('field_engineer')).toBe(true)
    expect(canMoveDevices('architect')).toBe(false)
    expect(canMoveDevices('org_admin')).toBe(false)
  })

  it('only Architect reserves/releases RU', () => {
    expect(canReserve('architect')).toBe(true)
    expect(canReserve('pm')).toBe(false)
    expect(canReserve('field_engineer')).toBe(false)
  })

  it('only PM or Org Admin block/unblock RU', () => {
    expect(canBlock('pm')).toBe(true)
    expect(canBlock('org_admin')).toBe(true)
    expect(canBlock('architect')).toBe(false)
  })

  it('Viewer and Reviewer are fully read-only', () => {
    expect(getRackPermissions('viewer').readOnly).toBe(true)
    expect(getRackPermissions('reviewer').readOnly).toBe(true)
  })

  it('Field Engineer is not read-only', () => {
    expect(getRackPermissions('field_engineer').readOnly).toBe(false)
  })
})

describe('site structure permissions', () => {
  it('Field Engineer, PM and Architect can edit; Org Admin cannot', () => {
    expect(canEditSiteStructure('field_engineer')).toBe(true)
    expect(canEditSiteStructure('pm')).toBe(true)
    expect(canEditSiteStructure('architect')).toBe(true)
    expect(canEditSiteStructure('org_admin')).toBe(false)
  })

  it('Viewer and Reviewer are read-only', () => {
    expect(getSiteStructurePermissions('viewer').readOnly).toBe(true)
    expect(getSiteStructurePermissions('reviewer').readOnly).toBe(true)
  })
})
