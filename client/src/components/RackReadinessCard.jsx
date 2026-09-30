import { Gauge, CheckCircle2, XCircle } from 'lucide-react'

export default function RackReadinessCard({ readiness }) {
  const isReady = readiness.actions.length === 0

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
        <Gauge size={16} strokeWidth={2} className="text-brand" />
        Readiness summary
      </div>

      <dl className="mb-3 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Available RU</dt>
          <dd className="font-medium text-text">{readiness.availableRU}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Contiguous free RU</dt>
          <dd className="font-medium text-text">{readiness.contiguousFreeRU}</dd>
        </div>
      </dl>

      <ul className="space-y-1.5 border-t border-border pt-2">
        {readiness.checks.map((check) => (
          <li key={check.id} className="flex items-center gap-2 text-xs">
            {check.pass ? (
              <CheckCircle2 size={14} strokeWidth={2} className="shrink-0 text-status-green" />
            ) : (
              <XCircle size={14} strokeWidth={2} className="shrink-0 text-status-red" />
            )}
            <span className="text-text">{check.label}</span>
            <span className={`ml-auto font-medium ${check.pass ? 'text-status-green' : 'text-status-red'}`}>
              {check.pass ? 'Pass' : 'Fail'}
            </span>
          </li>
        ))}
      </ul>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-semibold ${isReady ? 'border-status-green/30 bg-status-green/10 text-status-green' : 'border-status-amber/30 bg-status-amber/10 text-status-amber'}`}>
        {readiness.overallStatus}
        {readiness.actions.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 font-normal text-text-secondary">
            {readiness.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
