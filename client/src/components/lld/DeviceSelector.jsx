import { ShieldOff } from 'lucide-react'
import TopologyIcon from '../TopologyIcon.jsx'

// Border and Edge devices are the two selectable end-to-end connectivity
// views (brief Step 6 Tab 1). Distribution never appears as a selectable
// device for an "S" site — it is shown once, greyed, as a notice instead
// of inventing placeholder units that don't exist in the design.
export default function DeviceSelector({ devices, selectedId, onSelect, distributionRequired, siteSize }) {
  const borders = devices.filter((d) => d.role === 'border')
  const edges = devices.filter((d) => d.role === 'edge')

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-3">
      <div className="px-1 text-sm font-semibold text-text">Select a device</div>

      {borders.length > 0 && (
        <DeviceGroup label="Border" devices={borders} selectedId={selectedId} onSelect={onSelect} />
      )}
      {edges.length > 0 && <DeviceGroup label="Edge" devices={edges} selectedId={selectedId} onSelect={onSelect} />}

      {!distributionRequired && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-surface-muted px-2.5 py-2 text-xs text-text-secondary">
          <ShieldOff size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>
            Distribution layer not required — {siteSize ?? 'S'} site. Border uplinks directly to each Edge node.
          </span>
        </div>
      )}
    </div>
  )
}

function DeviceGroup({ label, devices, selectedId, onSelect }) {
  return (
    <div>
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="space-y-1">
        {devices.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs ${
              selectedId === d.id ? 'border-brand bg-brand/5 text-brand' : 'border-border text-text hover:border-brand/40'
            }`}
          >
            <TopologyIcon role={d.role} size={14} />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{d.label}</span>
              <span className="block truncate text-[10px] text-text-secondary">{d.hostname}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
