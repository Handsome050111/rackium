import { useState } from 'react'

const FIELDS = [
  { key: 'intervalMonths', label: 'Inspection interval (months)', min: 1, max: 120 },
  { key: 'expiringSoonDays', label: '"Expiring soon" from (days)', min: 1, max: 365 },
  { key: 'expiringDays', label: '"Expiring" from (days)', min: 1, max: 365 },
]

// Organisation setting `dguv` (M6a, brief §6.9): the DGUV V3 inspection
// interval and the two warning windows the deployment and CMDB statuses use.
export default function DguvSection({ settings, onSave }) {
  const [values, setValues] = useState(() => ({ ...settings.dguv }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(next) {
    const bad = FIELDS.find((f) => !Number.isInteger(Number(next[f.key])) || Number(next[f.key]) < f.min || Number(next[f.key]) > f.max)
    if (bad) return setError(`${bad.label}: a whole number from ${bad.min} to ${bad.max}`)
    if (Number(next.expiringDays) > Number(next.expiringSoonDays)) return setError('"Expiring" must be at most "Expiring soon"')
    setSaving(true)
    setError(null)
    try {
      await onSave(Object.fromEntries(FIELDS.map((f) => [f.key, Number(next[f.key])])))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="dguv-settings">
      <div className="flex flex-wrap gap-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">{f.label}</span>
            <input
              aria-label={f.label}
              type="number"
              min={f.min}
              max={f.max}
              step="1"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="h-9 w-28 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none"
            />
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-status-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={saving} onClick={() => save(values)} className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
          Save DGUV intervals
        </button>
        {settings.defaultDguv && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setValues({ ...settings.defaultDguv })
              save(settings.defaultDguv)
            }}
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
          >
            Reset to default ({settings.defaultDguv.intervalMonths} months / {settings.defaultDguv.expiringSoonDays} / {settings.defaultDguv.expiringDays} days)
          </button>
        )}
      </div>
    </div>
  )
}
