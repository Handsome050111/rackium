import { useState } from 'react'
import { Plus } from 'lucide-react'

const TYPES = ['text', 'number', 'yes_no']

// brief: "Org Admin can add extra fields to a tab; they are stored and
// shown but never used in calculations. Core fields cannot be removed or
// renamed."
export default function CustomFieldForm({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-xs font-medium text-text-secondary hover:border-brand/40"
      >
        <Plus size={13} strokeWidth={2} />
        Add custom field (Org Admin)
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Field label"
        className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none"
      />
      <select value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none">
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (!label.trim()) return
            onAdd({ label, type })
            setLabel('')
            setOpen(false)
          }}
          className="h-9 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90"
        >
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand">
          Cancel
        </button>
      </div>
    </div>
  )
}
