import { getSmoothStepPath, EdgeLabelRenderer, BaseEdge } from '@xyflow/react'
import { CheckCircle2, AlertTriangle, Ban } from 'lucide-react'
import { mediaColors } from '../../tokens/design-tokens.js'

const STATUS_ICON = { validated: CheckCircle2, blocked: Ban, warning: AlertTriangle }
const STATUS_COLOR = { validated: 'text-status-green', blocked: 'text-status-red', warning: 'text-status-amber' }

export function UplinkEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8 })
  const media = mediaColors[data?.media] ?? mediaColors.cat6a
  const StatusIcon = STATUS_ICON[data?.status]

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: media.stroke,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: data?.preview ? '6 4' : media.style === 'dashed' ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          className="pointer-events-none absolute flex items-center gap-1 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text shadow-sm"
        >
          {data?.speed && <span>{data.speed}</span>}
          {StatusIcon && <StatusIcon size={11} strokeWidth={2} className={STATUS_COLOR[data.status]} />}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const HLD_EDGE_TYPES = { uplink: UplinkEdge }
