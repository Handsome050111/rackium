import { useState } from 'react'
import { X, Wand2 } from 'lucide-react'

const inputClass = 'h-8 w-full min-w-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none'

// Hostname rename (Architect/PM; DATA-MODEL §7): type new names or
// regenerate them from the organisation's naming codes, preview every
// change (with clashes), then apply in one step. The server refuses it once
// the LLD is approved — that needs a change request (M5).
export default function LldRenameDialog({ devices, onPreview, onApply, onClose }) {
  const named = devices.filter((d) => d.inDesign && d.hostname)
  const [names, setNames] = useState(() => Object.fromEntries(named.map((d) => [d.id, d.hostname])))
  const [preview, setPreview] = useState(null)
  const [regenerate, setRegenerate] = useState(false)
  const renames = named.filter((d) => names[d.id]?.trim() && names[d.id].trim() !== d.hostname).map((d) => ({ deviceId: d.id, hostname: names[d.id].trim() }))
  const request = regenerate ? { regenerate: true } : { renames }
  const changing = preview?.rows.filter((r) => r.from !== r.to) ?? []
  const problems = preview?.rows.filter((r) => r.problem) ?? []

  async function runPreview(body) {
    setPreview(await onPreview(body))
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Rename hostnames" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-surface p-4 shadow-xl sm:rounded-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-text">Rename hostnames</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="space-y-2">
          {named.map((d) => (
            <label key={d.id} className="grid grid-cols-1 items-center gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-2">
              <span className="truncate text-text-secondary">{d.hostname}</span>
              <input
                aria-label={`New hostname for ${d.hostname}`}
                value={names[d.id] ?? ''}
                onChange={(e) => {
                  setNames((n) => ({ ...n, [d.id]: e.target.value }))
                  setRegenerate(false)
                  setPreview(null)
                }}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setRegenerate(true)
              runPreview({ regenerate: true })
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
          >
            <Wand2 size={13} strokeWidth={2} />
            Regenerate from naming codes
          </button>
          <button type="button" disabled={!regenerate && renames.length === 0} onClick={() => runPreview(request)} className="h-9 rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5 disabled:border-border disabled:text-text-secondary">
            Preview
          </button>
        </div>
        {preview && (
          <div className="mt-3 space-y-2" data-testid="rename-preview">
            {changing.length === 0 ? (
              <p className="text-xs text-text-secondary">Nothing would change.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {preview.rows.map((r) => (
                  <li key={r.deviceId} className={r.problem ? 'text-status-red' : 'text-text'}>
                    {r.from ?? '—'} → <span className="font-medium">{r.to}</span>
                    {r.problem && ` — ${r.problem}`}
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={changing.length === 0 || problems.length > 0}
              onClick={() => onApply(request)}
              className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:bg-status-grey"
            >
              Apply {changing.length} rename{changing.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
