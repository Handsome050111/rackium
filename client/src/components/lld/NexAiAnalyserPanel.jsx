import { Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'

// Every figure here is derived from the shared data (HLD context + LLD
// placements), never typed in — "HLD mapped" devices are the ones with a
// real rack/room placement, so the variance is a genuine signal, not a
// decorative number.
export default function NexAiAnalyserPanel({ topology, lldDeviceCount, hldChanged }) {
  const hldBaselineCount = topology.devices.length
  const variance = Math.abs(hldBaselineCount - lldDeviceCount)
  const aligned = variance === 0 && !hldChanged

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Sparkles size={16} strokeWidth={2} className="text-brand" />
        NexAI data analyser
      </div>
      <Row label="HLD baseline" value={`${hldBaselineCount} managed devices`} />
      <Row label="LLD mapped" value={`${lldDeviceCount} managed devices`} />
      <Row label="Suggested direct uplinks" value={String(topology.suggestions.uplinks.length)} />
      <Row label="Design variance" value={String(variance)} />
      <div className={`mt-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
        aligned ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'
      }`}>
        {aligned ? <CheckCircle2 size={14} strokeWidth={2} /> : <AlertTriangle size={14} strokeWidth={2} />}
        {aligned ? 'Aligned with approved HLD' : 'Review against HLD recommended'}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  )
}
