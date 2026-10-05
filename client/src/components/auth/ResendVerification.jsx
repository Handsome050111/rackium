import { useState } from 'react'
import { authApi } from '../../api/authApi.js'
import { ApiError } from '../../api/httpClient.js'

// Sends a fresh confirmation link. Earlier links stop working, and the reply does
// not say whether the address has a pending account.
export default function ResendVerification({ email }) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState(null)

  async function resend() {
    setState('sending')
    setError(null)
    try {
      await authApi.resendVerification(email)
      setState('sent')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
      setState('idle')
    }
  }

  return (
    <div className="space-y-2">
      {state === 'sent' ? (
        <p className="text-xs text-text-secondary">
          If that address is waiting for confirmation, a new link is on its way. Earlier links no longer work.
        </p>
      ) : (
        <button type="button" onClick={resend} disabled={!email || state === 'sending'} className="h-10 w-full rounded-lg border border-border text-sm font-medium text-text hover:border-brand disabled:opacity-60">
          {state === 'sending' ? 'Sending…' : 'Resend verification email'}
        </button>
      )}
      {error && <p role="alert" className="text-xs text-status-red">{error}</p>}
    </div>
  )
}
