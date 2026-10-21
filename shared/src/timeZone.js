// The organisation's time zone (M5b review): task deadlines, due soon /
// overdue and the daily digest's send time are in the organisation's local
// time, not UTC. IANA names; the default is Europe/Berlin. Pure, built on Intl,
// correct across daylight-saving changes.

export const DEFAULT_TIME_ZONE = 'Europe/Berlin'
export const DEFAULT_DIGEST_TIME = '07:00'

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(0)
    return true
  } catch {
    return false
  }
}

const formatters = new Map()
function partsOf(instant, tz) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    formatters.set(tz, f)
  }
  const out = {}
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

// The zone's offset from UTC at an instant, in ms (CEST: +7200000).
export function offsetMs(instant, tz) {
  const p = partsOf(instant, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(new Date(instant).getTime() / 1000) * 1000
}

const pad = (n) => String(n).padStart(2, '0')
// The local calendar date (YYYY-MM-DD) and time (HH:MM) of an instant.
export function localDate(instant, tz = DEFAULT_TIME_ZONE) {
  const p = partsOf(instant, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}
export function localTime(instant, tz = DEFAULT_TIME_ZONE) {
  const p = partsOf(instant, tz)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

// A date given as 'YYYY-MM-DD' or a Date at UTC midnight (how a deadline is stored).
export const dateString = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
export function addDays(dateStr, days) {
  const [y, m, d] = dateString(dateStr).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// The instant a local calendar date begins in the zone (local midnight). The
// offset is read twice, so a day that starts just after a DST change is right.
export function startOfLocalDay(dateStr, tz = DEFAULT_TIME_ZONE) {
  const [y, m, d] = dateString(dateStr).split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d)
  let instant = guess - offsetMs(guess, tz)
  instant = guess - offsetMs(instant, tz)
  return new Date(instant)
}

// The instant a local date reaches a local clock time 'HH:MM' (the same
// double read of the offset; a time inside a spring-forward gap lands an hour later).
export function zonedInstant(dateStr, hhmm, tz = DEFAULT_TIME_ZONE) {
  const [y, m, d] = dateString(dateStr).split('-').map(Number)
  const [h, mi] = String(hhmm).split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let instant = guess - offsetMs(guess, tz)
  instant = guess - offsetMs(instant, tz)
  return new Date(instant)
}

// The weekday of a calendar date: 0 Sunday … 6 Saturday.
export const weekdayOf = (dateStr) => new Date(`${dateString(dateStr)}T00:00:00Z`).getUTCDay()

// The next local weekly send (M7a-2 weekly DGUV digest): the coming `weekday`
// at `time` — today if it is that day and the time has not come yet.
export function nextWeekly(now, { tz = DEFAULT_TIME_ZONE, time = DEFAULT_DIGEST_TIME, weekday = 1 } = {}) {
  const today = localDate(now, tz)
  const ahead = (weekday - weekdayOf(today) + 7) % 7
  const day = ahead === 0 && localTime(now, tz) >= time ? addDays(today, 7) : addDays(today, ahead)
  return { date: day, at: zonedInstant(day, time, tz) }
}
