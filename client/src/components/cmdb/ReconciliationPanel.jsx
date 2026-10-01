import { Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react'

// Brief Step 8: "design baseline vs installed counts, missing serials,
// cable ID conflicts — calculated." Every figure here comes straight from
// lib/cmdbModel.js's computeReconciliation — nothing hand-typed.
export default function ReconciliationPanel({ reconciliation }) {
  const clean = reconciliation.inventoryVariance === 0 && reconciliation.missingSerials.length === 0 && reconciliation.cableIdConflicts.length === 0

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Sparkles size={16} strokeWidth={2} className="text-brand" />
        NexAI CMDB reconciliation
      </div>
      <Row label="HLD/LLD baseline" value={`${reconciliation.hldDeviceCount} devices`} />
      <Row label="Installed inventory" value={`${reconciliation.cmdbDeviceCount} CIs`} />
      <Row label="Inventory variance" value={reconciliation.inventoryVariance} tone={reconciliation.inventoryVariance === 0 ? 'text-status-green' : 'text-status-amber'} />
      <Row label="Missing serials" value={reconciliation.missingSerials.length} tone={reconciliation.missingSerials.length === 0 ? 'text-status-green' : 'text-status-amber'} />
      <Row label="Cable ID conflicts" value={reconciliation.cableIdConflicts.length} tone={reconciliation.cableIdConflicts.length === 0 ? 'text-status-green' : 'text-status-red'} />

      <div className={`mt-1 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${clean ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'}`}>
        {clean ? <CheckCircle2 size={14} strokeWidth={2} /> : <AlertTriangle size={14} strokeWidth={2} />}
        {clean ? 'As-built inventory aligned' : 'Review required'}
      </div>
      <p className="text-[11px] text-text-secondary">Human acceptance remains authoritative.</p>
    </div>
  )
}

function Row({ label, value, tone = 'text-text' }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-medium ${tone}`}>{value}</span>
    </div>
  )
}
