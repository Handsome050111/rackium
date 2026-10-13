import { useState } from 'react'

const FACES = [
  { key: 'front', label: 'Front face' },
  { key: 'rear', label: 'Rear face' },
]

// Organisation setting `cageNutsPerRu` (M5a review): the BOM counts cage nuts
// per RU on each face a device is fixed to — its mounting face, or both faces
// for full-depth gear.
export default function CageNutsSection({ settings, onSave }) {
  const [values, setValues] = useState(() => ({ ...settings.cageNutsPerRu }))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(next) {
    const bad = FACES.find((f) => !Number.isInteger(Number(next[f.key])) || Number(next[f.key]) < 0 || Number(next[f.key]) > 20)
    if (bad) {
      setError(`${bad.label}: a whole number from 0 to 20`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({ front: Number(next.front), rear: Number(next.rear) })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="cage-nuts">
      <div className="flex flex-wrap gap-3">
        {FACES.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs">
            <span className="text-text-secondary">{f.label} (per RU)</span>
            <input
              aria-label={`Cage nuts per RU, ${f.label.toLowerCase()}`}
              type="number"
              min="0"
              max="20"
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
          Save cage nuts
        </button>
        {settings.defaultCageNutsPerRu && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setValues({ ...settings.defaultCageNutsPerRu })
              save(settings.defaultCageNutsPerRu)
            }}
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
          >
            Reset to default ({settings.defaultCageNutsPerRu.front} per RU)
          </button>
        )}
      </div>
    </div>
  )
}
