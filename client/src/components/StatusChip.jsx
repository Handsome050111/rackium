import { CheckCircle2, Clock, AlertTriangle, Ban, Circle } from 'lucide-react'
import { phaseStatus } from '../tokens/design-tokens.js'

const ICONS = {
  not_started: Circle,
  in_progress: Clock,
  awaiting_approval: Clock,
  changes_requested: AlertTriangle,
  blocked: Ban,
  approved: CheckCircle2,
  completed: CheckCircle2,
}

const COLOR_CLASSES = {
  grey: 'text-status-grey',
  amber: 'text-status-amber',
  red: 'text-status-red',
  green: 'text-status-green',
}

export default function StatusChip({ status, subLabel, size = 'md' }) {
  const meta = phaseStatus[status]
  if (!meta) return null

  const Icon = ICONS[status]
  const colorClass = COLOR_CLASSES[meta.color]
  const iconSize = size === 'sm' ? 14 : 16
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${colorClass} ${textSize}`}>
      <Icon size={iconSize} className={meta.pulsing ? 'animate-pulse' : ''} strokeWidth={2} />
      <span>{meta.label}</span>
      {subLabel && (
        <span className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          {subLabel}
        </span>
      )}
    </span>
  )
}
