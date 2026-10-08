import { can } from '@rackium/shared/policy.js'

// The roles a signed-in user holds for a context, in the form
// shared/policy.js's can() expects: the organisation role, plus the project
// role when a project is given. Mirrors the server's rolesIn(), so the
// client shows exactly the controls the API will accept.
export function rolesFor(memberships, orgId, projectId = null) {
  const inOrg = (m) => String(m.organisationId) === String(orgId)
  const roles = memberships.filter((m) => inOrg(m) && m.level === 'organisation').map((m) => m.role)
  if (projectId) {
    roles.push(...memberships.filter((m) => inOrg(m) && m.level === 'project' && String(m.projectId) === String(projectId)).map((m) => m.role))
  }
  return roles
}

export function canIn(memberships, orgId, projectId, action) {
  return can(rolesFor(memberships, orgId, projectId), action)
}
