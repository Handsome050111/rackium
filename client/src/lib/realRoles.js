import { can, canCreateProjects, ORG_ROLE } from '@rackium/shared/policy.js'

const inOrg = (orgId) => (m) => String(m.organisationId) === String(orgId)

// The roles a signed-in user holds for a context, in the form
// shared/policy.js's can() expects: the Org Admin role, plus the project
// role when a project is given. A 'member' organisation membership carries
// permissions, not a role. Mirrors the server's rolesIn(), so the client
// shows exactly the controls the API will accept.
export function rolesFor(memberships, orgId, projectId = null) {
  const roles = memberships.filter((m) => inOrg(orgId)(m) && m.level === 'organisation' && m.role === ORG_ROLE).map((m) => m.role)
  if (projectId) {
    roles.push(...memberships.filter((m) => inOrg(orgId)(m) && m.level === 'project' && String(m.projectId) === String(projectId)).map((m) => m.role))
  }
  return roles
}

export function canIn(memberships, orgId, projectId, action) {
  return can(rolesFor(memberships, orgId, projectId), action)
}

export function canCreateProjectsIn(memberships, orgId) {
  return canCreateProjects(memberships.find((m) => inOrg(orgId)(m) && m.level === 'organisation') ?? null)
}
