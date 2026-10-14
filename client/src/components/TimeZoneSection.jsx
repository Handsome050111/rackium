import { useMemo, useState } from 'react'

const inputClass = 'h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'

// Organisation setting (M5b review): the time zone task deadlines, due soon /
// overdue and the daily digest use, and the digest's local send time.
export default function TimeZoneSection({ settings, onSave }) {
  const [timeZone, setTimeZone] = useState(settings.timeZone)
  const [digestTime, setDigestTime] = useState(settings.digestTime)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
    return list.includes(settings.timeZone) ? list : [settings.timeZone, ...list]
  }, [settings.timeZone])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave({ timeZone, digestTime })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="time-zone">
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Time zone</span>
          <select aria-label="Organisation time zone" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={inputClass}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Daily digest at (local)</span>
          <input aria-label="Daily digest time" type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} className={inputClass} />
        </label>
      </div>
      {error && <p className="text-xs text-status-red">{error}</p>}
      <button type="button" disabled={saving} onClick={save} className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
        Save time zone
      </button>
    </div>
  )
}
