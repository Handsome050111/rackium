import { Handle, Position } from '@xyflow/react'
import { Server, Wifi, Cloud } from 'lucide-react'

const ROLE_ICON = { fusion: Server, border: Server, distribution: Server, edge: Server, ap: Wifi, 'wan-circuit': Cloud }

// A network device — the only node type with connection handles, since
// uplinks only ever run between devices (never touch a room/floor band).
export function DeviceNode({ data, selected }) {
  const Icon = ROLE_ICON[data.role] ?? Server
  return (
    <div
      onClick={() => data.onSelect?.(data.deviceId)}
      className={`flex w-40 cursor-pointer items-center gap-2 rounded-lg border bg-surface px-2 py-1.5 shadow-sm ${
        selected ? 'border-brand ring-2 ring-brand/30' : 'border-brand/60'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-brand" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-brand" />
      <Icon size={16} strokeWidth={2} className="shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-text">{data.label}</div>
        {data.sublabel && <div className="truncate text-[10px] text-text-secondary">{data.sublabel}</div>}
      </div>
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
