// Relative-time formatting for history/sync timestamps.
// Mock data stores absolute ISO timestamps; MOCK_NOW anchors "now" for the
// prototype since there is no live clock behind the mock dataset.

export const MOCK_NOW = new Date('2026-09-30T10:00:00Z')

const UNITS = [
  { limit: 60, divisor: 1, unit: 'second' },
  { limit: 3600, divisor: 60, unit: 'minute' },
  { limit: 86400, divisor: 3600, unit: 'hour' },
  { limit: 2592000, divisor: 86400, unit: 'day' },
  { limit: Infinity, divisor: 2592000, unit: 'month' },
]

export function formatRelativeTime(isoString, now = MOCK_NOW) {
  const then = new Date(isoString)
  const diffSeconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000))

  if (diffSeconds < 5) return 'just now'

  const { divisor, unit } = UNITS.find((u) => diffSeconds < u.limit)
  const value = Math.max(1, Math.round(diffSeconds / divisor))
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
}

export function formatDateTime(isoString) {
  const date = new Date(isoString)
  const datePart = date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const timePart = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return `${datePart} · ${timePart}`
}
