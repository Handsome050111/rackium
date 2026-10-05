import { Check } from 'lucide-react'
import { WORKFLOW_LABEL } from '@rackium/shared/handoverModel.js'

// v2.2 §3.11: Pending -> Ready -> Compiled -> Under review -> Delivered ->
// Accepted. "Changes requested" is a client outcome, not a forward step —
// shown as a distinct banner rather than in this linear tracker.
const STEPS = ['pending', 'ready', 'compiled', 'under_review', 'delivered', 'accepted']

export default function WorkflowTracker({ state, readyToCompile }) {
  const effectiveState = state === 'pending' && readyToCompile ? 'ready' : state
  const currentIndex = STEPS.indexOf(effectiveState === 'changes_requested' ? 'compiled' : effectiveState)

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-text-secondary">
      {STEPS.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={step} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                done ? 'bg-status-green text-white' : active ? 'bg-brand text-white' : 'border border-border bg-surface text-text-secondary'
              }`}
            >
              {done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className={active ? 'font-semibold text-brand' : done ? 'text-text' : ''}>{WORKFLOW_LABEL[step]}</span>
            {i < STEPS.length - 1 && <span className="mx-1 hidden h-px w-6 bg-border sm:block" />}
          </div>
        )
      })}
      {state === 'changes_requested' && (
        <span className="ml-2 rounded-full bg-status-red/10 px-2 py-0.5 font-semibold text-status-red">Changes requested by client</span>
      )}
    </div>
  )
}
