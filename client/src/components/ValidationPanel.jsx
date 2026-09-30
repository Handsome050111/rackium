import { Sparkles, CheckCircle2, XCircle, Info } from 'lucide-react'

const ICONS = { pass: CheckCircle2, fail: XCircle, info: Info }
const COLOR_CLASSES = { pass: 'text-status-green', fail: 'text-status-red', info: 'text-status-amber' }

export default function ValidationPanel({ findings, engineerSelectedLength, stockOptions, onChangeEngineerSelectedLength, disabled }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
        <Sparkles size={16} strokeWidth={2} className="text-brand" />
        NexAI Validation
      </div>
      <ul className="space-y-2">
        {findings.map((finding) => {
          const Icon = ICONS[finding.status]
          return (
            <li key={finding.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="flex items-start gap-2">
                <Icon size={16} strokeWidth={2} className={`mt-0.5 shrink-0 ${COLOR_CLASSES[finding.status]}`} />
                <div>
                  <div className="text-text">{finding.label}</div>
                  <div className="text-xs text-text-secondary">{finding.message}</div>
                </div>
              </div>
              {finding.id === 'cable-length' && stockOptions.length > 0 && (
                <select
                  value={engineerSelectedLength ?? ''}
                  onChange={(e) => onChangeEngineerSelectedLength(Number(e.target.value))}
                  disabled={disabled}
                  className="h-8 shrink-0 rounded-lg border border-border bg-surface px-2 text-xs text-text focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {stockOptions.map((v) => (
                    <option key={v} value={v}>
                      {v} m
                    </option>
                  ))}
                </select>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
