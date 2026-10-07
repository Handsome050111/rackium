import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { viewAsApi } from '../api/viewAsApi.js'
import { setViewAsSession } from './viewAsSession.js'

const ViewAsContext = createContext(null)

// Org Admin only (brief, M2 approval): a view-only impersonation of a project
// role, bound to one project at a time. httpClient.js reads the active
// session straight from lib/viewAsSession.js; this context exists so the
// banner and disabled write controls re-render when it changes.
export function ViewAsProvider({ children }) {
  const [session, setSession] = useState(null) // { id, orgId, projectId, viewedRole } | null

  const start = useCallback(async (orgId, projectId, role) => {
    const { session: started } = await viewAsApi.start(orgId, projectId, role)
    const next = { id: started.id, orgId, projectId, viewedRole: started.viewedRole }
    setSession(next)
    setViewAsSession(next)
    return next
  }, [])

  const end = useCallback(async () => {
    setSession((current) => {
      if (current) viewAsApi.end(current.orgId, current.projectId, current.id).catch(() => {})
      return null
    })
    setViewAsSession(null)
  }, [])

  const value = useMemo(() => ({ session, start, end }), [session, start, end])
  return <ViewAsContext.Provider value={value}>{children}</ViewAsContext.Provider>
}

export function useViewAs() {
  const ctx = useContext(ViewAsContext)
  if (!ctx) throw new Error('useViewAs must be used inside ViewAsProvider')
  return ctx
}
