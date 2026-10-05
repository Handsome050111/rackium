import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell, { authInput, authButton } from '../components/auth/AuthShell.jsx'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'
import { useAuth } from '../lib/AuthContext.jsx'

// Accepting an invitation. A new person enters a name and a password to create
// their account. A person who already has an account enters their existing
// password, and the server links the membership to it.
export default function InviteAccept() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const organisationId = params.get('org') ?? ''
  const token = params.get('token') ?? ''
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!organisationId || !token) {
    return (
      <AuthShell title="Invitation">
        <p className="text-sm text-status-red">This invitation link is incomplete. Open the link from the email again.</p>
        <Link to="/login" className="block text-center text-sm font-medium text-brand hover:underline">Go to sign in</Link>
      </AuthShell>
    )
  }

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await authApi.acceptInvitation({ organisationId, token, name: name || undefined, password })
      signIn(result)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Accept your invitation">
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Your name (new accounts only)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={authInput} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Password (new account, or your existing password)</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </label>
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? 'Accepting…' : 'Accept invitation'}
        </button>
      </form>
    </AuthShell>
  )
}
