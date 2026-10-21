import { describe, it, expect } from 'vitest'
import { SURVEY_HELP_FIELDS, surveyHelpKey, platformHelp, plainText, mergedHelp, isHelpKey, HELP_KEY_PATTERN } from './fieldHelp.js'

describe('Field help (M7a-2)', () => {
  it('every survey field has a key; the ones with a hint have a placeholder default', () => {
    expect(SURVEY_HELP_FIELDS.length).toBeGreaterThan(200)
    expect(SURVEY_HELP_FIELDS.every((f) => HELP_KEY_PATTERN.test(f.key))).toBe(true)
    const withHint = SURVEY_HELP_FIELDS.filter((f) => f.hint)
    expect(withHint.length).toBeGreaterThan(20)
    const f = withHint[0]
    expect(platformHelp(f.key)).toEqual({ meaning: f.hint, lookFor: null, example: null, mistakes: null, placeholder: true })
    const none = SURVEY_HELP_FIELDS.find((x) => !x.hint)
    expect(platformHelp(none.key)).toBeNull()
    expect(surveyHelpKey('Comms Rooms Summary', 'rack_number')).toBe('survey:comms-rooms-summary:rack_number')
    expect(isHelpKey(f.key)).toBe(true)
    expect(isHelpKey('survey:nope:nope')).toBe(false)
  })

  it('text is plain: control characters removed, newlines kept, markup kept as typed, capped', () => {
    expect(plainText('  Line 1\r\nLine 2\u0007  ')).toBe('Line 1\nLine 2')
    expect(plainText('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
    expect(plainText('   ')).toBeNull()
    expect(plainText(null)).toBeNull()
    expect(plainText('x'.repeat(1200))).toHaveLength(1000)
  })

  it("the organisation's parts replace the default's; the placeholder mark goes with them", () => {
    const f = SURVEY_HELP_FIELDS.find((x) => x.hint)
    expect(mergedHelp(f.key)).toMatchObject({ meaning: f.hint, placeholder: true, overridden: false, photos: [] })
    expect(mergedHelp(f.key, { example: 'SW-ERL-01' })).toMatchObject({ meaning: f.hint, example: 'SW-ERL-01', placeholder: false, overridden: true })
    const none = SURVEY_HELP_FIELDS.find((x) => !x.hint)
    expect(mergedHelp(none.key)).toBeNull()
    expect(mergedHelp(none.key, { photos: [{ id: 'p1' }] })).toMatchObject({ meaning: null, photos: [{ id: 'p1' }], placeholder: false, overridden: true })
  })
})
