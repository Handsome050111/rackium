import { ArrowUp } from 'lucide-react'
import TopologyIcon from '../TopologyIcon.jsx'

// Renders the chain towards the WAN circuit (e.g. Edge -> Border -> Fusion
// -> SD-WAN CPE) and the immediate uplink's own medium/speed/cable detail,
// which is what the Architect edits from this view.
export default function UpstreamPathPanel({ steps }) {
  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-xs text-text-secondary">
        No upstream uplink designed yet for this device.
      </div>
    )
  }

  const chain = [steps[0].from, ...steps.map((s) => s.to)]
  const first = steps[0]

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <ArrowUp size={16} strokeWidth={2} className="text-brand" />
        Upstream design path
      </div>

      <ol className="space-y-1">
        {chain.map((entity, i) => {
          const step = steps[i - 1]
          return (
            <li key={entity.id}>
              {i > 0 && (
                <div className="pl-[7px] text-[10px] text-text-secondary">
                  {step.fromPort} → {step.toPort}
                </div>
              )}
              <div className="flex items-center gap-2 text-xs">
                <TopologyIcon
                  role={entity.role}
                  size={14}
                  className={entity.role === 'wan-circuit' ? 'text-text-secondary' : 'text-brand'}
                />
                <span className="font-medium text-text">{entity.label}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="space-y-1.5 border-t border-border pt-3">
        <Detail label="Medium" value={first.row.mediaLabel} />
        <Detail label="Speed" value={first.row.speed} />
        <Detail label="Cable ID" value={first.row.cableId ?? 'Pending'} amber={!first.row.cableId} />
        <Detail label="Status" value={first.row.statusLabel} />
      </div>
    </div>
  )
}

function Detail({ label, value, amber }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-medium ${amber ? 'text-status-amber' : 'text-text'}`}>{value}</span>
    </div>
  )
}
