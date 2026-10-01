import { Calculator, CheckCircle2, AlertTriangle } from 'lucide-react'

export default function CalculationLogicPanel({ calc, reconciliation }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Calculator size={16} strokeWidth={2} className="text-brand" />
        Calculation logic
      </div>
      <ul className="space-y-1 text-xs text-text-secondary">
        {calc.map((line, i) => (
          <li key={i} className="font-mono">
            {line}
          </li>
        ))}
      </ul>
      <div className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
        reconciliation.reconciled ? 'bg-status-green/10 text-status-green' : 'bg-status-amber/10 text-status-amber'
      }`}>
        {reconciliation.reconciled ? <CheckCircle2 size={14} strokeWidth={2} /> : <AlertTriangle size={14} strokeWidth={2} />}
        {reconciliation.reconciled
          ? `BOM reconciles with HLD/LLD: ${reconciliation.bomCount}/${reconciliation.realCount} devices`
          : `BOM variance: ${reconciliation.bomCount}/${reconciliation.realCount} devices — review required`}
      </div>
    </div>
  )
}
