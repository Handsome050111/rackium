import { useState } from 'react'
import { Link } from 'react-router-dom'
import { signUpBody } from '@rackium/shared/contracts.js'
import AuthShell, { authInput, authButton } from '../components/auth/AuthShell.jsx'
import ResendVerification from '../components/auth/ResendVerification.jsx'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'

// Creates an organisation and its Org Admin. The response never says whether the
// email was already registered, so this page cannot be used to find accounts.
export default function SignUp() {
  const [form, setForm] = useState({ organisationName: '', name: '', email: '', password: '' })
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(event) {
    event.preventDefault()
    setError(null)
    const check = signUpBody.safeParse(form)
    if (!check.success) {
      setError(check.error.issues[0].message)
      return
    }
    setBusy(true)
    try {
      await authApi.signUp(check.data)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email">
        <p className="text-sm text-text-secondary">We have sent a confirmation link. Open it to activate your account, then sign in.</p>
        <ResendVerification email={form.email} />
        <Link to="/login" className="block text-center text-sm font-medium text-brand hover:underline">Go to sign in</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create your organisation" footer={<p>Already have an account? <Link to="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Organisation name</span>
          <input required value={form.organisationName} onChange={set('organisationName')} className={authInput} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Your name</span>
          <input required value={form.name} onChange={set('name')} className={authInput} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Work email</span>
          <input type="email" autoComplete="username" required value={form.email} onChange={set('email')} className={authInput} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">Password (12 characters or more)</span>
          <input type="password" autoComplete="new-password" required value={form.password} onChange={set('password')} className={authInput} />
        </label>
        {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? 'Creating…' : 'Create organisation'}
        </button>
      </form>
    </AuthShell>
  )
}
