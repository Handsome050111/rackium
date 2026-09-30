import { phaseStatus } from '../tokens/design-tokens.js'

const BG_CLASSES = {
  grey: 'bg-status-grey',
  amber: 'bg-status-amber',
  red: 'bg-status-red',
  green: 'bg-status-green',
}

// A compact status indicator for contexts too small for the full
// StatusChip (sidebar phase nav). Same status->colour mapping, so the
// sidebar can never disagree with the dashboard's cards (brief v2.3 §7.3).
export default function StatusDot({ status, className = '' }) {
  const meta = phaseStatus[status]
  if (!meta) return null
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${BG_CLASSES[meta.color]} ${meta.pulsing ? 'animate-pulse' : ''} ${className}`}
      title={meta.label}
      aria-hidden="true"
    />
  )
}
