import { useState } from 'react'
import Logo from '../Logo.jsx'
import SignaturePad from '../SignaturePad.jsx'

const inputClass = 'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

// The public approval page's frame: no app shell (brief §5.5).
export function ApprovalShell({ children }) {
  return (
    <div className="flex min-h-[calc(100vh-var(--env-banner-h,0px))] items-start justify-center bg-surface-muted px-4 py-10 sm:py-16">
      <div className="w-full max-w-2xl space-y-6">
        <Logo />
        {children}
      </div>
    </div>
  )
}

export function Stat({ value, label, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className={`text-base font-bold ${tone}`}>{value}</div>
      <div className="text-[11px] text-text-secondary">{label}</div>
    </div>
  )
}

// The decision form of the public approval page (mock and real): name, role,
// comments, optional drawn signature and the acceptance checkbox.
// `decisionFns.{approve,requestChanges,reject}(token, fields)` → { ok, error }.
export function DecisionForm({ token, packageLabel = 'package', approveLabel = 'Approve', decisionFns, onSubmitted }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [comments, setComments] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [signature, setSignature] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(null)

  async function submit(action) {
    if (!name.trim()) return setError('Your name is required.')
    if (!accepted) return setError('Please confirm you have reviewed the package.')
    setError(null)
    setSubmitting(action)
    const fn = action === 'approved' ? decisionFns.approve : action === 'rejected' ? decisionFns.reject : decisionFns.requestChanges
    const result = await fn(token, { name, role, comments, acceptedTerms: accepted, hasSignature, signature })
    setSubmitting(null)
    if (!result.ok) return setError(result.error)
    onSubmitted(result)
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="text-sm font-semibold text-text">Your decision</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-text-secondary">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Your full name" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-text-secondary">Role</span>
          <input value={role} onChange={(e) => setRole(e.target.value)} className={inputClass} placeholder="e.g. IT Director" />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-text-secondary">Comments</span>
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text focus:border-brand focus:outline-none" />
      </label>

      <SignaturePad onChange={setHasSignature} onDataUrl={setSignature} />

      <label className="flex items-center gap-2 text-xs text-text">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        I confirm I have reviewed this {packageLabel} and am authorised to provide this decision.
      </label>

      {error && <p className="text-xs text-status-red">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => submit('approved')}
          disabled={Boolean(submitting)}
          className="h-10 flex-1 rounded-lg bg-status-green text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {approveLabel}
        </button>
        <button
          type="button"
          onClick={() => submit('changes_requested')}
          disabled={Boolean(submitting)}
          className="h-10 flex-1 rounded-lg border border-status-amber/40 text-sm font-medium text-status-amber hover:bg-status-amber/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Request changes
        </button>
        <button
          type="button"
          onClick={() => submit('rejected')}
          disabled={Boolean(submitting)}
          className="h-10 flex-1 rounded-lg border border-status-red/40 text-sm font-medium text-status-red hover:bg-status-red/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
