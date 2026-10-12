import { useState } from 'react'
import { ROWS, get, tableFromTexts } from '../lib/stockLengths.js'

// Organisation setting `stockLengths`: Suggested cable lengths round up to
// these (LLD); nothing long enough means a custom length (VAL-012).
export default function StockLengthsSection({ settings, onSave }) {
  const textsOf = (table) => Object.fromEntries(ROWS.map((r) => [r.key, get(table, r.key).join(', ')]))
  const [texts, setTexts] = useState(() => textsOf(settings.stockLengths))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  async function save(table) {
    setSaving(true)
    setError(null)
    try {
      await onSave(table)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" data-testid="stock-lengths">
      {ROWS.map((r) => (
        <label key={r.key} className="grid grid-cols-1 items-center gap-1 text-xs sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-3">
          <span className="text-text-secondary">{r.label} (m)</span>
          <input
            aria-label={`${r.label} stock lengths`}
            value={texts[r.key]}
            onChange={(e) => setTexts((t) => ({ ...t, [r.key]: e.target.value }))}
            className="h-9 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none"
          />
        </label>
      ))}
      {error && <p className="text-xs text-status-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            const { table, error: problem } = tableFromTexts(texts)
            if (problem) setError(problem)
            else save(table)
          }}
          className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey"
        >
          Save stock lengths
        </button>
        {settings.defaultStockLengths && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setTexts(textsOf(settings.defaultStockLengths))
              save(settings.defaultStockLengths)
            }}
            className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
          >
            Reset to the brief’s table
          </button>
        )}
      </div>
    </div>
  )
}
