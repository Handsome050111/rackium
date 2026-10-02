import { describe, it, expect } from 'vitest'
import {
  SURVEY_TABS,
  getTabDefinition,
  tabSlug,
  tabBySlug,
  parseHintOptions,
  isValidIp,
  isValidEmail,
  isFieldRequired,
  isFieldFilled,
  fieldFormatError,
  computeTabCompleteness,
  calculatedFieldValue,
  rackInstanceCalculatedValue,
} from './surveyFormModel.js'

describe('SURVEY_TABS', () => {
  it('loads all 18 tabs from docs/survey-fields.json', () => {
    expect(SURVEY_TABS).toHaveLength(18)
  })

  it('getTabDefinition finds a tab by exact name', () => {
    expect(getTabDefinition('WAN')?.scope).toBe('building')
    expect(getTabDefinition('Nonexistent')).toBeNull()
  })

  it('tabSlug/tabBySlug round-trip for every tab', () => {
    for (const tab of SURVEY_TABS) {
      expect(tabBySlug(tabSlug(tab.tab))?.tab).toBe(tab.tab)
    }
  })
})

describe('parseHintOptions', () => {
  it('parses a clean slash-separated option list', () => {
    expect(parseHintOptions('Static/DHCP')).toEqual(['Static', 'DHCP'])
    expect(parseHintOptions('SC/LC')).toEqual(['SC', 'LC'])
    expect(parseHintOptions('Access switch/Core switch')).toEqual(['Access switch', 'Core switch'])
  })

  it('rejects a long prose aside even if it contains a slash', () => {
    expect(parseHintOptions('Latitude/longitude of the buildings to build the Site hierarchy in DNAC for FMO')).toBeNull()
    expect(parseHintOptions('Local ISE/DDI or Site criticality and redundancy in all layers etc')).toBeNull()
  })

  it('returns null for hints with no slash at all (clarifying notes, not options)', () => {
    expect(parseHintOptions('or label on device')).toBeNull()
    expect(parseHintOptions('LED Green')).toBeNull()
    expect(parseHintOptions(null)).toBeNull()
  })
})

describe('isValidIp / isValidEmail', () => {
  it('accepts a well-formed IPv4 address', () => {
    expect(isValidIp('10.10.10.1')).toBe(true)
  })
  it('rejects an out-of-range octet or malformed address', () => {
    expect(isValidIp('10.10.10.999')).toBe(false)
    expect(isValidIp('not-an-ip')).toBe(false)
  })
  it('treats empty as not a format error (missing-ness is a separate check)', () => {
    expect(isValidIp('')).toBe(true)
    expect(isValidEmail('')).toBe(true)
  })
  it('accepts/rejects email shape', () => {
    expect(isValidEmail('a@b.com')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
  })
})

describe('isFieldRequired / isFieldFilled', () => {
  it('must and must_if_allowed both count as required; good_to_have/unspecified do not', () => {
    expect(isFieldRequired({ requirement: 'must' })).toBe(true)
    expect(isFieldRequired({ requirement: 'must_if_allowed' })).toBe(true)
    expect(isFieldRequired({ requirement: 'good_to_have' })).toBe(false)
    expect(isFieldRequired({ requirement: 'unspecified' })).toBe(false)
  })

  it('a photo field is filled once its count is above zero', () => {
    const field = { type: 'photo' }
    expect(isFieldFilled(field, { count: 0 })).toBe(false)
    expect(isFieldFilled(field, { count: 1 })).toBe(true)
    expect(isFieldFilled(field, undefined)).toBe(false)
  })

  it('a rack_elevation field is always considered filled — it is captured elsewhere', () => {
    expect(isFieldFilled({ type: 'rack_elevation' }, undefined)).toBe(true)
  })

  it('a text field is filled only with non-blank content', () => {
    expect(isFieldFilled({ type: 'text' }, '  ')).toBe(false)
    expect(isFieldFilled({ type: 'text' }, 'value')).toBe(true)
  })

  it('a prefilled_validated field needs the "Validated on site" tick, not just a value', () => {
    const field = { type: 'text', prefill: 'prefilled_validated' }
    expect(isFieldFilled(field, 'Berlin', false)).toBe(false)
    expect(isFieldFilled(field, 'Berlin', true)).toBe(true)
  })

  it('a plain prefilled field (no _validated) only needs a value, no tick', () => {
    const field = { type: 'text', prefill: 'prefilled' }
    expect(isFieldFilled(field, 'Berlin', false)).toBe(true)
  })
})

describe('fieldFormatError', () => {
  it('flags a bad MAC/IP/email but leaves a text field alone', () => {
    expect(fieldFormatError({ type: 'mac' }, 'garbage')).toBe('Invalid MAC format')
    expect(fieldFormatError({ type: 'ip' }, '999.1.1.1')).toBe('Invalid IPv4 format')
    expect(fieldFormatError({ type: 'email' }, 'nope')).toBe('Invalid email format')
    expect(fieldFormatError({ type: 'text' }, 'anything')).toBeNull()
  })

  it('does not flag an empty value — that is the must-field check\'s job', () => {
    expect(fieldFormatError({ type: 'mac' }, '')).toBeNull()
  })
})

describe('computeTabCompleteness', () => {
  it('a key_value tab is 100% complete once every must field has a value', () => {
    const tabDef = getTabDefinition('Storage Area')
    const record = Object.fromEntries(
      tabDef.sections[0].fields.filter(isFieldRequired).map((f) => [f.key, f.type === 'photo' ? { count: 1 } : 'x'])
    )
    const result = computeTabCompleteness(tabDef, () => record)
    expect(result.complete).toBe(true)
    expect(result.percent).toBe(100)
  })

  it('a key_value tab is partial when some must fields are empty', () => {
    const tabDef = getTabDefinition('Storage Area')
    const result = computeTabCompleteness(tabDef, () => ({}))
    expect(result.complete).toBe(false)
    expect(result.percent).toBeLessThan(100)
  })

  it('an empty table section counts as complete — not every inventory tab applies to every room', () => {
    const tabDef = getTabDefinition('Lab / Isolated Network')
    const result = computeTabCompleteness(tabDef, () => [])
    expect(result).toEqual({ required: 0, filled: 0, percent: 100, complete: true })
  })

  it('a table section with a partially-filled row is incomplete', () => {
    const tabDef = getTabDefinition('Lab / Isolated Network')
    const result = computeTabCompleteness(tabDef, () => [{ building_number_name: 'B001' }])
    expect(result.complete).toBe(false)
  })

  it('the gallery tab (Reference Images) has no required fields, so it is always complete', () => {
    const tabDef = getTabDefinition('Reference Images')
    const result = computeTabCompleteness(tabDef, () => ({}))
    expect(result).toEqual({ required: 0, filled: 0, percent: 100, complete: true })
  })

  it('Rack Layout (repeatable_per: rack) requires each rack instance independently, and zero racks means nothing to require', () => {
    const tabDef = getTabDefinition('Rack Layout')
    expect(computeTabCompleteness(tabDef, () => []).complete).toBe(true)

    const requiredFields = tabDef.sections[0].fields.filter(isFieldRequired)
    const fullInstance = Object.fromEntries(requiredFields.map((f) => [f.key, f.type === 'photo' ? { count: 1 } : 'x']))
    expect(computeTabCompleteness(tabDef, () => [fullInstance, fullInstance]).complete).toBe(true)
    expect(computeTabCompleteness(tabDef, () => [fullInstance, {}]).complete).toBe(false)
  })

  it('Location Details is incomplete until every prefilled_validated field is actually ticked validated, not just populated', () => {
    const tabDef = getTabDefinition('Location Details')
    const kvFields = tabDef.sections[0].fields.filter(isFieldRequired)
    const tableFields = tabDef.sections[1].fields.filter(isFieldRequired)
    const kvRecord = Object.fromEntries(kvFields.map((f) => [f.key, 'x']))
    const tableRow = Object.fromEntries(tableFields.map((f) => [f.key, 'x']))
    const withoutTicks = computeTabCompleteness(tabDef, (s) => (s.layout === 'table' ? [tableRow] : kvRecord))
    expect(withoutTicks.complete).toBe(false)

    const confirmedKv = { ...kvRecord }
    for (const f of kvFields) if (f.prefill === 'prefilled_validated') confirmedKv[`${f.key}__confirmed`] = true
    const withTicks = computeTabCompleteness(tabDef, (s) => (s.layout === 'table' ? [tableRow] : confirmedKv))
    expect(withTicks.complete).toBe(true)
  })

  it('an item_list tab (Passive Requirements for FMO) requires every column on every must row', () => {
    const tabDef = getTabDefinition('Passive Requirements for FMO')
    const section = tabDef.sections[0]
    const fullRecord = Object.fromEntries(
      section.fields.map((f) => [f.key, Object.fromEntries(section.item_columns.map((c) => [c, c === 'photograph' ? { count: 1 } : 'x']))])
    )
    expect(computeTabCompleteness(tabDef, () => fullRecord).complete).toBe(true)
    expect(computeTabCompleteness(tabDef, () => ({})).complete).toBe(false)
  })
})

describe('calculatedFieldValue', () => {
  const ctx = { buildingName: 'Building B001', buildingCode: 'B001', floorName: 'Ground floor (EG)', roomCode: 'TR-EG-01' }

  it('resolves known calculated keys from context', () => {
    expect(calculatedFieldValue('building_name', ctx)).toBe('Building B001')
    expect(calculatedFieldValue('building_number', ctx)).toBe('B001')
    expect(calculatedFieldValue('floor_number', ctx)).toBe('Ground floor (EG)')
    expect(calculatedFieldValue('room_name_number', ctx)).toBe('TR-EG-01')
    expect(calculatedFieldValue('comms_room_number', ctx)).toBe('TR-EG-01')
  })

  it('returns undefined (not null) for a key that is not a recognised calculated field', () => {
    expect(calculatedFieldValue('wan_cpe_buillding_name', ctx)).toBeUndefined()
  })

  it('does not resolve rack identity — a room can hold several racks, so that is ambiguous here', () => {
    expect(calculatedFieldValue('rack_number', ctx)).toBeUndefined()
    expect(calculatedFieldValue('rack_name_number', ctx)).toBeUndefined()
  })
})

describe('rackInstanceCalculatedValue', () => {
  it('resolves rack_name and sequence_no from a specific rack instance context', () => {
    const rackCtx = { rackCode: 'R01', rackPosition: 2 }
    expect(rackInstanceCalculatedValue('rack_name', rackCtx)).toBe('R01')
    expect(rackInstanceCalculatedValue('sequence_no', rackCtx)).toBe('2')
  })

  it('returns undefined for any other key', () => {
    expect(rackInstanceCalculatedValue('rack_purpose', { rackCode: 'R01' })).toBeUndefined()
  })
})
