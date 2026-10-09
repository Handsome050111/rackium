import { XCircle, AlertTriangle, Info, CheckCircle2, X } from 'lucide-react'

const SECTIONS = [
  { severity: 'critical', label: 'Critical', icon: XCircle, color: 'text-status-red', note: 'Blocks submit' },
  { severity: 'warning', label: 'Warning', icon: AlertTriangle, color: 'text-status-amber', note: 'Should be resolved' },
  { severity: 'info', label: 'Info', icon: Info, color: 'text-brand', note: 'Advisory' },
]

// Validation results (brief v2.3 §6.8): findings grouped Critical / Warning /
// Info with their rule ID; a finding on an uplink or device selects it.
export default function HldValidationPanel({ result, onSelectFinding, onClose, designLabel = 'HLD' }) {
  const { findings, summary } = result
  return (
    <div data-testid="hld-validation" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text">Validation</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close validation" className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-muted">
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {SECTIONS.map((s) => (
          <span key={s.severity} className={`flex items-center gap-1 font-medium ${s.color}`}>
            <s.icon size={13} strokeWidth={2} />
            {summary[s.severity]} {s.label}
          </span>
        ))}
      </div>
      {findings.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-status-green">
          <CheckCircle2 size={14} strokeWidth={2} />
          No findings — the {designLabel} can be submitted.
        </p>
      )}
      {SECTIONS.map((s) => {
        const list = findings.filter((f) => f.severity === s.severity)
        if (!list.length) return null
        return (
          <div key={s.severity}>
            <div className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${s.color}`}>
              {s.label} · {s.note}
            </div>
            <ul className="space-y-1">
              {list.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => onSelectFinding?.(f)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface-muted">
                    <s.icon size={13} strokeWidth={2} className={`mt-0.5 shrink-0 ${s.color}`} />
                    <span>
                      <span className="font-semibold text-text">{f.rule}</span> <span className="text-text-secondary">{f.message}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
