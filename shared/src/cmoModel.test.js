import { describe, it, expect } from 'vitest'
import { isValidMac, applyColumnMapping, validateCmoRows, computeCmoKpis, computeBuildingCmoStatus, guessColumnMapping, normaliseMac, computeCmoPhaseStatus, rowIssueText, CMO_FIELDS, cmoTemplateRows } from './cmoModel.js'

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
    expect(result).toEqual([{ rowIndex: 0, hostname: 'SW-01', vendor: null, model: 'C9300', serial: 'SER001', mac: null, building: 'B001', floor: null, room: null, rack: null, ru: null }])
  })

  it('leaves unmapped fields null', () => {
    const result = applyColumnMapping([['SER001']], { serial: 0 })
    expect(result[0].hostname).toBeNull()
  })
})

describe('validateCmoRows', () => {
  const resolveBuilding = (code) => (code === 'B001' ? 'b001' : null)

  it('a row without a serial imports, marked No serial (a warning, not an error) — fix/cmo-naming-gaps', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, hostname: 'VT-A', model: 'Patch panel 24', serial: null, building: 'B001' }], { projectSerials: new Set(), resolveBuilding })
    expect(row.errors).toEqual([])
    expect(row.warnings).toEqual(['no_serial'])
    expect(row.valid).toBe(true)
    expect(rowIssueText(row, { showWarnings: true })).toMatch(/^No serial/)
  })

  it('a row with no hostname, serial, MAC or model is blocked (nothing identifies it)', () => {
    const [row] = validateCmoRows([{ rowIndex: 0, vendor: 'Cisco', serial: null, building: 'B001', room: 'TR-1' }], { projectSerials: new Set(), resolveBuilding })
    expect(row.errors).toEqual(['no_identity'])
    expect(row.valid).toBe(false)
  })

  it('serial checks apply only when a serial is present: two rows without one never collide', () => {
    const rows = validateCmoRows(
      [
        { rowIndex: 0, model: 'Patch panel 24', serial: null, building: 'B001' },
        { rowIndex: 1, model: 'Patch panel 24', serial: null, building: 'B001' },
        { rowIndex: 2, model: 'C9300', serial: 'S1', building: 'B001' },
        { rowIndex: 3, model: 'C9300', serial: 's1', building: 'B001' },
      ],
      { projectSerials: new Set(), resolveBuilding }
    )
    expect(rows.map((r) => r.errors)).toEqual([[], [], ['duplicate_in_file'], ['duplicate_in_file']])
    expect(rows.map((r) => r.warnings)).toEqual([['no_serial'], ['no_serial'], [], []])
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
    expect(guessColumnMapping(headers)).toEqual({ hostname: 0, vendor: -1, model: 1, serial: 2, mac: 3, building: 4, floor: 5, room: 6, rack: 7, ru: 8 })
  })

  it('finds the vendor column by its usual names, German included (v2.2 §3.5a)', () => {
    for (const header of ['Vendor', 'Manufacturer', 'Hersteller', 'MAKE']) expect(guessColumnMapping(['Hostname', header]).vendor).toBe(1)
    expect(guessColumnMapping(['Etage']).floor).toBe(0)
  })

  it('the import template lines up: its headers map back to every field and its example row imports as given (regression: adding Vendor shifted the example)', () => {
    const [header, example] = cmoTemplateRows()
    expect(example).toHaveLength(header.length)
    const mapping = guessColumnMapping(header)
    expect(mapping).toEqual(Object.fromEntries(CMO_FIELDS.map((f, i) => [f.key, i])))
    expect(applyColumnMapping([example], mapping)[0]).toMatchObject({ hostname: 'E-DE-ERL-C01-B001-EG-001', vendor: 'Cisco', model: 'C9300-48UX', serial: 'FCW2637A1B2', floor: 'EG', ru: '40' })
  })

  it('every column is optional; hostname, model, serial and MAC identify a row', () => {
    expect(CMO_FIELDS.filter((f) => f.required)).toEqual([])
    expect(CMO_FIELDS.filter((f) => f.identity).map((f) => f.key)).toEqual(['hostname', 'model', 'serial', 'mac'])
  })

  it('returns -1 for fields with no matching header', () => {
    const mapping = guessColumnMapping(['Serial'])
    expect(mapping.serial).toBe(0)
    expect(mapping.hostname).toBe(-1)
  })
})

describe('computeCmoKpis', () => {
  it('splits assigned vs unassigned by buildingId presence', () => {
    const kpis = computeCmoKpis([{ buildingId: 'b001', serial: 'A' }, { buildingId: null, serial: null }, { buildingId: null, serial: 'C' }])
    expect(kpis).toEqual({ total: 3, assigned: 1, unassigned: 2, noSerial: 1 })
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

  it('checks the floor against the building like room and rack: unknown is a warning; a room on another floor is left out', () => {
    const resolveFloor = (buildingId, text) => (buildingId === 'b1' && ['eg', 'ground floor'].includes(text.toLowerCase()) ? 'floorEG' : buildingId === 'b1' && text === '1.OG' ? 'floor1' : null)
    const resolveRoom = (buildingId, code) => (buildingId === 'b1' && code === 'TR-1' ? 'room1' : null)
    const resolveRack = (roomId, code) => (roomId === 'room1' && code === 'R01' ? 'rack1' : null)
    const roomFloor = (roomId) => (roomId === 'room1' ? 'floorEG' : null)
    const opts = { ...base, resolveFloor, roomFloor, resolveRoom, resolveRack }
    const [ok] = validateCmoRows([row({ building: 'B001', floor: 'Ground floor', room: 'TR-1', rack: 'R01' })], opts)
    expect(ok).toMatchObject({ floorId: 'floorEG', roomId: 'room1', rackId: 'rack1', warnings: [], valid: true })
    const [floorOnly] = validateCmoRows([row({ building: 'B001', floor: '1.OG' })], opts)
    expect(floorOnly).toMatchObject({ floorId: 'floor1', roomId: null, warnings: [], valid: true })
    const [unknown] = validateCmoRows([row({ building: 'B001', floor: '9.OG', room: 'TR-1' })], opts)
    expect(unknown).toMatchObject({ floorId: null, roomId: 'room1', warnings: ['unknown_floor'], valid: true })
    const [elsewhere] = validateCmoRows([row({ building: 'B001', floor: '1.OG', room: 'TR-1', rack: 'R01' })], opts)
    expect(elsewhere).toMatchObject({ floorId: 'floor1', roomId: null, rackId: null, warnings: ['room_not_on_floor'], valid: true })
    // Without a building the floor is not checked (as room and rack): Unassigned.
    const [unassigned] = validateCmoRows([row({ floor: 'EG' })], opts)
    expect(unassigned).toMatchObject({ floorId: null, warnings: [] })
  })

  it("the preview's Issues text shows a server-side free-text refusal (found in fix/cmo-naming-gaps: it showed blank)", () => {
    const r = { errors: ['Building B002 is outside your scope'], warnings: ['unknown_room'] }
    expect(rowIssueText(r)).toBe('Building B002 is outside your scope')
    expect(rowIssueText(r, { showWarnings: true })).toBe('Building B002 is outside your scope, Unknown room — imported without a room')
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
