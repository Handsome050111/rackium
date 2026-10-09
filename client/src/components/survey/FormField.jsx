import { useState } from 'react'
import { Camera, Upload, CheckCircle2, AlertTriangle, ExternalLink, Lock } from 'lucide-react'
import RequirementBadge from './RequirementBadge.jsx'
import { parseHintOptions, fieldFormatError } from '../../lib/surveyFormModel.js'
import { useSurveyMedia } from './SurveyMediaContext.js'
import { PhotoField, FileField } from './PhotoField.jsx'

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-xs text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-secondary'

const SERIAL_STATUS_STYLE = {
  validated: { label: 'Validated against CMO', className: 'text-status-green' },
  'not-in-cmo': { label: 'Not found in CMO — recorded anyway', className: 'text-status-amber' },
  duplicate: { label: 'Already recorded against another device', className: 'text-status-red' },
}

// One universal field renderer for all 18 tabs' field types. `calculatedValue`
// (when not undefined) means this field is auto-filled from real
// site-structure/rack-survey data — shown read-only regardless of
// `editable`, never a value the user re-types (brief: "Auto-fill from
// existing data where obvious... show such fields as calculated/read-only").
export default function FormField({ field, value, confirmed, onChange, onConfirm, editable, calculatedValue, onValidateSerial, linkTo, compact }) {
  const [serialStatus, setSerialStatus] = useState(null)
  const [checking, setChecking] = useState(false)
  const media = useSurveyMedia()
  // Set by real mode on fields the caller's role may not fill (e.g. an
  // Architect sees non-prefill fields); the server refuses them anyway.
  if (field.readOnlyForRole) editable = false

  if (calculatedValue !== undefined) {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact}>
        <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface-muted px-2.5 text-xs text-text-secondary">
          <Lock size={11} strokeWidth={2} className="shrink-0" />
          <span className="truncate text-text">{calculatedValue || '—'}</span>
        </div>
      </Field>
    )
  }

  if (field.type === 'rack_elevation') {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact}>
        <a
          href={linkTo}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-brand text-xs font-medium text-brand hover:bg-brand/5"
        >
          Open in Rackium Editor
          <ExternalLink size={12} strokeWidth={2} />
        </a>
      </Field>
    )
  }

  if (field.type === 'yes_no') {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact}>
        <div className="flex gap-1.5">
          {['Yes', 'No'].map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={!editable}
              onClick={() => onChange(opt)}
              className={`h-9 flex-1 rounded-lg border text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                value === opt ? 'border-brand bg-brand text-white' : 'border-border text-text hover:border-brand/40'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </Field>
    )
  }

  // Real mode: real photos and files (a div, not a label — the controls hold buttons).
  if (media && (field.type === 'photo' || field.type === 'photo_multi')) {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact} asDiv>
        <PhotoField label={field.label} value={value} editable={editable} multi={field.type === 'photo_multi'} onChange={onChange} />
      </Field>
    )
  }
  if (media && field.type === 'file') {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact} asDiv>
        <FileField label={field.label} value={value} editable={editable} onChange={onChange} />
      </Field>
    )
  }

  if (field.type === 'photo' || field.type === 'photo_multi') {
    const count = value?.count ?? 0
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact}>
        <button
          type="button"
          disabled={!editable}
          onClick={() => onChange({ count: count + 1 })}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-text-secondary hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera size={13} strokeWidth={2} />
          {count > 0 ? `${count} photo${count === 1 ? '' : 's'} attached` : 'Add photo'}
        </button>
      </Field>
    )
  }

  if (field.type === 'file') {
    return (
      <Field label={field.label} requirement={field.requirement} compact={compact}>
        <label className="flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-medium text-text-secondary hover:border-brand/40">
          <input
            type="file"
            disabled={!editable}
            onChange={(e) => e.target.files?.[0] && onChange({ fileName: e.target.files[0].name })}
            className="hidden"
          />
          <Upload size={13} strokeWidth={2} />
          {value?.fileName ?? 'Upload file'}
        </label>
      </Field>
    )
  }

  const options = field.type !== 'yes_no' ? parseHintOptions(field.hint) : null

  if (options) {
    return (
      <Field label={field.label} requirement={field.requirement} hint={null} compact={compact}>
        <select value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__other__">Other</option>
        </select>
        {value === '__other__' && (
          <input
            autoFocus
            disabled={!editable}
            placeholder="Specify"
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} mt-1`}
          />
        )}
      </Field>
    )
  }

  if (field.type === 'serial') {
    const formatError = fieldFormatError(field, value)
    return (
      <Field label={field.label} requirement={field.requirement} hint={field.hint} compact={compact}>
        <div className="flex gap-1">
          <input value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value)} placeholder="Serial number" className={inputClass} />
          {onValidateSerial && (
            <button
              type="button"
              disabled={!editable || !value || checking}
              onClick={async () => {
                setChecking(true)
                const result = await onValidateSerial(value)
                setSerialStatus(result)
                setChecking(false)
              }}
              className="h-9 shrink-0 rounded-lg border border-border px-2 text-[11px] font-medium text-text hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              Check
            </button>
          )}
        </div>
        {serialStatus && (
          <p className={`mt-1 flex items-center gap-1 text-[11px] ${SERIAL_STATUS_STYLE[serialStatus]?.className}`}>
            {serialStatus === 'validated' ? <CheckCircle2 size={11} strokeWidth={2} /> : <AlertTriangle size={11} strokeWidth={2} />}
            {SERIAL_STATUS_STYLE[serialStatus]?.label}
          </p>
        )}
        {formatError && <p className="mt-1 text-[11px] text-status-red">{formatError}</p>}
      </Field>
    )
  }

  const type = field.type === 'number' || field.type === 'number_m' ? 'number' : field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'
  const formatError = fieldFormatError(field, value)
  const placeholder = field.type === 'number_m' ? 'metres' : field.type === 'gps' ? 'lat, lng' : field.hint && !options ? field.hint : undefined

  return (
    <Field label={field.label} requirement={field.requirement} hint={field.hint} compact={compact}>
      <div className="relative">
        <input type={type} value={value ?? ''} disabled={!editable} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
        {field.prefill === 'prefilled_validated' && (
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-text-secondary">
            <input type="checkbox" checked={Boolean(confirmed)} disabled={!editable || confirmed} onChange={() => onConfirm?.()} />
            Validated on site
          </label>
        )}
      </div>
      {formatError && <p className="mt-1 text-[11px] text-status-red">{formatError}</p>}
    </Field>
  )
}

function Field({ label, requirement, hint, compact, asDiv, children }) {
  if (compact) {
    // Used inside a table cell, where the column header already carries the
    // label/badge — just the control.
    return <div>{children}</div>
  }
  const Wrapper = asDiv ? 'div' : 'label'
  return (
    <Wrapper className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        {label}
        <RequirementBadge requirement={requirement} />
      </span>
      {children}
      {hint && !parseHintOptions(hint) && <p className="text-[10px] text-text-secondary">{hint}</p>}
    </Wrapper>
  )
}
