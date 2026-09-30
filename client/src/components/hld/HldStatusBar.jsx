import { CheckCircle2, AlertTriangle } from 'lucide-react'

export default function HldStatusBar({ surveyLinkedObjectCount, cmo, openDesignQuestions, blockedLinkCount }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs text-text-secondary">
      <span>
        Survey-linked objects: <strong className="text-text">{surveyLinkedObjectCount}</strong> · CMO validated:{' '}
        <strong className="text-text">
          {cmo.validated}/{cmo.total}
        </strong>{' '}
        · Open design questions: <strong className="text-text">{openDesignQuestions}</strong>
      </span>
      {blockedLinkCount > 0 ? (
        <span className="flex items-center gap-1.5 font-medium text-status-red">
          <AlertTriangle size={14} strokeWidth={2} />
          {blockedLinkCount} blocked link{blockedLinkCount === 1 ? '' : 's'}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 font-medium text-status-green">
          <CheckCircle2 size={14} strokeWidth={2} />
          No blocked links
        </span>
      )}
    </div>
  )
}
