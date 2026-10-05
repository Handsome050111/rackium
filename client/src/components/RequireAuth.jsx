import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

// Real mode only: a signed-out visitor is sent to sign-in and returned here after.
// Mock mode is always signed in, so the prototype's screens are unaffected.
export default function RequireAuth({ children }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  if (status === 'signed_out') {
    const next = encodeURIComponent(`${location.pathname}${location.search}`)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return children
}
