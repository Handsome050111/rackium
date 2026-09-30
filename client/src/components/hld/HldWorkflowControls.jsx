import StatusChip from '../StatusChip.jsx'

// Separation of duties (brief v2.3 D06): an Architect can never approve
// (their own or anyone's) HLD — only PM or Reviewer can. This is a role
// rule, not a "different person than the submitter" rule, matching the
// §4.3 RACI table where Architect isn't listed as an approver at all.
export default function HldWorkflowControls({ status, role, onSubmit, onApprove, onRequestChanges }) {
  const canSubmit = role === 'architect'
  const canReview = role === 'pm' || role === 'reviewer'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <StatusChip status={status} />

      <div className="flex items-center gap-2">
        {canSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={status === 'awaiting_approval'}
            className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
          >
            Submit for approval
          </button>
        )}
        {canReview && (
          <>
            <button
              type="button"
              onClick={onRequestChanges}
              disabled={status !== 'awaiting_approval'}
              className="h-touch rounded-lg border border-status-red/40 px-4 text-xs font-medium text-status-red hover:bg-status-red/5 disabled:cursor-not-allowed disabled:opacity-40 sm:h-9"
            >
              Request changes
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={status !== 'awaiting_approval'}
              className="h-touch rounded-lg bg-status-green px-4 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
            >
              Approve
            </button>
          </>
        )}
        {!canSubmit && !canReview && <span className="text-xs text-text-secondary">Read-only for this role</span>}
      </div>
    </div>
  )
}
