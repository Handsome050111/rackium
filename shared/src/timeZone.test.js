import { describe, it, expect } from 'vitest'
import { isValidTimeZone, localDate, localTime, startOfLocalDay, addDays, dateString, offsetMs, zonedInstant, weekdayOf, nextWeekly, DEFAULT_TIME_ZONE, DEFAULT_DIGEST_TIME } from './timeZone.js'

describe('organisation time zone helpers', () => {
  it('IANA names only; Europe/Berlin and 07:00 by default', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Europe/Berlin')
    expect(DEFAULT_DIGEST_TIME).toBe('07:00')
    for (const tz of ['Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'UTC']) expect(isValidTimeZone(tz)).toBe(true)
    for (const tz of ['Mars/Base', '', 'GMT+25', null]) expect(isValidTimeZone(tz)).toBe(false)
  })

  it('local date and time of an instant, either side of midnight', () => {
    expect(localDate('2026-10-13T21:59:00Z', 'Europe/Berlin')).toBe('2026-10-13')
    expect(localDate('2026-10-13T22:00:00Z', 'Europe/Berlin')).toBe('2026-10-14')
    expect(localTime('2026-10-13T22:00:00Z', 'Europe/Berlin')).toBe('00:00')
    expect(localDate('2026-10-14T03:30:00Z', 'America/New_York')).toBe('2026-10-13')
    expect(localTime('2026-10-14T03:30:00Z', 'Asia/Kolkata')).toBe('09:00')
  })

  it('the instant a local day starts — summer, winter and both DST changes in Berlin', () => {
    expect(startOfLocalDay('2026-07-01', 'Europe/Berlin').toISOString()).toBe('2026-06-30T22:00:00.000Z')
    expect(startOfLocalDay('2026-12-01', 'Europe/Berlin').toISOString()).toBe('2026-11-30T23:00:00.000Z')
    // Clocks go forward on 2026-03-29 (a 23-hour day), back on 2026-10-25 (25 hours).
    expect(startOfLocalDay('2026-03-29', 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(startOfLocalDay('2026-03-30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T22:00:00.000Z')
    expect(startOfLocalDay('2026-10-25', 'Europe/Berlin').toISOString()).toBe('2026-10-24T22:00:00.000Z')
    expect(startOfLocalDay('2026-10-26', 'Europe/Berlin').toISOString()).toBe('2026-10-25T23:00:00.000Z')
    expect(startOfLocalDay('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(startOfLocalDay('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z')
    expect(startOfLocalDay('2026-10-14', 'Asia/Kolkata').toISOString()).toBe('2026-10-13T18:30:00.000Z')
    expect(offsetMs('2026-07-01T12:00:00Z', 'Europe/Berlin')).toBe(2 * 3600000)
  })

  it('calendar arithmetic on dates (stored deadlines are UTC midnights)', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(dateString(new Date('2026-10-13T00:00:00Z'))).toBe('2026-10-13')
  })
  it('a local clock time on a date, and the next weekly send (M7a-2), across DST', () => {
    expect(zonedInstant('2026-10-25', '07:00', 'Europe/Berlin').toISOString()).toBe('2026-10-25T06:00:00.000Z') // CET, after the change
    expect(zonedInstant('2026-10-24', '07:00', 'Europe/Berlin').toISOString()).toBe('2026-10-24T05:00:00.000Z') // CEST
    expect(zonedInstant('2027-03-29', '07:00', 'Europe/Berlin').toISOString()).toBe('2027-03-29T05:00:00.000Z')
    expect(zonedInstant('2026-11-02', '07:00', 'America/New_York').toISOString()).toBe('2026-11-02T12:00:00.000Z')
    expect(weekdayOf('2026-10-26')).toBe(1)
    const berlin = (iso) => nextWeekly(new Date(iso), { tz: 'Europe/Berlin', time: '07:00' })
    expect(berlin('2026-10-25T12:00:00Z')).toEqual({ date: '2026-10-26', at: new Date('2026-10-26T06:00:00Z') }) // Sunday, DST day
    expect(berlin('2026-10-26T05:59:00Z').date).toBe('2026-10-26') // Monday 06:59: this morning
    expect(berlin('2026-10-26T06:00:00Z').date).toBe('2026-11-02') // Monday 07:00: next week
    expect(berlin('2027-03-27T12:00:00Z').at).toEqual(new Date('2027-03-29T05:00:00Z'))
    expect(nextWeekly(new Date('2026-10-31T12:00:00Z'), { tz: 'America/New_York', time: '09:30' }).at).toEqual(new Date('2026-11-02T14:30:00Z'))
  })
})
