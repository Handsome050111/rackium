import { IdCard, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { matchSerial, CMO_STATUS_LABEL } from '../lib/cmoValidation.js'

const STATUS_ICON = { validated: CheckCircle2, 'not-in-cmo': AlertTriangle, duplicate: XCircle }
const STATUS_COLOR = { validated: 'text-status-green', 'not-in-cmo': 'text-status-amber', duplicate: 'text-status-red' }

export default function DeviceIdentityPanel({ placement, serial, onSerialChange, roomCmoList, allProjectSerials, disabled }) {
  const status = matchSerial(serial, roomCmoList, allProjectSerials, placement.id)
  const Icon = status ? STATUS_ICON[status] : null

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <IdCard size={16} strokeWidth={2} className="text-brand" />
        Device identity — {placement.label}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-secondary">Pick from room CMO, or type serial / MAC</span>
        <input
          type="text"
          list="cmo-suggestions"
          value={serial}
          onChange={(e) => onSerialChange(e.target.value)}
          disabled={disabled}
          placeholder="e.g. FCW2637A1B2"
          className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-muted"
        />
        <datalist id="cmo-suggestions">
          {roomCmoList.map((entry) => (
            <option key={entry.serial} value={entry.serial} />
          ))}
        </datalist>
      </label>

      {status && (
        <div className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${STATUS_COLOR[status]}`}>
          <Icon size={16} strokeWidth={2} />
          {CMO_STATUS_LABEL[status]}
        </div>
      )}
    </div>
  )
}
