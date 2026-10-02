import { useState } from 'react'
import { Link2, Copy, Check, Send } from 'lucide-react'
import { MIN_EXPIRY_DAYS, MAX_EXPIRY_DAYS, DEFAULT_EXPIRY_DAYS } from '../../api/shareLink.js'

export default function ShareLinkPanel({ activeLink, readyForSubmission, canSubmit, onSubmit, title = 'Client approval link', actionLabel = 'Submit for Client Approval', notReadyHint = 'Resolve all required inputs and critical conflicts before submitting for client approval.' }) {
  const [password, setPassword] = useState('')
  const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS)
  const [copied, setCopied] = useState(null)

  const url = activeLink ? `${window.location.origin}/approve/${activeLink.token}` : null

  function copy(value, which) {
    navigator.clipboard?.writeText(value).catch(() => {})
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text">
        <Link2 size={16} strokeWidth={2} className="text-brand" />
        {title}
      </div>

      {activeLink ? (
        <div className="space-y-2 text-xs">
          <Field label="Link">
            <CopyRow value={url} onCopy={() => copy(url, 'url')} copied={copied === 'url'} />
          </Field>
          <Field label="Password">
            <CopyRow value={activeLink.password} onCopy={() => copy(activeLink.password, 'pw')} copied={copied === 'pw'} />
          </Field>
          <div className="flex items-center justify-between text-text-secondary">
            <span>Expires</span>
            <span className="font-medium text-text">{new Date(activeLink.expiresAt).toLocaleDateString()}</span>
          </div>
        </div>
      ) : (
        <>
          {!readyForSubmission && <p className="text-xs text-status-amber">{notReadyHint}</p>}
          {canSubmit && (
            <div className="space-y-2">
              <Field label="Password (optional — a random one is generated if left blank)">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                  className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                />
              </Field>
              <Field label={`Expiry in days (${MIN_EXPIRY_DAYS}-${MAX_EXPIRY_DAYS})`}>
                <input
                  type="number"
                  min={MIN_EXPIRY_DAYS}
                  max={MAX_EXPIRY_DAYS}
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(e.target.value)}
                  className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-xs focus:border-brand focus:outline-none"
                />
              </Field>
              <button
                type="button"
                disabled={!readyForSubmission}
                onClick={() => onSubmit({ password, expiryDays })}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-xs font-medium text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-status-grey"
              >
                <Send size={14} strokeWidth={2} />
                {actionLabel}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

function CopyRow({ value, onCopy, copied }) {
  return (
    <div className="flex items-center gap-1">
      <input readOnly value={value} className="h-8 flex-1 truncate rounded-lg border border-border bg-surface-muted px-2 text-xs text-text" />
      <button type="button" onClick={onCopy} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text hover:border-brand">
        {copied ? <Check size={13} strokeWidth={2} className="text-status-green" /> : <Copy size={13} strokeWidth={2} />}
      </button>
    </div>
  )
}
