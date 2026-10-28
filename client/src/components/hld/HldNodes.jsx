import { Handle, Position } from '@xyflow/react'
import { Clock, CheckCircle2, BadgeCheck } from 'lucide-react'
import TopologyIcon from '../TopologyIcon.jsx'

// Deployment (Step 8) overlays a Pending/Installed/Ready badge on top of
// the same device node HLD/LLD already render — data.deploymentLabel is
// only ever set by the Deployment canvas, so this is a no-op everywhere
// else.
const DEPLOYMENT_ICON = { Pending: Clock, Installed: CheckCircle2, Ready: BadgeCheck }
const DEPLOYMENT_COLOR = { Pending: 'text-status-amber', Installed: 'text-brand', Ready: 'text-status-green' }

// A network device — the only node type with connection handles, since
// uplinks only ever run between devices (never touch a room/floor band).
export function DeviceNode({ data, selected }) {
  const DeploymentIcon = DEPLOYMENT_ICON[data.deploymentLabel]
  // Mode states (M7b-4a): an overlaid state is a ghost; CMO gear and interim kit carry a badge.
  return (
    <div
      onClick={() => data.onSelect?.(data.deviceId)}
      data-ghost={data.ghost ? 'true' : undefined}
      data-mode-badge={data.modeBadge ?? undefined}
      className={`relative flex w-40 cursor-pointer items-center gap-2 rounded-lg border bg-surface px-2 py-1.5 shadow-sm ${
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-brand/60'
      } ${data.ghost ? 'border-dashed opacity-50' : ''}`}
    >
      {data.modeBadge && (
        <span className="absolute -top-2 left-2 rounded border border-border bg-surface px-1 text-[9px] font-semibold leading-[13px] text-text-secondary">{data.modeBadge}</span>
      )}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-brand" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-brand" />
      <TopologyIcon role={data.role} size={16} className="text-brand" />
      <div className="min-w-0 flex-1">
        {/* The whole name, wrapped — never cut (M7b-3); the layout sizes the node for it. */}
        <div className="break-all text-[11px] font-semibold leading-[14px] text-text">{data.label}</div>
        {data.sublabel && <div className="break-all text-[10px] leading-[13px] text-text-secondary">{data.sublabel}</div>}
      </div>
      {DeploymentIcon && (
        <DeploymentIcon size={14} strokeWidth={2} className={`absolute -right-1.5 -top-1.5 rounded-full bg-surface ${DEPLOYMENT_COLOR[data.deploymentLabel]}`} title={data.deploymentLabel} />
      )}
    </div>
  )
}

// Dashed room container — a React Flow parent/group node; devices nest
// inside via node.parentId + extent:'parent'.
export function RoomNode({ data }) {
  return (
    <div className="h-full w-full rounded-lg border border-dashed border-brand/50 bg-brand/[0.03]">
      <div className="px-2 py-1 text-[11px] font-semibold text-text">{data.label}</div>
    </div>
  )
}

// A non-interactive background band per floor — never selectable/draggable,
// always behind rooms/devices.
export function FloorBandNode({ data }) {
  return (
    <div className="flex h-full items-start border-t border-border/70 pt-1 pl-1 text-xs font-semibold text-text-secondary">
      {data.label}
    </div>
  )
}

export const HLD_NODE_TYPES = {
  device: DeviceNode,
  room: RoomNode,
  floorBand: FloorBandNode,
}
