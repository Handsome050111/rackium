import { useState } from 'react'
import StatusChip from '../StatusChip.jsx'

// Separation of duties (brief v2.3 D06): an Architect can never approve
// (their own or anyone's) HLD — only PM or Reviewer can. This is a role
// rule, not a "different person than the submitter" rule, matching the
// §4.3 RACI table where Architect isn't listed as an approver at all.
// Real mode passes `canSubmit` / `canReview` from the user's project roles
// (and `submitBlockedReason`), and `requireComment` so a change request
// carries what needs to change; mock mode keeps the role switcher rule.
export default function HldWorkflowControls({ status, role, onSubmit, onApprove, onRequestChanges, canSubmit: canSubmitProp, canReview: canReviewProp, requireComment = false, submitBlockedReason = null }) {
  const canSubmit = canSubmitProp ?? role === 'architect'
  const canReview = canReviewProp ?? (role === 'pm' || role === 'reviewer')
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
      <StatusChip status={status} />

      <div className="flex items-center gap-2">
        {canSubmit && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={status === 'awaiting_approval' || Boolean(submitBlockedReason)}
            title={submitBlockedReason ?? undefined}
            className="h-touch rounded-lg bg-brand px-4 text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey sm:h-9"
          >
            Submit for approval
          </button>
        )}
        {canReview && (
          <>
            <button
              type="button"
              onClick={() => (requireComment ? setCommenting(true) : onRequestChanges())}
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
      {submitBlockedReason && canSubmit && status !== 'awaiting_approval' && <p className="w-full text-xs text-status-red">{submitBlockedReason}</p>}
      {commenting && (
        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What needs to change?"
            aria-label="What needs to change"
            className="h-9 flex-1 rounded-lg border border-border bg-surface px-2.5 text-xs focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            disabled={!comment.trim()}
            onClick={async () => {
              await onRequestChanges(comment.trim())
              setCommenting(false)
              setComment('')
            }}
            className="h-9 rounded-lg bg-status-red px-3 text-xs font-medium text-white disabled:opacity-50"
          >
            Send change request
          </button>
          <button type="button" onClick={() => setCommenting(false)} className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-text">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
