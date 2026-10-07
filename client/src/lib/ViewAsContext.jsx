import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { viewAsApi } from '../api/viewAsApi.js'
import { setViewAsSession } from './viewAsSession.js'

const ViewAsContext = createContext(null)
const STORAGE_KEY = 'rk_view_as'

// A plain page reload (or a new tab) re-executes all JS from scratch, which
// would otherwise silently drop the session with no sign to the viewer that
// it ended — sessionStorage survives a reload and is cleared when the tab
// closes, matching "session" (the server's own TTL and actorUserId binding
// are still what actually enforce it; this is only so the UI doesn't lie).
function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeStoredSession(session) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private browsing or storage disabled — the in-memory session still
    // works for the rest of this page load.
  }
}

// Org Admin only (brief, M2 approval): a view-only impersonation of a project
// role, bound to one project at a time. httpClient.js reads the active
// session straight from lib/viewAsSession.js; this context exists so the
// banner and disabled write controls re-render when it changes.
export function ViewAsProvider({ children }) {
  const [session, setSession] = useState(() => {
    const stored = readStoredSession()
    setViewAsSession(stored) // httpClient.js must see it before any request fires
    return stored
  })

  const start = useCallback(async (orgId, projectId, role) => {
    const { session: started } = await viewAsApi.start(orgId, projectId, role)
    const next = { id: started.id, orgId, projectId, viewedRole: started.viewedRole }
    setSession(next)
    setViewAsSession(next)
    writeStoredSession(next)
    return next
  }, [])

  const end = useCallback(async () => {
    setSession((current) => {
      if (current) viewAsApi.end(current.orgId, current.projectId, current.id).catch(() => {})
      return null
    })
    setViewAsSession(null)
    writeStoredSession(null)
  }, [])

  const value = useMemo(() => ({ session, start, end }), [session, start, end])
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}

export function useViewAs() {
  const ctx = useContext(ViewAsContext)
  if (!ctx) throw new Error('useViewAs must be used inside ViewAsProvider')
  return ctx
}
