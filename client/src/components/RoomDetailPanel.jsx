import { DoorOpen } from 'lucide-react'
import EvidenceSlots from './EvidenceSlots.jsx'

const ACCESS_OPTIONS = [
  { value: 'verified', label: 'Verified' },
  { value: 'not-verified', label: 'Not verified' },
]
const POWER_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'not-available', label: 'Not available' },
  { value: 'unknown', label: 'Unknown' },
]
const ENVIRONMENT_OPTIONS = [
  { value: 'verified', label: 'Verified' },
  { value: 'to-verify', label: 'To verify' },
  { value: 'issue', label: 'Issue' },
  { value: 'unknown', label: 'Unknown' },
]

const STATUS_COLOR = {
  verified: 'text-status-green',
  available: 'text-status-green',
  'to-verify': 'text-status-amber',
  unknown: 'text-status-amber',
  'not-verified': 'text-status-red',
  'not-available': 'text-status-red',
  issue: 'text-status-red',
}

function StatusSelect({ label, value, options, onChange, disabled }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`h-8 rounded-lg border border-border bg-surface px-2 text-xs font-medium focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted ${STATUS_COLOR[value] ?? 'text-text'}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function RoomDetailPanel({ room, floor, meta, onMetaChange, disabled }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <DoorOpen size={16} strokeWidth={2} className="text-brand" />
        {room.code}
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Room ID</dt>
          <dd className="font-medium text-text">{room.code}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Floor</dt>
          <dd className="font-medium text-text">{floor.token}</dd>
        </div>
      </dl>

      <div className="space-y-2 border-t border-border pt-3">
        <StatusSelect
          label="Access"
          value={meta.access}
          options={ACCESS_OPTIONS}
          onChange={(v) => onMetaChange({ access: v })}
          disabled={disabled}
        />
        <StatusSelect
          label="Power"
          value={meta.power}
          options={POWER_OPTIONS}
          onChange={(v) => onMetaChange({ power: v })}
          disabled={disabled}
        />
        <StatusSelect
          label="Environment"
          value={meta.environment}
          options={ENVIRONMENT_OPTIONS}
          onChange={(v) => onMetaChange({ environment: v })}
          disabled={disabled}
        />
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-xs font-medium text-text-secondary">Photos ({meta.photoCount} attached)</div>
        <EvidenceSlots labels={['Room', 'Rack area']} disabled={disabled} />
      </div>
    </div>
  )
}
