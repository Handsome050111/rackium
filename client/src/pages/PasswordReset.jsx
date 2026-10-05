import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import AuthShell, { authInput, authButton } from '../components/auth/AuthShell.jsx'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'
import { PASSWORD_MIN } from '@rackium/shared/contracts.js'

// Asks for a reset link. The reply is the same whether or not the address has an account.
export function PasswordResetRequest() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setError(null)
    try {
      await authApi.requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <p className="text-sm text-text-secondary">If an account exists for that address, a reset link is on its way.</p>
        <Link to="/login" className="block text-center text-sm font-medium text-brand hover:underline">Back to sign in</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Reset your password" footer={<Link to="/login" className="font-medium text-brand hover:underline">Back to sign in</Link>}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
        </label>
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        <button type="submit" className={authButton}>Send reset link</button>
      </form>
    </AuthShell>
  )
}

// Sets a new password from an emailed link. Every existing session ends.
export function PasswordResetConfirm() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError(null)
    if (password.length < PASSWORD_MIN) return setError(`Use at least ${PASSWORD_MIN} characters`)
    if (password !== confirm) return setError('The two passwords do not match')
    setBusy(true)
    try {
      await authApi.confirmPasswordReset(token, password)
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">New password</span>
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Confirm new password</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </label>
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        <button type="submit" disabled={busy} className={authButton}>Set password</button>
      </form>
    </AuthShell>
  )
}
