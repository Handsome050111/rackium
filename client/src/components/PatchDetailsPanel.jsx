import { Link2 } from 'lucide-react'

const MEDIA_OPTIONS = [
  { value: 'cat6a', label: 'Cat6A' },
  { value: 'os2', label: 'OS2 single-mode' },
  { value: 'om4', label: 'OM4 multimode' },
  { value: 'dac', label: 'DAC' },
  { value: 'stack', label: 'Stack cable' },
]

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'designed', label: 'Designed' },
]

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-secondary'

export default function PatchDetailsPanel({
  connectionTypeLabel,
  media,
  onMediaChange,
  cableId,
  onCableIdChange,
  cableIdState, // 'checking' | 'unique' | 'duplicate' | 'invalid'
  status,
  onStatusChange,
  disabled,
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Link2 size={16} strokeWidth={2} className="text-brand" />
        Patch Details
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Connection">
          <div className={`${inputClass} flex items-center text-text-secondary`}>{connectionTypeLabel}</div>
        </Field>

        <Field label="Cable type">
          <select value={media} onChange={(e) => onMediaChange(e.target.value)} disabled={disabled} className={inputClass}>
            {MEDIA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Cable ID">
          <input
            type="text"
            value={cableId}
            onChange={(e) => onCableIdChange(e.target.value)}
            maxLength={32}
            disabled={disabled}
            className={`${inputClass} ${cableIdState === 'duplicate' || cableIdState === 'invalid' ? 'border-status-red' : ''}`}
          />
          {cableIdState === 'duplicate' && (
            <span className="text-xs text-status-red">Already used by another connection</span>
          )}
          {cableIdState === 'invalid' && <span className="text-xs text-status-red">Enter 1-32 characters</span>}
        </Field>

        <Field label="Status">
          <select value={status} onChange={(e) => onStatusChange(e.target.value)} disabled={disabled} className={inputClass}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}
