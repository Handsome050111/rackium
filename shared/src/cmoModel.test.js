import { describe, it, expect } from 'vitest'
import { isValidMac, applyColumnMapping, validateCmoRows, computeCmoKpis, computeBuildingCmoStatus, guessColumnMapping, normaliseMac, computeCmoPhaseStatus } from './cmoModel.js'

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

describe('normaliseMac', () => {
  it('stores MACs lower case and colon-separated', () => {
    expect(normaliseMac('00-1A-2B-3C-4D-5E')).toBe('00:1a:2b:3c:4d:5e')
    expect(normaliseMac(' 00:1a:2b:3c:4d:5e ')).toBe('00:1a:2b:3c:4d:5e')
  })
  it('returns null for an empty or malformed MAC', () => {
    expect(normaliseMac(null)).toBeNull()
    expect(normaliseMac('nope')).toBeNull()
  })
})

describe('validateCmoRows — real-backend checks (opt-in)', () => {
  const row = (fields) => ({ rowIndex: 0, hostname: null, model: null, serial: 'S1', mac: null, building: null, floor: null, room: null, rack: null, ru: null, ...fields })
  const base = { projectSerials: new Set(), resolveBuilding: (t) => (t === 'B001' ? 'b1' : null) }

  it('without the new options, the result for each row is unchanged (mock mode)', () => {
    const [r] = validateCmoRows([row({ mac: '00:1a:2b:3c:4d:5e', hostname: 'SW-1', building: 'B001', room: 'TR-1', ru: 'abc' })], base)
    expect(r.errors).toEqual([])
    expect(r.valid).toBe(true)
    expect(r.ru).toBe('abc')
    expect(r.roomId).toBeNull()
  })

  it('flags MAC duplicates in the file and in the project, matching across separators and case', () => {
    const rows = validateCmoRows(
      [row({ serial: 'A', mac: '00:1A:2B:3C:4D:5E' }), row({ serial: 'B', mac: '00-1a-2b-3c-4d-5e' }), row({ serial: 'C', mac: 'aa:bb:cc:dd:ee:ff' })],
      { ...base, projectMacs: new Set(['aa:bb:cc:dd:ee:ff']), projectHostnames: new Set() }
    )
    expect(rows[0].errors).toEqual(['duplicate_mac_in_file'])
    expect(rows[1].errors).toEqual(['duplicate_mac_in_file'])
    expect(rows[2].errors).toEqual(['duplicate_mac_in_project'])
    expect(rows.every((r) => !r.valid)).toBe(true)
  })

  it('flags hostname duplicates in the file and in the project, case-insensitively', () => {
    const rows = validateCmoRows([row({ serial: 'A', hostname: 'sw-1' }), row({ serial: 'B', hostname: 'SW-1' }), row({ serial: 'C', hostname: 'SW-9' })], {
      ...base,
      projectMacs: new Set(),
      projectHostnames: new Set(['sw-9']),
    })
    expect(rows.map((r) => r.errors)).toEqual([['duplicate_hostname_in_file'], ['duplicate_hostname_in_file'], ['duplicate_hostname_in_project']])
  })

  it('places a device in a room and rack when they resolve; unknown room, rack or RU are warnings, not errors', () => {
    const resolveRoom = (buildingId, code) => (buildingId === 'b1' && code === 'TR-1' ? 'room1' : null)
    const resolveRack = (roomId, code) => (roomId === 'room1' && code === 'R01' ? 'rack1' : null)
    const opts = { ...base, resolveRoom, resolveRack }
    const [placed] = validateCmoRows([row({ building: 'B001', room: 'TR-1', rack: 'R01', ru: '40' })], opts)
    expect(placed).toMatchObject({ buildingId: 'b1', roomId: 'room1', rackId: 'rack1', ruPosition: 40, warnings: [], valid: true })

    const [lost] = validateCmoRows([row({ building: 'B001', room: 'TR-X', rack: 'R01', ru: '0' })], opts)
    expect(lost.warnings).toEqual(['unknown_room', 'invalid_ru'])
    expect(lost.valid).toBe(true)
    expect(lost.ruPosition).toBeNull()

    const [noRack] = validateCmoRows([row({ building: 'B001', room: 'TR-1', rack: 'R99' })], opts)
    expect(noRack.warnings).toEqual(['unknown_rack'])
  })
})

describe('computeCmoPhaseStatus (real backend, M3a)', () => {
  it('is Not started until the building has imported devices', () => {
    expect(computeCmoPhaseStatus({ buildingDeviceCount: 0, salUnassignedCount: 0 })).toBe('not_started')
    expect(computeCmoPhaseStatus({ buildingDeviceCount: 0, salUnassignedCount: 3 })).toBe('not_started')
  })
  it('is Blocked while its SAL still has Unassigned devices, Completed once none remain', () => {
    expect(computeCmoPhaseStatus({ buildingDeviceCount: 5, salUnassignedCount: 1 })).toBe('blocked')
    expect(computeCmoPhaseStatus({ buildingDeviceCount: 5, salUnassignedCount: 0 })).toBe('completed')
  })
})
