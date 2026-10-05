import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/auth/AuthShell.jsx'
import { authApi } from '../api/authApi.js'
import { ApiError } from '../api/httpClient.js'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [state, setState] = useState(token ? 'verifying' : 'invalid')
  const [message, setMessage] = useState(null)

  useEffect(() => {
    if (!token) return undefined
    let active = true
    authApi
      .verifyEmail(token)
      .then(() => active && setState('done'))
      .catch((err) => {
        if (!active) return
        setMessage(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
        setState('failed')
      })
    return () => {
      active = false
    }
  }, [token])

  return (
    <AuthShell title="Confirm your email">
      {state === 'verifying' && <p className="text-sm text-text-secondary">Confirming your address…</p>}
      {state === 'done' && <p className="text-sm text-text-secondary">Your email is confirmed. You can sign in now.</p>}
      {state === 'failed' && <p role="alert" className="text-sm text-status-red">{message}</p>}
      {state === 'invalid' && <p className="text-sm text-status-red">This link is incomplete. Open the link from the email again.</p>}
      <Link to="/login" className="block text-center text-sm font-medium text-brand hover:underline">Go to sign in</Link>
    </AuthShell>
  )
}
