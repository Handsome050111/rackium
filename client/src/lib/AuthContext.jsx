import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, DEMO_USER } from '../api/authApi.js'
import { API_MODE } from './apiMode.js'

const AuthContext = createContext(null)

const initialState = () =>
  API_MODE === 'mock'
    ? { status: 'signed_in', user: DEMO_USER, memberships: [] }
    : { status: 'loading', user: null, memberships: [] }

// Holds the signed-in view. In mock mode it is always signed in as the demo user,
// so no screen changes. In real mode it asks the server who is signed in on load.
export function AuthProvider({ children }) {
  const [state, setState] = useState(initialState)

  useEffect(() => {
    if (API_MODE !== 'real') return undefined
    let active = true
    authApi
      .me()
      .then((r) => active && setState({ status: 'signed_in', user: r.user, memberships: r.memberships }))
      .catch(() => active && setState({ status: 'signed_out', user: null, memberships: [] }))
    return () => {
      active = false
    }
  }, [])

  const signIn = useCallback((result) => setState({ status: 'signed_in', user: result.user, memberships: result.memberships }), [])

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setState({ status: API_MODE === 'mock' ? 'signed_in' : 'signed_out', user: API_MODE === 'mock' ? DEMO_USER : null, memberships: [] })
  }, [])

  const value = useMemo(() => ({ ...state, mode: API_MODE, signIn, signOut }), [state, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
