import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Lock, XCircle, FileDown } from 'lucide-react'
import { ApprovalShell as Shell } from '../components/clientApproval/ApprovalParts.jsx'
import { publicApprovalApi } from '../api/deliveryApi.js'
import { publicDownload, FORMAT_LABEL, humanSize } from '../api/documentsApi.js'

const inputClass = 'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20'
const CLOSED = { expired: 'This download link has expired.', revoked: 'This download link was withdrawn.', link_not_found: 'This download link does not exist.' }

// Documents shared by a time-limited download link (M6b): no login; a
// password when the link has one.
export default function RealDocumentDownload() {
  const { token } = useParams()
  const [status, setStatus] = useState(null)
  const [password, setPassword] = useState('')
  const [subject, setSubject] = useState(null)
  const [error, setError] = useState(null)

  const open = useCallback(
    async (pw) => {
      try {
        setSubject(await publicApprovalApi.view(token, pw))
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    },
    [token]
  )
  useEffect(() => {
    publicApprovalApi
      .status(token)
      .then((s) => {
        setStatus(s)
        if (s.status === 'active' && !s.passwordRequired) open('')
      })
      .catch((err) => setStatus({ status: err.code === 'link_not_found' ? 'link_not_found' : 'error', message: err.message }))
  }, [token, open])

  if (!status) return <Shell><p className="text-sm text-text-secondary">Loading…</p></Shell>
  if (status.status !== 'active' || status.kind !== 'document_download') {
    return (
      <Shell>
        <div className="flex items-center gap-3 rounded-xl border border-status-red/30 bg-status-red/5 p-6 text-status-red" role="alert">
          <XCircle size={24} strokeWidth={2} className="shrink-0" />
          <div>
            <div className="font-semibold">These documents are no longer available.</div>
            <div className="text-sm">{CLOSED[status.status] ?? status.message ?? 'Please ask your project contact for a new link.'}</div>
          </div>
        </div>
      </Shell>
    )
  }
  if (!subject) {
    return (
      <Shell>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            open(password)
          }}
          className="space-y-4 rounded-xl border border-border bg-surface p-6"
        >
          <div className="flex items-center gap-2 text-lg font-semibold text-text">
            <Lock size={20} strokeWidth={2} className="text-brand" /> Documents — password required
          </div>
          <input type="password" autoFocus aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={inputClass} />
          {error && (
            <p className="text-xs text-status-red" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={!password} className="h-10 w-full rounded-lg bg-brand text-sm font-medium text-white hover:bg-brand/90 disabled:bg-status-grey">
            Show documents
          </button>
        </form>
      </Shell>
    )
  }
  return (
    <Shell>
      <div className="space-y-4 rounded-xl border border-border bg-surface p-6" data-testid="download-list">
        <div className="flex items-center gap-2 text-lg font-semibold text-text">
          <FileDown size={20} strokeWidth={2} className="text-brand" /> {subject.label ?? 'Documents'} — {subject.building.code} {subject.building.name}
        </div>
        <p className="text-sm text-text-secondary">
          {[subject.project.clientName, subject.project.name].filter(Boolean).join(' · ')} · available until {new Date(subject.expiresAt).toLocaleDateString()}
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {subject.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 text-text">
                {d.name} <span className="text-text-secondary">v{d.version} · {FORMAT_LABEL[d.format]} · {humanSize(d.sizeBytes)}</span>
              </span>
              <button
                type="button"
                onClick={() => publicDownload(token, d.id, password, d.fileName).catch((err) => setError(err.message))}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand"
              >
                <Download size={13} strokeWidth={2} /> Download
              </button>
            </li>
          ))}
        </ul>
        {error && (
          <p className="text-xs text-status-red" role="alert">
            {error}
          </p>
        )}
      </div>
    </Shell>
  )
}
