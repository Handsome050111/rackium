import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock, FlaskConical } from 'lucide-react'
import AuthShell, { authInput, authButton } from '../components/auth/AuthShell.jsx'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { API_MODE } from '../lib/apiMode.js'

const safeNext = (value) => (value && value.startsWith('/') && !value.startsWith('//') ? value : '/b/b001')

// Mock mode keeps the prototype's demo entry. Real mode signs in with the API.
export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (API_MODE === 'mock') {
    return (
      <AuthShell title="Sign in">
        <div className="flex items-center gap-1.5 rounded-lg bg-status-amber/10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-amber">
          <FlaskConical size={12} strokeWidth={2} />
          Demo build — sign-in is not functional yet
        </div>
        <button type="button" onClick={() => navigate(next)} className={authButton}>
          Continue to demo
        </button>
      </AuthShell>
    )
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authApi.login({ email, password })
      signIn(result)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          <p>
            New here? <Link to="/signup" className="font-medium text-brand hover:underline">Create an organisation</Link>
          </p>
          <p>
            <Link to="/password-reset" className="font-medium text-brand hover:underline">Forgot your password?</Link>
          </p>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Email</span>
          <div className="relative">
            <Mail size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${authInput} pl-9`} />
          </div>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Password</span>
          <div className="relative">
            <Lock size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${authInput} pl-9`} />
          </div>
        </label>
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  )
}
