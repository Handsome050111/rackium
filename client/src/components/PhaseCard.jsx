import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PHASE_ICONS } from '../lib/phaseIcons.js'
import StatusChip from './StatusChip.jsx'

export default function PhaseCard({ buildingId, phase }) {
  const Icon = PHASE_ICONS[phase.icon]

  return (
    <Link
      to={`/b/${buildingId}/${phase.id}`}
      className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-brand/40 hover:shadow-sm"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon size={20} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text">{phase.name}</span>
        <StatusChip status={phase.status} subLabel={phase.subLabel} size="sm" />
      </span>
      <ChevronRight size={18} className="shrink-0 text-text-secondary" />
    </Link>
  )
}
