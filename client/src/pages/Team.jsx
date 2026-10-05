import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, RotateCcw } from 'lucide-react'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { API_MODE } from '../lib/apiMode.js'
import { ROLE_LABELS } from '@rackium/shared/policy.js'

// Pending invitations for an Org Admin (all) or a PM (their projects). The server
// decides what appears; this page only renders it.
export default function Team() {
  const { memberships } = useAuth()
  const orgId = memberships[0]?.organisationId ?? null
  const canManage = memberships.some((m) => (m.level === 'organisation' && m.role === 'org_admin') || (m.level === 'project' && m.role === 'pm'))
  const [invitations, setInvitations] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    if (!orgId) return
    authApi
      .listInvitations(orgId)
      .then((r) => setInvitations(r.invitations))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load invitations.'))
  }, [orgId])

  useEffect(() => {
    if (API_MODE === 'real' && canManage) load()
  }, [canManage, load])

  if (API_MODE === 'mock') {
    return <Notice>Team management needs the backend. Set VITE_API_MODE=real to use it.</Notice>
  }
  if (!orgId || !canManage) {
    return <Notice>Only an Org Admin or a project PM can manage invitations.</Notice>
  }

  async function resend(id) {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      await authApi.resendInvitation(orgId, id)
      setNotice('Invitation sent again. The earlier link no longer works.')
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resend. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-text">Team</h1>
        <Link to="/" className="text-xs font-medium text-brand hover:underline">Back to Rackium</Link>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-text">Pending invitations</h2>
        {notice && <p role="status" className="text-xs text-status-green">{notice}</p>}
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        {invitations === null && !error && <p className="text-xs text-text-secondary">Loading…</p>}
        {invitations?.length === 0 && <p className="text-xs text-text-secondary">No invitations are waiting.</p>}
        <ul className="divide-y divide-border">
          {invitations?.map((inv) => (
            <li key={inv.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-medium text-text">
                  <Mail size={13} strokeWidth={2} className="shrink-0 text-text-secondary" />
                  <span className="truncate">{inv.email}</span>
                </div>
                <p className="text-xs text-text-secondary">
                  {ROLE_LABELS[inv.role] ?? inv.role} · {inv.level === 'organisation' ? 'Organisation' : 'Project'}
                  {inv.expired ? ' · expired, resend to renew' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => resend(inv.id)}
                disabled={busyId === inv.id}
                className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand disabled:opacity-60 sm:h-8"
              >
                <RotateCcw size={13} strokeWidth={2} />
                {busyId === inv.id ? 'Sending…' : 'Resend invitation'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Notice({ children }) {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-text-secondary">{children}</p>
    </div>
  )
}
