import { Server, Wrench, CheckCircle2, Hourglass, Link2, AlertTriangle } from 'lucide-react'

function Stage({ icon: Icon, label, value, total, tone = 'text-brand' }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-tight text-text">
          {value}
          {total != null && <span className="text-sm font-medium text-text-secondary">/{total}</span>}
        </div>
        <div className="truncate text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

// Planned → installed → tested → remaining (brief §5.7), devices and
// connections, every figure calculated on the server from the records.
export default function PipelineBar({ pipeline, openExceptions }) {
  const { devices, connections } = pipeline
  return (
    <div className="space-y-2" data-testid="pipeline">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stage icon={Server} label="devices planned" value={devices.planned} />
        <Stage icon={Wrench} label="devices installed" value={devices.installed} total={devices.planned} />
        <Stage icon={CheckCircle2} label="devices tested" value={devices.tested} total={devices.planned} tone="text-status-green" />
        <Stage icon={Hourglass} label="devices remaining" value={devices.remaining} tone="text-text-secondary" />
        <Stage icon={Link2} label="links installed · tested" value={`${connections.installed} · ${connections.tested}`} total={connections.planned} />
        <Stage icon={AlertTriangle} label="open exceptions" value={openExceptions} tone={openExceptions ? 'text-status-amber' : 'text-status-green'} />
      </div>
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Devices accepted" aria-valuenow={pipeline.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-status-green" style={{ width: `${pipeline.progress}%` }} />
        </div>
        <span className="shrink-0 font-medium text-text">{pipeline.progress}% accepted</span>
      </div>
    </div>
  )
}
