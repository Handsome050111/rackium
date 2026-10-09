import { Trash2 } from 'lucide-react'
import TopologyIcon from '../TopologyIcon.jsx'

// A selected planned device (real mode): hostname (generated once), catalogue
// model, configured PSUs (VAL-005) and delete. `models`: the role's catalogue models.
export default function HldDeviceDetails({ device, models, editable, onChange, onDelete, onCreateUplink }) {
  return (
    <div data-testid="hld-device" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <TopologyIcon role={device.role} size={16} className="text-brand" />
        <span className="truncate">{device.hostname ?? device.label}</span>
      </div>
      <dl className="space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Role</dt>
          <dd className="font-medium text-text">{device.roleLabel}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text-secondary">Hostname</dt>
          <dd className="truncate font-medium text-text">{device.hostname ?? 'none (not a named device)'}</dd>
        </div>
      </dl>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-text-secondary">Model</span>
        <select
          value={device.catalogueKey ?? ''}
          disabled={!editable}
          onChange={(e) => onChange({ catalogueKey: e.target.value })}
          className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted"
        >
          {!device.catalogueKey && <option value="">—</option>}
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.key}
              {m.placeholder ? ' (placeholder)' : ''}
            </option>
          ))}
        </select>
      </label>
      {device.psuConfigured != null && (
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-text-secondary">PSUs configured</span>
          <select
            value={device.psuConfigured}
            disabled={!editable}
            onChange={(e) => onChange({ psuConfigured: Number(e.target.value) })}
            aria-label="PSUs configured"
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:bg-surface-muted"
          >
            {[1, 2].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <button type="button" onClick={onCreateUplink} className="h-9 rounded-lg border border-brand px-3 text-xs font-medium text-brand hover:bg-brand/5">
            Create uplink from here
          </button>
          <button type="button" onClick={onDelete} className="flex h-9 items-center gap-1.5 rounded-lg border border-status-red/30 px-3 text-xs font-medium text-status-red hover:bg-status-red/5">
            <Trash2 size={13} strokeWidth={2} />
            Delete device
          </button>
        </div>
      )}
    </div>
  )
}
