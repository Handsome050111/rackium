import { useState } from 'react'
import { History } from 'lucide-react'
import ShareLinkPanel from '../ShareLinkPanel.jsx'
import { deliveryApi } from '../../../api/deliveryApi.js'

const STATUS_STYLE = { active: 'text-status-green', expired: 'text-status-amber', locked: 'text-status-red', revoked: 'text-text-secondary', decided: 'text-brand' }
const DECISION_LABEL = { approved: 'Approved', changes_requested: 'Changes requested', rejected: 'Rejected', pending: 'Pending', expired: 'Withdrawn' }

// The client approval link (brief §5.5; M5a): the PM sends the package with
// a password and an expiry (1–30 days). The link and password are shown once
// — only hashes are kept — so they are revealed right after sending; later
// the PM sees each link's status and can extend or revoke it.
export default function ShareLinksPanel({ view, canShare, orgId, projectId, buildingId, onChanged, onError }) {
  const [secret, setSecret] = useState(null)
  const [days, setDays] = useState(7)
  const canSend = canShare && ['draft', 'changes_requested', 'rejected'].includes(view.state)
  async function run(fn) {
    try {
      const res = await fn()
      await onChanged()
      return res
    } catch (err) {
      onError(err.message)
      return null
    }
  }
  return (
    <div className="space-y-4" data-testid="share-links">
      {(canSend || secret) && (
        <ShareLinkPanel
          activeLink={secret}
          readyForSubmission={view.readyForSubmission}
          canSubmit={canSend}
          notReadyHint="Every input group complete, no Critical finding and every warning accepted — see the list on the left."
          onSubmit={async ({ password, expiryDays }) => {
            const res = await run(() => deliveryApi.submitPackage(orgId, projectId, { buildingId, ...(password ? { password } : {}), expiryDays: Number(expiryDays) }))
            if (res) setSecret(res.shareLink)
          }}
        />
      )}
      {secret && <p className="text-xs text-status-amber">Copy the link and password now — they are shown only once.</p>}

      {view.shareLinks.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-xs">
          <div className="text-sm font-semibold text-text">Approval links</div>
          {view.shareLinks.map((l) => (
            <div key={l.id} className="space-y-1 border-b border-border/60 pb-2 last:border-0" data-testid="share-link-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`font-medium capitalize ${STATUS_STYLE[l.status] ?? ''}`}>{l.status}</span>
                <span className="text-text-secondary">expires {new Date(l.expiresAt).toLocaleDateString()}</span>
              </div>
              <div className="text-text-secondary">
                Sent by {l.createdBy} on {new Date(l.createdAt).toLocaleDateString()}
                {l.extensions.length > 0 && ` · extended ${l.extensions.length}×`}
              </div>
              {canShare && ['active', 'expired', 'locked'].includes(l.status) && (
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label="Extend by days" type="number" min="1" max="30" value={days} onChange={(e) => setDays(e.target.value)} className="h-7 w-16 rounded border border-border px-1.5 text-xs" />
                  <button type="button" onClick={() => run(() => deliveryApi.extendLink(orgId, projectId, l.id, { days: Number(days) }))} className="h-7 rounded border border-border px-2 font-medium text-brand hover:border-brand">
                    Extend
                  </button>
                  <button type="button" onClick={() => window.confirm('Revoke this link? The client can no longer decide through it.') && run(() => deliveryApi.revokeLink(orgId, projectId, l.id))} className="h-7 rounded border border-status-red/40 px-2 font-medium text-status-red">
                    Revoke
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view.approvals.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-4 text-xs" data-testid="approval-history">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <History size={14} strokeWidth={2} className="text-brand" />
            Client decisions
          </div>
          {view.approvals.map((a) => (
            <div key={a.id} className="border-b border-border/60 pb-1.5 last:border-0">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium text-text">
                  v{a.versionNumber} · {DECISION_LABEL[a.status] ?? a.status}
                </span>
                <span className="text-text-secondary">{new Date(a.decision?.decidedAt ?? a.submittedAt).toLocaleString()}</span>
              </div>
              {a.client && (
                <div className="text-text-secondary">
                  {a.client.name}
                  {a.client.role ? `, ${a.client.role}` : ''}
                  {a.decision?.signed ? ' · signed' : ''}
                  {a.decision?.termsAccepted ? ' · terms accepted' : ''}
                </div>
              )}
              {a.decision?.comments && <div className="text-text">“{a.decision.comments}”</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
