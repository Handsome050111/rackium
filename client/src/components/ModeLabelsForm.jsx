import { useState } from 'react'
import { MODE_STATES, MODE_LABEL_MAX } from '@rackium/shared/modeState.js'

const MEANING = { current: 'What exists today', interim: 'Temporary, during the migration', future: 'The target design' }
const inputClass = 'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none disabled:bg-surface-muted'

// The state labels (M7b-4a, DATA-MODEL §5.21): the client's words for
// Rackium's current / interim / future. `own`: the overrides here (null =
// inherited); `inherited`: what an empty box falls back to. Saves only the
// boxes that changed; an emptied box goes back to the inherited word.
export default function ModeLabelsForm({ title, own, inherited, canEdit, onSave }) {
  const [values, setValues] = useState(() => Object.fromEntries(MODE_STATES.map((s) => [s, own?.[s] ?? ''])))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const changed = MODE_STATES.filter((s) => values[s].trim() !== (own?.[s] ?? ''))

  async function save() {
    setBusy(true)
    setMessage(null)
    try {
      await onSave(Object.fromEntries(changed.map((s) => [s, values[s].trim() || null])))
      setMessage({ ok: true, text: 'Saved.' })
    } catch (err) {
      setMessage({ ok: false, text: err.message })
    }
    setBusy(false)
  }

  return (
    <section data-testid="mode-labels" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        <p className="text-xs text-text-secondary">What the screens, documents and exports call the three states. Leave a box empty to use the word shown in it.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MODE_STATES.map((s) => (
          <label key={s} className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">{MEANING[s]}</span>
            <input className={inputClass} value={values[s]} maxLength={MODE_LABEL_MAX} placeholder={inherited[s]} disabled={!canEdit} aria-label={`Label: ${MEANING[s].toLowerCase()}`} onChange={(e) => setValues((v) => ({ ...v, [s]: e.target.value }))} />
          </label>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy || !changed.length} onClick={save} className="h-9 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey">
            Save labels
          </button>
          {message && (
            <span role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-status-green' : 'text-status-red'}`}>
              {message.text}
            </span>
          )}
        </div>
      )}
    </section>
  )
}
