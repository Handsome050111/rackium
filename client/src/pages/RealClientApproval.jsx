import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock, CheckCircle2, XCircle, FileCheck2, GitPullRequest } from 'lucide-react'
import { ApprovalShell as Shell, Stat, DecisionForm } from '../components/clientApproval/ApprovalParts.jsx'
import DesignDiff from '../components/lld/real/DesignDiff.jsx'
import { publicApprovalApi } from '../api/deliveryApi.js'

const inputClass = 'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
const DIFF_COLUMNS = [
  { kind: 'added', title: 'Added', key: 'added' },
  { kind: 'removed', title: 'Removed', key: 'removed' },
  { kind: 'changed', title: 'Changed', key: 'changed' },
]
const CLOSED = {
  expired: 'This approval link has expired. Please ask your project contact to extend it.',
  revoked: 'This approval link was withdrawn. Please ask your project contact for a new one.',
  decided: 'A decision was already recorded through this link.',
  link_not_found: 'This approval link does not exist.',
}

// The public client approval page in real mode (brief v2.3 §5.5; M5a): no
// login, no app shell. The token is in the link; the password unlocks the
// read-only package (or change request) and is sent again with the decision.
export default function RealClientApproval() {
  const { token } = useParams()
  const [status, setStatus] = useState(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [subject, setSubject] = useState(null)
  const [decided, setDecided] = useState(null)

  useEffect(() => {
    publicApprovalApi
      .status(token)
      .then(setStatus)
      .catch((err) => setStatus({ status: err.code === 'link_not_found' ? 'link_not_found' : 'error', message: err.message }))
  }, [token])

  async function unlock(e) {
    e.preventDefault()
    try {
      setSubject(await publicApprovalApi.view(token, password))
      setError(null)
    } catch (err) {
      // A link that closed meanwhile shows its closed state; anything else (a
      // wrong password, a lock) is shown under the field.
      const closedAs = { link_expired: 'expired', link_revoked: 'revoked', already_decided: 'decided' }[err.code]
      if (closedAs) setStatus({ status: closedAs })
      else setError(err.message)
    }
  }

  const fn = (decision) => async (_token, fields) => {
    try {
      const result = await publicApprovalApi.decide(token, { password, decision, name: fields.name, role: fields.role, comments: fields.comments, termsAccepted: fields.acceptedTerms, signature: fields.signature ?? null })
      return { ok: true, decision, ...result }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  }

  if (!status) return <Shell><p className="text-sm text-text-secondary">Loading…</p></Shell>
  if (status.status !== 'active') {
    return (
      <Shell>
        <div className="flex items-center gap-3 rounded-xl border border-status-red/30 bg-status-red/5 p-6 text-status-red" role="alert">
          <XCircle size={24} strokeWidth={2} className="shrink-0" />
          <div>
            <div className="font-semibold">This approval link is no longer available.</div>
            <div className="text-sm">{CLOSED[status.status] ?? status.message ?? 'Please ask your project contact for a new link.'}</div>
          </div>
        </div>
      </Shell>
    )
  }
  if (decided) {
    const label = subject?.kindLabel ?? 'package'
    return (
      <Shell>
        <div className="space-y-2 rounded-xl border border-status-green/30 bg-status-green/5 p-6" data-testid="decision-recorded">
          <div className="flex items-center gap-2 text-status-green">
            <CheckCircle2 size={22} strokeWidth={2} />
            <span className="font-semibold">Thank you — your decision has been recorded.</span>
          </div>
          <p className="text-sm text-text-secondary">
            {decided.decision === 'approved' && `You approved this ${label}.`}
            {decided.decision === 'changes_requested' && `You requested changes to this ${label}.`}
            {decided.decision === 'rejected' && `You rejected this ${label}.`}
          </p>
        </div>
      </Shell>
    )
  }
  if (!subject) {
    return (
      <Shell>
        <form onSubmit={unlock} className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-lg font-semibold text-text">
            <Lock size={20} strokeWidth={2} className="text-brand" />
            {status.kindLabel} — password required
          </div>
          <p className="text-sm text-text-secondary">Enter the password provided by your project contact to view this {status.kindLabel?.toLowerCase()}.</p>
          <input type="password" autoFocus aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputClass} />
          {error && (
            <p className="text-xs text-status-red" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={!password} className="h-10 w-full rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
            View {status.kindLabel}
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell>
      {subject.kind === 'solution_package' ? <PackageSummary subject={subject} /> : <ChangeSummary subject={subject} />}
      <DecisionForm token={token} packageLabel={subject.kindLabel} decisionFns={{ approve: fn('approved'), requestChanges: fn('changes_requested'), reject: fn('rejected') }} onSubmitted={setDecided} />
    </Shell>
  )
}

function Header({ subject, icon: Icon, title }) {
  return (
    <>
      <div className="flex items-center gap-2 text-lg font-semibold text-text">
        <Icon size={20} strokeWidth={2} className="shrink-0 text-brand" />
        {title}
      </div>
      <p className="text-sm text-text-secondary">
        {[subject.project.clientName, subject.project.name, subject.project.code, subject.building.code].filter(Boolean).join(' · ')} · link valid until {new Date(subject.expiresAt).toLocaleDateString()}
      </p>
    </>
  )
}

function PackageSummary({ subject }) {
  const pkg = subject.package
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6" data-testid="package-summary">
      <Header subject={subject} icon={FileCheck2} title={`Solution Package v${subject.versionNumber} — ${subject.building.name}`} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat value={`${pkg.packageCompleteness}%`} label="Package completeness" />
        <Stat value={pkg.sections.length} label="Sections" />
        <Stat value={`${pkg.checksPassed}/${pkg.checksTotal}`} label="Validation checks passed" />
      </div>
      <Table title="Sections" rows={pkg.sections.map((s) => [s.n, s.name, `${s.completeness}%`])} />
      <Table title="Bill of Materials" rows={pkg.bom.map((l) => [l.qty, l.item, l.spec])} />
      {pkg.acceptedWarnings.length > 0 && <Table title="Accepted warnings" rows={pkg.acceptedWarnings.map((w) => ['', w.text, `${w.acceptedByName}`])} />}
    </div>
  )
}

function ChangeSummary({ subject }) {
  const cr = subject.changeRequest
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface p-6" data-testid="change-summary">
      <Header subject={subject} icon={GitPullRequest} title={`Change request CR-${cr.number}: ${cr.title}`} />
      {cr.description && <p className="whitespace-pre-line text-sm text-text">{cr.description}</p>}
      {cr.reason && (
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text">Reason: </span>
          {cr.reason}
        </p>
      )}
      {cr.affectedItems.length > 0 && <Table title="Affected items" rows={cr.affectedItems.map((x, i) => [i + 1, x, ''])} />}
      {cr.impact && (
        <>
          <div className="text-sm font-semibold text-text">Design changes</div>
          <DesignDiff columns={DIFF_COLUMNS} sections={[{ title: 'Devices', data: cr.impact.design.devices }, { title: 'Connections', data: cr.impact.design.connections }]} />
          <Table title="Bill of Materials impact" rows={cr.impact.bom.lines.map((l) => [l.change, `${l.item} (${l.spec})`, `${l.before} → ${l.after}`])} />
        </>
      )}
    </div>
  )
}

function Table({ title, rows }) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-text">{title}</div>
      <div className="max-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-xs">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-1.5 text-text-secondary">{r[0]}</td>
                <td className="px-3 py-1.5 text-text">{r[1]}</td>
                <td className="px-3 py-1.5 text-right text-text-secondary">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
