import { describe, it, expect } from 'vitest'
import { conditionHolds, customRuleFindings, fillMessage, operatorsFor, operatorTakesValue, ruleProblems, ruleField, ruleObject, RULE_OBJECTS, placeholdersOf } from './customRules.js'
import { validateHld, summariseFindings, sortFindings } from './hldRules.js'
import { validationRuleBody, validationRulePreviewBody } from './contracts.js'
import { can, ACTIONS } from './policy.js'

// M7b-5: custom validation rules (DATA-MODEL §3.11, D11; v2.2 §3.4).
const rule = (over = {}) => ({ id: 'r1', name: 'R', object: 'device', subjectRole: null, field: 'hostname', operator: 'empty', value: null, severity: 'warning', message: null, ...over })

describe('The condition', () => {
  it('each operator, on numbers, text (any case), booleans and lists', () => {
    expect(conditionHolds(5, 'eq', 5)).toBe(true)
    expect(conditionHolds(5, 'neq', 5)).toBe(false)
    expect(conditionHolds(5, 'gt', 4)).toBe(true)
    expect(conditionHolds(5, 'gt', 5)).toBe(false)
    expect(conditionHolds(5, 'gte', 5)).toBe(true)
    expect(conditionHolds(5, 'lt', 6)).toBe(true)
    expect(conditionHolds(5, 'lte', 4)).toBe(false)
    expect(conditionHolds('Edge', 'eq', 'edge')).toBe(true)
    expect(conditionHolds('Edge', 'neq', 'edge')).toBe(false)
    expect(conditionHolds(false, 'eq', false)).toBe(true)
    expect(conditionHolds(true, 'neq', false)).toBe(true)
    expect(conditionHolds('os2', 'in', ['OS2', 'om4'])).toBe(true)
    expect(conditionHolds('cat6a', 'notIn', ['os2', 'om4'])).toBe(true)
    expect(conditionHolds('os2', 'notIn', ['os2'])).toBe(false)
  })
  it('a value that is not there: only "empty" holds — a rule without its input is not applicable', () => {
    for (const missing of [null, undefined, '']) {
      expect(conditionHolds(missing, 'empty')).toBe(true)
      expect(conditionHolds(missing, 'notEmpty')).toBe(false)
      for (const op of ['eq', 'neq', 'gt', 'lt', 'in', 'notIn']) expect(conditionHolds(missing, op, op.includes('n') && op !== 'neq' ? ['x'] : 1), op).toBe(false)
    }
    // Zero and false are values.
    expect(conditionHolds(0, 'empty')).toBe(false)
    expect(conditionHolds(false, 'notEmpty')).toBe(true)
    expect(conditionHolds(0, 'lt', 1)).toBe(true)
  })
  it('a message is filled as plain text; what it does not know reads —', () => {
    expect(fillMessage('{hostname} at {value}%', { hostname: 'E-1', value: 90 })).toBe('E-1 at 90%')
    expect(fillMessage('{hostname}', {})).toBe('—')
    expect(fillMessage('{constructor}', {})).toBe('—')
    expect(fillMessage('{hostname}', { hostname: '<img onerror=x>{value}' })).toBe('<img onerror=x>{value}')
  })
})

describe('The allowlist', () => {
  it('own keys only: JavaScript’s property names are no object or field', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(ruleObject(name), name).toBe(null)
      expect(ruleField('device', name), name).toBe(null)
    }
    expect(ruleProblems(rule({ object: 'constructor' })).map((p) => p.path)).toEqual(['object'])
    expect(ruleProblems(rule({ field: 'constructor' })).map((p) => p.path)).toEqual(['field'])
  })
  it('an operator must suit the field, a value its type; placeholders are the object’s', () => {
    expect(ruleProblems(rule())).toEqual([])
    expect(operatorsFor('boolean')).toEqual(['eq', 'neq'])
    expect(operatorTakesValue('empty')).toBe(false)
    expect(ruleProblems(rule({ field: 'placed', operator: 'eq', value: true }))).toEqual([])
    expect(ruleProblems(rule({ field: 'placed', operator: 'eq', value: 'yes' })).map((p) => p.path)).toEqual(['value'])
    expect(ruleProblems(rule({ field: 'hostname', operator: 'gt', value: 1 })).map((p) => p.path)).toEqual(['operator'])
    expect(ruleProblems(rule({ field: 'uplinkCount', operator: 'gt', value: 1 }))).toEqual([])
    expect(ruleProblems(rule({ field: 'role', operator: 'in', value: ['edge', 'nope'] })).map((p) => p.path)).toEqual(['value'])
    expect(ruleProblems(rule({ subjectRole: 'nope' })).map((p) => p.path)).toEqual(['subjectRole'])
    expect(ruleProblems(rule({ message: '{rack_label}' })).map((p) => p.path)).toEqual(['message'])
    expect(placeholdersOf('rack')).toEqual(['value', 'rack_label'])
    expect(ruleProblems(rule({ object: 'rack', field: 'heightU', operator: 'gt', value: 1, message: 'Rack {rack_label} {value}' }))).toEqual([])
    // Every field of every object can be written: its type has operators.
    for (const object of Object.values(RULE_OBJECTS)) for (const f of Object.values(object.fields)) expect(operatorsFor(f.type).length, f.label).toBeGreaterThan(0)
  })
  it('the contract: strict, no other severity, a preview checks its rule too', () => {
    const good = { name: 'R', object: 'device', field: 'hostname', operator: 'empty', severity: 'info' }
    expect(validationRuleBody.safeParse(good).success).toBe(true)
    expect(validationRuleBody.safeParse({ ...good, severity: 'blocking' }).success).toBe(false)
    expect(validationRuleBody.safeParse({ ...good, expression: 'x' }).success).toBe(false)
    expect(validationRuleBody.safeParse({ ...good, name: ' ' }).success).toBe(false)
    expect(validationRulePreviewBody.safeParse({ buildingId: '0'.repeat(24), rule: good }).success).toBe(true)
    expect(validationRulePreviewBody.safeParse({ buildingId: '0'.repeat(24), rule: { ...good, field: 'nope' } }).success).toBe(false)
  })
  it('D11: project rules are the Architect’s alone', () => {
    expect(can(['architect'], ACTIONS.MANAGE_PROJECT_VALIDATION_RULES)).toBe(true)
    for (const role of ['org_admin', 'pm', 'reviewer', 'external_reviewer', 'field_engineer', 'viewer']) expect(can([role], ACTIONS.MANAGE_PROJECT_VALIDATION_RULES), role).toBe(false)
  })
})

describe('The findings', () => {
  const devices = [
    { id: 'b', origin: 'planned', role: 'border', hostname: 'B-1', catalogueKey: 'K', rackId: 'k1', ru: 40, heightU: 2, roomId: 'r1', psuConfigured: 1 },
    { id: 'e', origin: 'planned', role: 'edge', hostname: 'E-1', rackId: null, ru: null, heightU: 1, roomId: 'r2', psuConfigured: 2 },
    { id: 'x', origin: 'existing', role: 'edge', hostname: null, label: 'PDU-A', rackId: 'k1', ru: 10, heightU: 2, roomId: 'r1' },
  ]
  const connections = [{ id: 'c1', source: { deviceId: 'b' }, dest: { deviceId: 'e' }, media: 'os2', speed: '10G', lengthM: 95.26, lengthEstimated: true, cableId: null, hops: [] }]
  const racks = [{ id: 'k1', roomId: 'r1', code: 'R01', heightU: 42 }]
  const rooms = [{ id: 'r1', code: 'TR-1', isMainRoom: true }, { id: 'r2', code: 'TR-2', isMainRoom: false }]
  const pathways = [{ fromRoomId: 'r1', toRoomId: 'r2', routeStatus: 'estimated', distanceM: null }]
  const design = { devices, connections, racks, rooms, pathways }
  const ctx = { itemOf: (d) => (d.catalogueKey === 'K' ? { psuCount: 2, powerDrawW: 300, weightKg: 12, portMap: { groups: [{ role: 'access', type: 'SFP+', speed: '10G', count: 24, start: 1, pattern: 'Te1/1/{n}' }] } } : null) }
  const run = (r) => customRuleFindings([rule(r)], design, ctx)

  it('device rules: the design’s own devices only, one role when the rule says so, calculated fields', () => {
    expect(run({ field: 'hostname', operator: 'empty' })).toEqual([])
    expect(run({ field: 'hostname', operator: 'notEmpty' }).map((f) => f.objectId)).toEqual(['b', 'e'])
    expect(run({ field: 'uplinkCount', operator: 'eq', value: 1, subjectRole: 'edge' }).map((f) => f.objectId)).toEqual(['e'])
    expect(run({ field: 'placed', operator: 'eq', value: false }).map((f) => f.objectId)).toEqual(['e'])
    expect(run({ field: 'portCount', operator: 'eq', value: 24 }).map((f) => f.objectId)).toEqual(['b'])
    // v2.2's example: fewer PSUs configured than slots — here at the field's own value.
    expect(run({ field: 'psuSlots', operator: 'gt', value: 1, message: '{hostname} has {psu_count}/{psu_slots} PSUs' })[0].message).toBe('B-1 has 1/2 PSUs')
  })
  it('connection, rack, room and pathway rules; a message rounds what it shows', () => {
    expect(run({ object: 'connection', field: 'lengthM', operator: 'gt', value: 90, message: '{link_id}: {length} m ({media})' })[0]).toMatchObject({ objectType: 'connection', objectId: 'c1', message: 'B-1 → E-1: 95.3 m (os2)' })
    expect(run({ object: 'connection', field: 'lengthEstimated', operator: 'eq', value: true })).toHaveLength(1)
    expect(run({ object: 'connection', field: 'media', operator: 'in', value: ['os2'] })).toHaveLength(1)
    // Rack figures count everything in it, surveyed gear too.
    expect(run({ object: 'rack', field: 'deviceCount', operator: 'eq', value: 2 })[0]).toMatchObject({ objectType: 'rack', objectId: 'k1' })
    expect(run({ object: 'rack', field: 'pduCount', operator: 'eq', value: 1, message: 'Rack {rack_label} has no power redundancy' })[0].message).toBe('Rack R01 has no power redundancy')
    expect(run({ object: 'rack', field: 'occupancyPct', operator: 'gte', value: 9, message: '{value}%' })[0].message).toBe('10%')
    expect(run({ object: 'rack', field: 'weightKg', operator: 'eq', value: 12 })).toHaveLength(1)
    expect(run({ object: 'room', field: 'rackCount', operator: 'eq', value: 0, message: '{room_code}' }).map((f) => f.message)).toEqual(['TR-2'])
    expect(run({ object: 'room', field: 'isMainRoom', operator: 'eq', value: true })).toHaveLength(1)
    expect(run({ object: 'pathway', field: 'routeStatus', operator: 'eq', value: 'estimated', message: '{from} – {to}' })[0].message).toBe('TR-1 – TR-2')
    // No distance recorded: a distance rule does not apply.
    expect(run({ object: 'pathway', field: 'distanceM', operator: 'lt', value: 100 })).toEqual([])
  })
  it('without a message it names the rule and the record; several rules each report', () => {
    expect(run({ name: 'Unplaced', field: 'placed', operator: 'eq', value: false })[0].message).toBe('Unplaced: E-1')
    expect(run({ name: 'Racks', object: 'rack', field: 'heightU', operator: 'eq', value: 42 })[0].message).toBe('Racks: Rack R01')
    const both = customRuleFindings([rule({ id: 'a', field: 'placed', operator: 'eq', value: false }), rule({ id: 'b', field: 'placed', operator: 'eq', value: true })], design, ctx)
    expect(both.map((f) => [f.ruleId, f.objectId])).toEqual([['a', 'e'], ['b', 'b']])
    expect(new Set(both.map((f) => f.id)).size).toBe(2)
    expect(customRuleFindings([], design, ctx)).toEqual([])
    expect(customRuleFindings(null, design, ctx)).toEqual([])
  })
  it('in the validation: alongside the built-in findings, sorted with them; a Critical blocks; a rule naming nothing known is skipped', () => {
    const base = { itemOf: () => null, opticOf: () => null, patchPanelFreePorts: () => null }
    const none = validateHld({ devices, connections, racks: [] }, base)
    const out = validateHld({ devices, connections, racks: [], rooms, pathways, customRules: [rule({ severity: 'critical', field: 'placed', operator: 'eq', value: false }), rule({ id: 'gone', field: 'removedField' })] }, base)
    expect(out).toHaveLength(none.length + 1)
    expect(out[0]).toMatchObject({ custom: true, severity: 'critical' })
    expect(summariseFindings(out).blocksSubmit).toBe(true)
    expect(sortFindings(out)).toHaveLength(out.length)
  })
})
