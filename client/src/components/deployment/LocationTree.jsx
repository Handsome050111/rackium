import { CheckCircle2, CircleDot, Clock3 } from 'lucide-react'

// Status icon and label per node, matching the deployment labels (brief §4.4).
const STATUS = {
  Ready: { Icon: CheckCircle2, className: 'text-status-green', label: 'Ready' },
  Installed: { Icon: CircleDot, className: 'text-status-amber', label: 'Installed' },
  Pending: { Icon: Clock3, className: 'text-text-secondary', label: 'Pending' },
}

function Counts({ counts }) {
  const parts = ['Ready', 'Installed', 'Pending'].filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${k.toLowerCase()}`)
  return <span className="shrink-0 text-[11px] text-text-secondary">{parts.join(' · ')}</span>
}

function Row({ node, selectedDeviceId, onSelectDevice }) {
  const { Icon, className, label } = STATUS[node.status]
  const isDevice = node.type === 'device'
  const isSelected = isDevice && node.id === selectedDeviceId
  const content = (
    <>
      <Icon size={16} strokeWidth={2} className={`shrink-0 ${className}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-text">{node.label}</span>
      {isDevice ? (
        <span className="shrink-0 text-[11px] text-text-secondary">
          {label}
          {node.awaitingDelivery ? ' · not delivered' : ''}
        </span>
      ) : (
        <Counts counts={node.counts} />
      )}
    </>
  )

  if (isDevice) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        aria-label={`${node.label}, ${label}`}
        onClick={() => onSelectDevice(node.id)}
        className={`flex min-h-touch w-full items-center gap-2 rounded-lg px-2 sm:min-h-8 ${
          isSelected ? 'bg-brand/10 text-brand' : 'hover:bg-surface-muted'
        }`}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex min-h-touch items-center gap-2 px-2 sm:min-h-8">
      {content}
    </div>
  )
}

function Branch({ node, depth, selectedDeviceId, onSelectDevice }) {
  return (
    <li>
      <Row node={node} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} />
      {node.children.length > 0 && (
        <ul className={depth === 0 ? 'space-y-1' : 'ml-4 space-y-1 border-l border-border pl-2'}>
          {node.children.map((child) => (
            <Branch key={`${child.type}-${child.id}`} node={child} depth={depth + 1} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} />
          ))}
        </ul>
      )}
    </li>
  )
}

// The device list is the phone's main view and the desktop side panel. Selecting
// a device here selects it on the topology canvas too (they share one state).
export default function LocationTree({ tree, selectedDeviceId, onSelectDevice }) {
  if (tree.total === 0) {
    return <p className="text-xs text-text-secondary">No devices to deploy in this building yet.</p>
  }
  return (
    <nav aria-label="Location tree">
      <ul className="space-y-1">
        <Branch node={tree} depth={0} selectedDeviceId={selectedDeviceId} onSelectDevice={onSelectDevice} />
      </ul>
    </nav>
  )
}
