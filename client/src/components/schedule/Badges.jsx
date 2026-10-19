import { CheckCircle2, Clock, AlertTriangle, Ban, CircleDashed, TrendingUp } from 'lucide-react'
import { RISK_LABEL, SLA_STATUS_LABEL } from '@rackium/shared/schedule.js'

// Risk and SLA status (M7a-1): always an icon and a word, never colour alone.
const RISK = {
  done: { Icon: CheckCircle2, cls: 'text-status-green' },
  on_track: { Icon: TrendingUp, cls: 'text-text-secondary' },
  at_risk: { Icon: Clock, cls: 'text-status-amber' },
  overdue: { Icon: AlertTriangle, cls: 'text-status-red' },
  blocked: { Icon: Ban, cls: 'text-status-red' },
  unscheduled: { Icon: CircleDashed, cls: 'text-text-secondary' },
}
export function RiskBadge({ risk }) {
  const { Icon, cls } = RISK[risk] ?? RISK.unscheduled
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${cls}`}>
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {RISK_LABEL[risk] ?? risk}
    </span>
  )
}

const SLA = {
  met: { Icon: CheckCircle2, cls: 'text-status-green' },
  on_track: { Icon: TrendingUp, cls: 'text-text-secondary' },
  at_risk: { Icon: Clock, cls: 'text-status-amber' },
  breached: { Icon: AlertTriangle, cls: 'text-status-red' },
}
export function SlaBadge({ status }) {
  const { Icon, cls } = SLA[status] ?? SLA.on_track
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${cls}`}>
      <Icon size={13} strokeWidth={2} aria-hidden="true" />
      {SLA_STATUS_LABEL[status] ?? status}
    </span>
  )
}
