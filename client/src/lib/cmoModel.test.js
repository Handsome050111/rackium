import { describe, it, expect } from 'vitest'
import { isValidMac, applyColumnMapping, validateCmoRows, computeCmoKpis, computeBuildingCmoStatus, guessColumnMapping } from './cmoModel.js'

describe('isValidMac', () => {
  it('accepts colon and hyphen separated hex pairs', () => {
    expect(isValidMac('00:1A:2B:3C:4D:5E')).toBe(true)
    expect(isValidMac('00-1a-2b-3c-4d-5e')).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(isValidMac('not-a-mac')).toBe(false)
    expect(isValidMac('00:1A:2B:3C:4D')).toBe(false)
  })

  it('treats empty/missing MAC as not a format error (optional field)', () => {
    expect(isValidMac('')).toBe(true)
    expect(isValidMac(null)).toBe(true)
  })
})

describe('applyColumnMapping', () => {
  it('maps raw grid rows onto CMO fields by column index, trimming and nulling blanks', () => {
    const rows = [['  SW-01  ', 'C9300', 'SER001', '', 'B001']]
    const mapping = { hostname: 0, model: 1, serial: 2, mac: 3, building: 4 }
    const result = applyColumnMapping(rows, mapping)
    expect(result).toEqual([{ rowIndex: 0, hostname: 'SW-01', model: 'C9300', serial: 'SER001', mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }])
  })

  it('leaves unmapped fields null', () => {
    const result = applyColumnMapping([['SER001']], { serial: 0 })
    expect(result[0].hostname).toBeNull()
  })
})

describe('validateCmoRows', () => {
  const resolveBuilding = (code) => (code === 'B001' ? 'b001' : null)

  it('flags a missing serial', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: null, building: 'B001' }], { projectSerials: new Set(), resolveBuilding })
    expect(row.errors).toContain('missing_serial')
    expect(row.valid).toBe(false)
  })

  it('flags duplicate serials within the same file (both occurrences)', () => {
    const rows = validateCmoRows(
      [
        { rowIndex: 0, serial: 'ABC123', building: 'B001' },
        { rowIndex: 1, serial: 'abc123', building: 'B001' },
      ],
      { projectSerials: new Set(), resolveBuilding }
    )
    expect(rows[0].errors).toContain('duplicate_in_file')
    expect(rows[1].errors).toContain('duplicate_in_file')
  })

  it('flags a serial already recorded against the project', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: 'EXISTING1', building: 'B001' }], {
      projectSerials: new Set(['existing1']),
      resolveBuilding,
    })
    expect(row.errors).toContain('duplicate_in_project')
  })

  it('flags an invalid MAC format', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: 'S1', mac: 'garbage', building: 'B001' }], {
      projectSerials: new Set(),
      resolveBuilding,
    })
    expect(row.errors).toContain('invalid_mac')
  })

  it('an unresolvable building is flagged but the row still counts valid (routes to Unassigned, not blocked)', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: 'S1', building: 'Nowhere' }], { projectSerials: new Set(), resolveBuilding })
    expect(row.errors).toEqual(['unknown_building'])
    expect(row.buildingId).toBeNull()
    expect(row.valid).toBe(true)
  })

  it('a row with no building at all resolves to null buildingId without an error (goes straight to Unassigned)', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: 'S1', building: null }], { projectSerials: new Set(), resolveBuilding })
    expect(row.errors).toEqual([])
    expect(row.buildingId).toBeNull()
    expect(row.valid).toBe(true)
  })

  it('a row with both a blocking error and unknown_building is invalid', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, serial: null, building: 'Nowhere' }], { projectSerials: new Set(), resolveBuilding })
    expect(row.valid).toBe(false)
  })
})

describe('guessColumnMapping', () => {
  it('matches common header spellings case-insensitively', () => {
    const headers = ['Hostname', 'Model', 'Serial Number', 'MAC Address', 'Building', 'Floor', 'Room', 'Rack', 'RU']
    expect(guessColumnMapping(headers)).toEqual({ hostname: 0, model: 1, serial: 2, mac: 3, building: 4, floor: 5, room: 6, rack: 7, ru: 8 })
  })

  it('returns -1 for fields with no matching header', () => {
    const mapping = guessColumnMapping(['Serial'])
    expect(mapping.serial).toBe(0)
    expect(mapping.hostname).toBe(-1)
  })
})

describe('computeCmoKpis', () => {
  it('splits assigned vs unassigned by buildingId presence', () => {
    const kpis = computeCmoKpis([{ buildingId: 'b001' }, { buildingId: null }, { buildingId: null }])
    expect(kpis).toEqual({ total: 3, assigned: 1, unassigned: 2 })
  })
})

describe('computeBuildingCmoStatus', () => {
  it('is not_started with no devices imported for this building', () => {
    expect(computeBuildingCmoStatus([])).toBe('not_started')
  })

  it('is completed once at least one device is imported for this building, independent of other buildings', () => {
    expect(computeBuildingCmoStatus([{ id: 'd1' }])).toBe('completed')
  })
})
