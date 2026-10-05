// Response shapes for identities and memberships. The contract lives in
// shared/src/contracts.js; these functions build values that satisfy it.
export const userSummary = (user) => ({
  id: String(user._id),
  email: user.email,
  name: user.name,
  emailVerified: Boolean(user.emailVerifiedAt),
})

export const membershipSummary = (m) => ({
  id: String(m._id),
  organisationId: String(m.organisationId),
  projectId: m.projectId ? String(m.projectId) : null,
  level: m.level,
  role: m.role,
  scopes: (m.scopes ?? []).map((s) => ({ type: s.type, refId: String(s.refId) })),
})
