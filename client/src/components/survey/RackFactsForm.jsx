import { useState } from 'react'
import { Ruler, Zap, Cable, Accessibility } from 'lucide-react'
import { factPatch } from '../../lib/realSurveyModel.js'

// The facts the readiness summary is calculated from (brief §5.2 item 4),
// captured per rack. Each field saves when it loses focus.
const SIDE = [
  { value: 'accessible', label: 'Accessible' },
  { value: 'not_accessible', label: 'Not accessible' },
]

const GROUPS = [
  {
    key: 'details',
    title: 'Rack details',
    icon: Ruler,
    fields: [
      { key: 'type', label: 'Type' },
      { key: 'standard', label: 'Standard' },
      { key: 'externalDepthMm', label: 'External depth (mm)', number: true },
      { key: 'usableDepthMm', label: 'Usable depth (mm)', number: true },
      { key: 'condition', label: 'Condition' },
    ],
  },
  {
    key: 'mountingPower',
    title: 'Mounting & power',
    icon: Zap,
    fields: [
      { key: 'cageNutType', label: 'Cage nuts / screws' },
      { key: 'availableCageNutSets', label: 'Available sets', number: true },
      { key: 'mountingRails', label: 'Mounting rails' },
      { key: 'pduA.totalSockets', label: 'PDU-A sockets', number: true },
      { key: 'pduA.freeSockets', label: 'PDU-A free', number: true },
      { key: 'pduB.totalSockets', label: 'PDU-B sockets', number: true },
      { key: 'pduB.freeSockets', label: 'PDU-B free', number: true },
    ],
  },
  {
    key: 'cablePath',
    title: 'Cable path & management',
    icon: Cable,
    fields: [
      { key: 'mainCableEntry', label: 'Main cable entry' },
      { key: 'pathway', label: 'Pathway' },
      { key: 'secondaryEntry', label: 'Secondary entry' },
      { key: 'verticalManagers', label: 'Vertical managers', number: true },
      { key: 'horizontalManagers', label: 'Horizontal managers', number: true },
    ],
  },
  {
    key: 'accessibility',
    title: 'Accessibility',
    icon: Accessibility,
    fields: [
      { key: 'front', label: 'Front', options: SIDE },
      { key: 'rear', label: 'Rear', options: SIDE },
      { key: 'left', label: 'Left side', options: SIDE },
      { key: 'right', label: 'Right side', options: SIDE },
      { key: 'frontClearanceMm', label: 'Front clearance (mm)', number: true },
      { key: 'rearClearanceMm', label: 'Rear clearance (mm)', number: true },
    ],
  },
]

const read = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

function Field({ label, value, number, options, disabled, onCommit }) {
  const [draft, setDraft] = useState(null)
  const shown = draft ?? (value ?? '')
  if (options) {
    return (
      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-text-secondary">{label}</span>
        <select value={value ?? ''} disabled={disabled} aria-label={label} onChange={(e) => onCommit(e.target.value)} className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-text focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted">
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  }
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-secondary">{label}</span>
      <input
        type={number ? 'number' : 'text'}
        min={number ? 0 : undefined}
        value={shown}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && String(draft) !== String(value ?? '')) onCommit(draft)
          setDraft(null)
        }}
        className="h-8 w-32 rounded-lg border border-border bg-surface px-2 text-right text-xs font-medium text-text focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted"
      />
    </label>
  )
}

export default function RackFactsForm({ meta, editable, onSave }) {
  return GROUPS.map((group) => (
    <div key={group.key} className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
        <group.icon size={16} strokeWidth={2} className="text-brand" />
        {group.title}
      </div>
      <div className="space-y-1.5">
        {group.fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            number={f.number}
            options={f.options}
            value={read(meta[group.key], f.key)}
            disabled={!editable}
            onCommit={(raw) => {
              const body = factPatch(meta, group.key, f.key, raw, f.number)
              if (body) onSave(body)
            }}
          />
        ))}
      </div>
    </div>
  ))
}
