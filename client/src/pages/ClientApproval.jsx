import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, CheckCircle2, AlertTriangle, XCircle, FileCheck2 } from 'lucide-react'
import Logo from '../components/Logo.jsx'
import SignaturePad from '../components/SignaturePad.jsx'
import { getBuilding } from '../api/index.js'
import { getShareLinkInfo, checkSharePassword, getClientDecision } from '../api/shareLink.js'
import { getSolutionPackageContext, clientApprove, clientRequestChanges, clientReject } from '../api/solutionPackageDesign.js'

const inputClass = 'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-surface-muted px-4 py-10 sm:py-16">
      <div className="w-full max-w-2xl space-y-6">
        <Logo />
        {children}
      </div>
    </div>
  )
}

export default function ClientApproval() {
  const { token } = useParams()
  const [linkStatus, setLinkStatus] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(null)
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [decision, setDecision] = useState(null)

  useEffect(() => {
    getShareLinkInfo(token).then((info) => setLinkStatus(info.status))
  }, [token])

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    const result = await checkSharePassword(token, passwordInput)
    if (!result.ok) {
      setPasswordError('Incorrect password.')
      return
    }
    const info = await getShareLinkInfo(token)
    const [b, ctx, existingDecision] = await Promise.all([getBuilding(info.buildingId), getSolutionPackageContext(info.buildingId), getClientDecision(token)])
    setBuilding(b)
    setContext(ctx)
    setDecision(existingDecision)
    setUnlocked(true)
  }

  async function handleDecisionSubmitted(result) {
    setDecision(result)
  }

  if (linkStatus === 'expired' || linkStatus === 'revoked' || linkStatus === 'not-found') {
    return (
      <Shell>
        <div className="flex items-center gap-3 rounded-xl border border-status-red/30 bg-status-red/5 p-6 text-status-red">
          <XCircle size={24} strokeWidth={2} />
          <div>
            <div className="font-semibold">This approval link is no longer available.</div>
            <div className="text-sm">Please ask your Technonex contact for a new link.</div>
          </div>
        </div>
      </Shell>
    )
  }

  if (!unlocked) {
    return (
      <Shell>
        <form onSubmit={handlePasswordSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-lg font-semibold text-text">
            <Lock size={20} strokeWidth={2} className="text-brand" />
            Solution Package — password required
          </div>
          <p className="text-sm text-text-secondary">Enter the password provided by your Technonex project contact to view this package.</p>
          <input
            type="password"
            autoFocus
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Password"
            className={inputClass}
          />
          {passwordError && <p className="text-xs text-status-red">{passwordError}</p>}
          <button type="submit" className="h-10 w-full rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand/90">
            View Package
          </button>
        </form>
      </Shell>
    )
  }

  if (decision) {
    return (
      <Shell>
        <div className="space-y-2 rounded-xl border border-status-green/30 bg-status-green/5 p-6">
          <div className="flex items-center gap-2 text-status-green">
            <CheckCircle2 size={22} strokeWidth={2} />
            <span className="font-semibold">Thank you — your decision has been recorded.</span>
          </div>
          <p className="text-sm text-text-secondary">
            {decision.decision === 'approved' && 'You approved this Solution Package.'}
            {decision.decision === 'changes_requested' && 'You requested changes to this Solution Package.'}
            {decision.decision === 'rejected' && 'You rejected this Solution Package.'}
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <PackageSummary building={building} context={context} />
      <DecisionForm token={token} onSubmitted={handleDecisionSubmitted} />
    </Shell>
  )
}

function PackageSummary({ building, context }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center gap-2 text-lg font-semibold text-text">
        <FileCheck2 size={20} strokeWidth={2} className="text-brand" />
        Solution Package — {building.name}
      </div>
      <p className="text-sm text-text-secondary">{building.project.code} · {building.project.country} · {building.project.sal} · {building.project.campus}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={`${context.packageCompleteness}%`} label="Package completeness" />
        <Stat value={context.sections.length} label="Sections" />
        <Stat value={`${context.checksPassed}/${context.checksTotal}`} label="Validation checks passed" />
        <Stat value={context.criticalConflicts} label="Critical conflicts" tone={context.criticalConflicts > 0 ? 'text-status-red' : 'text-status-green'} />
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-semibold text-text">Sections</div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <tbody>
              {context.sections.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-1.5 text-text-secondary">{s.n}</td>
                  <td className="px-3 py-1.5 text-text">{s.name}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-text-secondary">{s.completeness}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {context.criticalConflicts > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-status-amber">
          <AlertTriangle size={13} strokeWidth={2} />
          This package has {context.criticalConflicts} unresolved technical item(s).
        </p>
      )}
    </div>
  )
}

function Stat({ value, label, tone = 'text-text' }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className={`text-base font-bold ${tone}`}>{value}</div>
      <div className="text-[11px] text-text-secondary">{label}</div>
    </div>
  )
}

function DecisionForm({ token, onSubmitted }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [comments, setComments] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(null)

  async function submit(action) {
    if (!name.trim()) return setError('Your name is required.')
    if (!accepted) return setError('Please confirm you have reviewed the package.')
    setError(null)
    setSubmitting(action)
    const fn = action === 'approved' ? clientApprove : action === 'rejected' ? clientReject : clientRequestChanges
    const result = await fn(token, { name, role, comments, acceptedTerms: accepted, hasSignature })
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

      <SignaturePad onChange={setHasSignature} />

      <label className="flex items-center gap-2 text-xs text-text">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        I confirm I have reviewed this Solution Package and am authorised to provide this decision.
      </label>

      {error && <p className="text-xs text-status-red">{error}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => submit('approved')}
          disabled={Boolean(submitting)}
          className="h-10 flex-1 rounded-lg bg-status-green text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
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
