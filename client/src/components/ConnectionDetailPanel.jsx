import { Link2 } from 'lucide-react'
import EvidenceSlots from './EvidenceSlots.jsx'

const ROUTE_STATUS_OPTIONS = [
  { value: 'surveyed', label: 'Surveyed' },
  { value: 'estimated', label: 'Estimated' },
]

// `evidence` and `actions`: real-mode photo control and extra buttons; mock mode keeps the local slots.
export default function ConnectionDetailPanel({ connection, onChange, disabled, evidence, actions }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Link2 size={16} strokeWidth={2} className="text-brand" />
        Building connection
      </div>

      <dl className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">From</dt>
          <dd className="font-medium text-text">{connection.fromRoomCode}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">To</dt>
          <dd className="font-medium text-text">{connection.toRoomCode}</dd>
        </div>
      </dl>

      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-text-secondary">Route status</span>
        <select
          value={connection.routeStatus}
          onChange={(e) => onChange({ routeStatus: e.target.value })}
          disabled={disabled}
          className={`h-8 rounded-lg border border-border bg-surface px-2 text-xs font-medium focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted ${
            connection.routeStatus === 'surveyed' ? 'text-status-green' : 'text-status-amber'
          }`}
        >
          {ROUTE_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3 text-xs">
        <span className="text-text-secondary">Distance</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min="0"
            value={connection.distanceM ?? ''}
            onChange={(e) => onChange({ distanceM: e.target.value === '' ? null : Number(e.target.value) })}
            disabled={disabled}
            placeholder="—"
            className="h-8 w-20 rounded-lg border border-border bg-surface px-2 text-right text-xs font-medium text-text focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted"
          />
          <span className="text-text-secondary">m</span>
        </span>
      </label>
      {connection.routeStatus === 'surveyed' && (
        <p className="text-[11px] text-text-secondary">
          Used as the surveyed pathway length for inter-room cable suggestions (v2.3 §6.3).
        </p>
      )}

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-xs font-medium text-text-secondary">Evidence</div>
        {evidence ?? <EvidenceSlots labels={['Route 1', 'Route 2']} disabled={disabled} />}
      </div>
      {actions}
    </div>
  )
}
