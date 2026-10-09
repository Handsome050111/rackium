import { describe, it, expect } from 'vitest'
import {
  getTabDefinition,
  BUILDING_TABS,
  ROOM_TABS,
  isCalculatedKey,
  toComponentSections,
  recordCompleteness,
  validateSurveyOp,
  applySurveyOp,
  statusAfterEdit,
  checkTransition,
  expectedSurveyTabs,
  computeSurveyPhaseStatus,
  scopeCoversBuilding,
} from './surveyForm.js'

const tab = getTabDefinition
const ID = (n) => String(n).padStart(24, 'a')
const FE = { roles: ['field_engineer'] }
const ARCH = { roles: ['architect'] }

describe('template split', () => {
  it('has the 6 building-scope and 12 room-scope tabs of the brief', () => {
    expect(BUILDING_TABS).toEqual(['Location Details', 'WAN', 'SSID', 'Storage Area', 'Reference Images', 'Passive Requirements for FMO'])
    expect(ROOM_TABS).toHaveLength(12)
    expect(expectedSurveyTabs(['r1', 'r2'])).toHaveLength(6 + 24)
  })
})

describe('calculated fields', () => {
  it('are read-only: building/room identity everywhere, rack identity in Rack Layout, rack stats in Comms Rooms Summary', () => {
    const fw = tab('Firewall')
    expect(isCalculatedKey(fw, fw.sections[0], 'building_name')).toBe(true)
    expect(isCalculatedKey(fw, fw.sections[0], 'building_wing')).toBe(false)
    const rl = tab('Rack Layout')
    expect(isCalculatedKey(rl, rl.sections[0], 'rack_name')).toBe(true)
    const crs = tab('Comms Rooms Summary')
    expect(isCalculatedKey(crs, crs.sections[0], 'total_number_rack_units')).toBe(true)
    expect(isCalculatedKey(crs, crs.sections[0], 'rack_number')).toBe(false)
  })

  it('are merged into the component shape, so a started row with calculated must columns can complete', () => {
    const crs = tab('Comms Rooms Summary')
    const fields = Object.fromEntries(
      crs.sections[0].fields.filter((f) => f.requirement === 'must' || f.requirement === 'must_if_allowed').map((f) => [f.key, f])
    )
    const filled = ['rack_number'].map((key) => ({ key, value: 'r01' }))
    const record = { sections: [{ sectionIndex: 0, rows: [{ rowId: ID(1), fieldValues: [...filled, { key: 'take_photographs', value: { fileIds: [ID(9)] } }] }] }] }
    const sections = toComponentSections(crs, record, {
      ctx: { buildingCode: 'B001', floorName: 'Ground', roomCode: 'TR-EG-01' },
      rackStatsByCode: { R01: { totalRU: 42, usedRU: 5, freeRU: 37, pduAFree: 4, pduBFree: 3 } },
    })
    expect(sections[0][0]).toMatchObject({ id: ID(1), building_number: 'B001', comms_room_number: 'TR-EG-01', total_number_rack_units: 42, unused_rus_in_existing_racks: 37 })
    expect(Object.keys(fields).every((k) => sections[0][0][k] != null)).toBe(true)
    expect(recordCompleteness(crs, sections).complete).toBe(true)
  })

  it('Rack Layout has one instance per real rack, in rack order, with its identity filled', () => {
    const rl = tab('Rack Layout')
    const sections = toComponentSections(rl, { sections: [{ sectionIndex: 0, rows: [{ rowId: 'r2', rackId: 'r2', fieldValues: [{ key: 'rack_purpose', value: 'Core' }] }] }] }, {
      rackList: [
        { id: 'r1', code: 'R01', rackPosition: 1 },
        { id: 'r2', code: 'R02', rackPosition: 2 },
      ],
    })
    expect(sections[0]).toEqual([
      { rackId: 'r1', rack_name: 'R01', sequence_no: '1' },
      { rackId: 'r2', rack_name: 'R02', sequence_no: '2', rack_purpose: 'Core' },
    ])
  })

  it('photo and file values become { count, fileIds } / { fileName, fileIds }; confirmations become key__confirmed', () => {
    const ld = tab('Location Details')
    const sections = toComponentSections(ld, { sections: [{ sectionIndex: 0, fieldValues: [{ key: 'location_function', value: 'Office', confirmed: true }] }] })
    expect(sections[0]).toMatchObject({ location_function: 'Office', location_function__confirmed: true })
    const ri = tab('Reference Images')
    const gallery = toComponentSections(ri, { sections: [{ sectionIndex: 0, fieldValues: [{ key: 'reference_images', value: { fileIds: [ID(1), ID(2)] } }] }] })
    expect(gallery[0].reference_images).toEqual({ count: 2, fileIds: [ID(1), ID(2)] })
  })
})

describe('edit validation (who may change what)', () => {
  const ld = tab('Location Details')
  const fw = tab('Firewall')
  it('the Field Engineer fills any field; Architect and PM only prefill fields', () => {
    expect(validateSurveyOp(ld, { kind: 'setField', sectionIndex: 0, key: 'location_id', value: 'X' }, FE)).toBeNull()
    expect(validateSurveyOp(ld, { kind: 'setField', sectionIndex: 0, key: 'location_id', value: 'X' }, ARCH)).toBeNull()
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'building_wing', value: 'A', rowId: ID(1) }, ARCH)).toMatch(/only fill prefill/)
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'building_wing', value: 'A', rowId: ID(1) }, { roles: ['viewer'] })).toMatch(/Field Engineer/)
  })
  it('only the Field Engineer confirms on site, and only prefilled_validated fields', () => {
    expect(validateSurveyOp(ld, { kind: 'confirmField', sectionIndex: 0, key: 'location_function', confirmed: true }, FE)).toBeNull()
    expect(validateSurveyOp(ld, { kind: 'confirmField', sectionIndex: 0, key: 'location_function', confirmed: true }, ARCH)).toMatch(/confirms on site/)
    expect(validateSurveyOp(ld, { kind: 'confirmField', sectionIndex: 0, key: 'location_id', confirmed: true }, FE)).toMatch(/nothing to confirm/)
  })
  it('calculated fields, unknown fields, bad values and malformed rows are refused', () => {
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'building_name', value: 'X', rowId: ID(1) }, FE)).toMatch(/calculated/)
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'nope', value: 'X', rowId: ID(1) }, FE)).toMatch(/No such field/)
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'building_wing', value: 'X' }, FE)).toMatch(/needs its row/)
    expect(validateSurveyOp(fw, { kind: 'setField', sectionIndex: 0, key: 'building_wing', value: { evil: 1 }, rowId: ID(1) }, FE)).toMatch(/Unsupported/)
    expect(validateSurveyOp(fw, { kind: 'addRow', sectionIndex: 0, rowId: 'x' }, FE)).toMatch(/needs an id/)
    expect(validateSurveyOp(ld, { kind: 'addRow', sectionIndex: 0, rowId: ID(1) }, FE)).toMatch(/only be added to tables/)
  })
  it('custom fields (Org Admin) are fillable in section 0', () => {
    const custom = [{ key: 'custom_abc', label: 'Internal note', type: 'text', requirement: 'unspecified' }]
    expect(validateSurveyOp(tab('Storage Area'), { kind: 'setField', sectionIndex: 0, key: 'custom_abc', value: 'hello' }, { ...FE, customFields: custom })).toBeNull()
  })
  it('item_list cells name a row and a column', () => {
    const fmo = tab('Passive Requirements for FMO')
    expect(validateSurveyOp(fmo, { kind: 'setField', sectionIndex: 0, rowKey: 'ladder_requirement_if_any', key: 'details', value: '3 m' }, FE)).toBeNull()
    expect(validateSurveyOp(fmo, { kind: 'setField', sectionIndex: 0, rowKey: 'ladder_requirement_if_any', key: 'colour', value: 'x' }, FE)).toMatch(/No such column/)
  })
})

describe('applying edits', () => {
  const fw = tab('Firewall')
  const by = 'u1'
  const at = '2026-10-08T10:00:00.000Z'
  it('adds rows idempotently, sets cells and records who changed what before', () => {
    let { sections } = applySurveyOp(fw, [], { kind: 'addRow', sectionIndex: 0, rowId: ID(1) }, { by, at })
    ;({ sections } = applySurveyOp(fw, sections, { kind: 'addRow', sectionIndex: 0, rowId: ID(1) }, { by, at }))
    expect(sections[0].rows).toHaveLength(1)
    ;({ sections } = applySurveyOp(fw, sections, { kind: 'setField', sectionIndex: 0, rowId: ID(1), key: 'building_wing', value: 'North' }, { by, at }))
    const second = applySurveyOp(fw, sections, { kind: 'setField', sectionIndex: 0, rowId: ID(1), key: 'building_wing', value: 'South' }, { by: 'u2', at: '2026-10-08T11:00:00.000Z' })
    expect(second.changes[0]).toEqual({ field: 'building_wing', before: 'North', after: 'South', previousBy: 'u1', previousAt: at })
  })
  it('duplicates a row after its source, and reports a missing row', () => {
    let { sections } = applySurveyOp(fw, [], { kind: 'addRow', sectionIndex: 0, rowId: ID(1) }, { by, at })
    ;({ sections } = applySurveyOp(fw, sections, { kind: 'setField', sectionIndex: 0, rowId: ID(1), key: 'building_wing', value: 'N' }, { by, at }))
    ;({ sections } = applySurveyOp(fw, sections, { kind: 'duplicateRow', sectionIndex: 0, rowId: ID(1), newRowId: ID(2) }, { by, at }))
    expect(sections[0].rows.map((r) => r.rowId)).toEqual([ID(1), ID(2)])
    expect(sections[0].rows[1].fieldValues[0].value).toBe('N')
    expect(applySurveyOp(fw, sections, { kind: 'setField', sectionIndex: 0, rowId: ID(7), key: 'building_wing', value: 'x' }, { by, at }).missing).toBe(true)
  })
  it('creates a Rack Layout instance on first write', () => {
    const rl = tab('Rack Layout')
    const { sections } = applySurveyOp(rl, [], { kind: 'setField', sectionIndex: 0, rackId: 'rk1', key: 'rack_purpose', value: 'Core' }, { by, at })
    expect(sections[0].rows[0]).toMatchObject({ rackId: 'rk1', fieldValues: [expect.objectContaining({ key: 'rack_purpose', value: 'Core' })] })
  })
})

describe('workflow', () => {
  it('edits revert Rejected, Verified and Imported to Draft; Imported also flags; Submitted is locked', () => {
    expect(statusAfterEdit('rejected')).toMatchObject({ allowed: true, next: 'draft', reverted: false, flag: false })
    expect(statusAfterEdit('verified')).toMatchObject({ allowed: true, reverted: true, flag: false })
    expect(statusAfterEdit('imported')).toMatchObject({ allowed: true, reverted: true, flag: true })
    expect(statusAfterEdit('submitted').allowed).toBe(false)
  })
  it('only the Field Engineer submits a complete Draft; only the Architect verifies or rejects (with a reason) a Submitted tab', () => {
    expect(checkTransition('submit', 'draft', { ...FE, complete: true })).toBeNull()
    expect(checkTransition('submit', 'draft', { ...FE, complete: false })).toMatch(/Must/)
    expect(checkTransition('submit', 'draft', { ...ARCH, complete: true })).toMatch(/Field Engineer/)
    expect(checkTransition('submit', 'verified', FE)).toMatch(/cannot be submitted/)
    expect(checkTransition('verify', 'submitted', ARCH)).toBeNull()
    expect(checkTransition('verify', 'draft', ARCH)).toMatch(/submitted/)
    expect(checkTransition('verify', 'submitted', { roles: ['pm'] })).toMatch(/Architect/)
    expect(checkTransition('reject', 'submitted', { ...ARCH, reason: ' ' })).toMatch(/reason/)
    expect(checkTransition('reject', 'submitted', { ...ARCH, reason: 'Wrong rack' })).toBeNull()
  })
})

describe('survey phase status', () => {
  const allVerified = (roomIds) => expectedSurveyTabs(roomIds).map((e) => ({ ...e, status: 'verified', hasData: true }))
  it('is Approved only when every building tab and every room tab of every room is Verified (or Imported)', () => {
    expect(computeSurveyPhaseStatus({ roomIds: ['r1'], records: allVerified(['r1']) })).toBe('approved')
    const oneImported = allVerified(['r1']).map((r, i) => (i === 0 ? { ...r, status: 'imported' } : r))
    expect(computeSurveyPhaseStatus({ roomIds: ['r1'], records: oneImported })).toBe('approved')
    expect(computeSurveyPhaseStatus({ roomIds: ['r1', 'r2'], records: allVerified(['r1']) })).toBe('in_progress')
  })
  it('is Changes requested while any tab is Rejected, Not started with nothing done, and never Approved without rooms', () => {
    const rejected = allVerified(['r1']).map((r, i) => (i === 3 ? { ...r, status: 'rejected' } : r))
    expect(computeSurveyPhaseStatus({ roomIds: ['r1'], records: rejected })).toBe('changes_requested')
    expect(computeSurveyPhaseStatus({ roomIds: ['r1'], records: [] })).toBe('not_started')
    expect(computeSurveyPhaseStatus({ roomIds: [], records: allVerified([]) })).toBe('in_progress')
  })
})

describe('membership scope', () => {
  const building = { id: 'b1', salId: 's1', countryId: 'c1' }
  it('empty means the whole project; otherwise the building, its SAL or its country must be named', () => {
    expect(scopeCoversBuilding([], building)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'building', refId: 'b1' }], building)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'sal', refId: 's1' }], building)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'country', refId: 'c1' }], building)).toBe(true)
    expect(scopeCoversBuilding([{ type: 'building', refId: 'b2' }, { type: 'sal', refId: 's9' }], building)).toBe(false)
  })
})
