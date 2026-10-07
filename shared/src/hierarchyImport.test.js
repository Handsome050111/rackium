import { describe, it, expect } from 'vitest'
import { validateHierarchyRow, buildHierarchyImportPlan, floorHostnameToken } from './hierarchyImport.js'

const row = (over = {}) => ({
  countryCode: 'DE',
  countryName: 'Germany',
  salCode: 'ERL',
  campusCode: 'C01',
  buildingCode: 'B001',
  buildingName: 'Building B001',
  ...over,
})

describe('validateHierarchyRow', () => {
  it('accepts a complete row', () => {
    expect(validateHierarchyRow(row())).toEqual({ ok: true, errors: [], row: row() })
  })

  it('reports every missing required field', () => {
    const result = validateHierarchyRow({})
    expect(result.ok).toBe(false)
    expect(result.errors.map((e) => e.field).sort()).toEqual(['buildingCode', 'buildingName', 'campusCode', 'countryCode', 'countryName', 'salCode'])
  })

  it('refuses a code with spaces or punctuation, since it goes into a hostname', () => {
    expect(validateHierarchyRow(row({ buildingCode: 'B 001' })).ok).toBe(false)
    expect(validateHierarchyRow(row({ campusCode: 'C-01' })).ok).toBe(false)
  })

  it('wing code and wing name must be given together', () => {
    expect(validateHierarchyRow(row({ wingCode: 'W1' })).ok).toBe(false)
    expect(validateHierarchyRow(row({ wingName: 'West wing' })).ok).toBe(false)
    expect(validateHierarchyRow(row({ wingCode: 'W1', wingName: 'West wing' })).ok).toBe(true)
  })

  it('trims whitespace before validating', () => {
    expect(validateHierarchyRow(row({ buildingCode: '  B001  ' })).row.buildingCode).toBe('B001')
  })
})

describe('buildHierarchyImportPlan', () => {
  it('groups several rows into deduplicated entities in parent order', () => {
    const plan = buildHierarchyImportPlan([row(), row({ buildingCode: 'B002', buildingName: 'Building B002' }), row({ campusCode: 'C02', buildingCode: 'B003', buildingName: 'Building B003' })])
    expect(plan.ok).toBe(true)
    expect(plan.countries).toEqual([{ code: 'DE', name: 'Germany' }])
    expect(plan.sals).toEqual([{ countryCode: 'DE', code: 'ERL' }])
    expect(plan.campuses.map((c) => c.code).sort()).toEqual(['C01', 'C02'])
    expect(plan.buildings.map((b) => b.code).sort()).toEqual(['B001', 'B002', 'B003'])
  })

  it('includes a wing only when a row names one', () => {
    const plan = buildHierarchyImportPlan([row({ wingCode: 'W1', wingName: 'West wing' })])
    expect(plan.wings).toEqual([{ countryCode: 'DE', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B001', code: 'W1', name: 'West wing' }])
  })

  it('rejects the whole import when any row is invalid, naming its index', () => {
    const plan = buildHierarchyImportPlan([row(), row({ buildingCode: '' })])
    expect(plan.ok).toBe(false)
    expect(plan.rowErrors).toEqual([{ index: 1, errors: [{ field: 'buildingCode', message: 'buildingCode is required' }] }])
  })

  it('flags the same code given two different names across rows', () => {
    const plan = buildHierarchyImportPlan([row(), row({ buildingCode: 'B001', buildingName: 'A different name' })])
    expect(plan.ok).toBe(false)
  })
})

describe('floorHostnameToken', () => {
  it('removes dots and spaces, leaving the rest untouched', () => {
    expect(floorHostnameToken('1.OG')).toBe('1OG')
    expect(floorHostnameToken('Ground Floor')).toBe('GroundFloor')
    expect(floorHostnameToken('EG')).toBe('EG')
  })
})
