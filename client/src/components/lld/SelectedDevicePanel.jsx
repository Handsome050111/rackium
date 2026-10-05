import { FileText } from 'lucide-react'
import { DEPLOYMENT_PLACEHOLDER } from '@rackium/shared/lldModel.js'

// The render (page 16) shows "Link test: Passed" here — that is Deployment
// data, not LLD design data (brief Step 6 rule). Every installation-time
// field is DEPLOYMENT_PLACEHOLDER until the device is actually installed.
const INSTALL_FIELDS = ['Serial number', 'MAC address', 'Asset ID', 'DGUV validity', 'Latitude', 'Longitude', 'Altitude']

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  )
}

export default function SelectedDevicePanel({ device }) {
  if (!device) return null

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <FileText size={16} strokeWidth={2} className="text-brand" />
        Selected planned device
      </div>
      <div className="space-y-1.5">
        <Row label="Hostname" value={device.hostname} />
        <Row label="Planned model" value={device.model} />
        <Row label="Planned location" value={device.roomCode ?? '—'} />
        <Row label="Planned rack / RU" value={device.rackCode ? `${device.rackCode} / RU${device.ru ?? '—'}` : 'Not rack-placed yet'} />
        <Row label="Lifecycle status" value={device.status ?? 'planned'} />
      </div>

      <div className="border-t border-border pt-3">
        <div className="mb-2 text-xs font-semibold text-text-secondary">Installation details — pending</div>
        <div className="space-y-1.5">
          {INSTALL_FIELDS.map((label) => (
            <Row key={label} label={label} value={<span className="italic text-text-secondary">{DEPLOYMENT_PLACEHOLDER}</span>} />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-secondary">Populated after device allocation and installation.</p>
      </div>
    </div>
  )
}
