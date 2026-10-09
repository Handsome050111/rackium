import { useAuth } from './AuthContext.jsx'
import { useViewAs } from './ViewAsContext.jsx'
import { rolesFor } from './realRoles.js'

// The caller's roles in a project, as the server sees them: under View As
// the viewed role only, and read-only (the server refuses every write).
export function useProjectRoles(orgId, projectId) {
  const { memberships } = useAuth()
  const { session } = useViewAs()
  const viewing = session && String(session.projectId) === String(projectId)
  const roles = viewing ? [session.viewedRole] : rolesFor(memberships, orgId, projectId)
  return { roles, readOnly: Boolean(viewing), has: (role) => roles.includes(role) }
}
