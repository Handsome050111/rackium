import { z } from 'zod'
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import * as C from '@rackium/shared/contracts.js'

extendZodWithOpenApi(z)

const json = (schema) => ({ 'application/json': { schema } })
const err = (description) => ({ description, content: json(C.errorResponse) })

// Every route is registered here from the same Zod schemas the server validates
// with, so the document cannot drift from the behaviour.
export function buildRegistry() {
  const registry = new OpenAPIRegistry()
  const ok = (description, schema) => ({ description, content: json(schema) })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/openapi.json',
    summary: 'This document',
    responses: { 200: ok('OpenAPI 3.0.3 document', z.any()) },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/health',
    summary: 'Liveness and database status',
    responses: { 200: ok('Healthy', C.healthResponse), 503: ok('Degraded', C.healthResponse) },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/signup',
    summary: 'Create an organisation and its Org Admin; sends a verification email',
    request: { body: { content: json(C.signUpBody) } },
    responses: { 202: ok('Accepted', C.accepted), 400: err('Invalid input'), 429: err('Rate limited') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/verify-email',
    summary: 'Confirm an email address',
    request: { body: { content: json(C.verifyEmailBody) } },
    responses: { 200: ok('Verified', z.object({ ok: z.boolean() })), 400: err('Link invalid or expired') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/login',
    summary: 'Sign in; sets httpOnly session cookies',
    request: { body: { content: json(C.loginBody) } },
    responses: { 200: ok('Signed in', C.meResponse), 401: err('Invalid credentials'), 403: err('Email not verified'), 429: err('Rate limited') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/refresh',
    summary: 'Rotate the refresh cookie and issue a new access cookie',
    responses: { 200: ok('Refreshed', C.meResponse), 401: err('Sign in again') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    summary: 'End this session',
    responses: { 204: { description: 'Signed out' } },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/password-reset/request',
    summary: 'Ask for a reset link (always accepted)',
    request: { body: { content: json(C.passwordResetRequestBody) } },
    responses: { 202: ok('Accepted', C.accepted), 429: err('Rate limited') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/password-reset/confirm',
    summary: 'Set a new password and end every session',
    request: { body: { content: json(C.passwordResetConfirmBody) } },
    responses: { 200: ok('Reset', z.object({ ok: z.boolean() })), 400: err('Link invalid or expired') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/invitations/accept',
    summary: 'Accept an invitation and sign in',
    request: { body: { content: json(C.inviteAcceptBody) } },
    responses: { 201: ok('Accepted', C.meResponse), 401: err('Password incorrect'), 409: err('Already a member') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/verify-email/resend',
    summary: 'Send a fresh verification link; earlier links stop working (always accepted)',
    request: { body: { content: json(C.resendVerificationBody) } },
    responses: { 202: ok('Accepted', C.accepted), 429: err('Rate limited') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/invitations',
    summary: 'Pending invitations the caller may act on (Org Admin: all; PM: their projects)',
    request: { params: z.object({ orgId: z.string() }) },
    responses: { 200: ok('Invitations', z.object({ invitations: z.array(z.any()) })), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/invitations/{invitationId}/resend',
    summary: 'Send a fresh invitation link; the earlier link stops working',
    request: { params: z.object({ orgId: z.string(), invitationId: z.string() }) },
    responses: { 200: ok('Resent', z.object({ invitation: z.any() })), 403: err('Forbidden'), 404: err('Not found or not pending'), 429: err('Rate limited') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/me',
    summary: 'The signed-in user and their memberships',
    responses: { 200: ok('Current user', C.meResponse), 401: err('Sign in required') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/members',
    summary: 'Members and their roles (Org Admin)',
    request: { params: z.object({ orgId: z.string() }) },
    responses: { 200: ok('Members', z.object({ members: z.array(z.any()) })), 403: err('Forbidden'), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/invitations',
    summary: 'Invite a person to the organisation or a project (Org Admin)',
    request: { params: z.object({ orgId: z.string() }), body: { content: json(C.inviteCreateBody) } },
    responses: { 201: ok('Invited', z.object({ invitation: z.any() })), 409: err('Already a member or already invited') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/memberships/{membershipId}',
    summary: 'Change a membership role or scopes (Org Admin)',
    request: { params: z.object({ orgId: z.string(), membershipId: z.string() }), body: { content: json(C.membershipUpdateBody) } },
    responses: { 200: ok('Updated', z.object({ membership: z.any() })) },
  })
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/orgs/{orgId}/memberships/{membershipId}',
    summary: 'Revoke a membership (Org Admin); the last Org Admin cannot be revoked',
    request: { params: z.object({ orgId: z.string(), membershipId: z.string() }) },
    responses: { 200: ok('Revoked', z.any()), 409: err('Last Org Admin') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects',
    summary: 'Projects in the organisation',
    request: { params: z.object({ orgId: z.string() }) },
    responses: { 200: ok('Projects', z.object({ projects: z.array(z.any()) })) },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects',
    summary: 'Create a project; the creator becomes its PM',
    request: { params: z.object({ orgId: z.string() }), body: { content: json(C.projectCreateBody) } },
    responses: { 201: ok('Created', z.object({ project: z.any() })), 409: err('Code already in use') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/audit',
    summary: 'Audit entries, newest first (policy: view audit log)',
    request: { params: z.object({ orgId: z.string() }), query: C.auditQuery },
    responses: { 200: ok('Entries', z.object({ entries: z.array(z.any()) })), 403: err('Forbidden') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}',
    summary: 'One project, with its hierarchy summary',
    request: { params: z.object({ orgId: z.string(), projectId: z.string() }) },
    responses: { 200: ok('Project', z.object({ project: z.any() })), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}',
    summary: 'General, work types, active phases (phase gating), or archive (Org Admin, PM)',
    request: { params: z.object({ orgId: z.string(), projectId: z.string() }), body: { content: json(C.projectUpdateBody) } },
    responses: { 200: ok('Updated', z.object({ project: z.any() })), 400: err('A phase with data cannot be removed'), 403: err('Forbidden') },
  })

  const projectParams = z.object({ orgId: z.string(), projectId: z.string() })
  const hierarchyIdParams = projectParams.extend({ id: z.string() })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/hierarchy',
    summary: 'The whole Country/SAL/Campus/Building/Wing/Floor/Room/Rack tree for this project',
    request: { params: projectParams },
    responses: { 200: ok('Tree', z.object({ tree: z.any() })), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/hierarchy/import',
    summary: 'Bulk-create hierarchy from flat CSV/Excel rows, one transaction (Org Admin, PM)',
    request: { params: projectParams, body: { content: json(C.hierarchyImportBody) } },
    responses: { 201: ok('Imported', z.object({ imported: z.any() })), 400: err('Some rows did not validate') },
  })

  const hierarchyLevels = [
    { path: 'countries', create: C.countryCreateBody, update: C.countryUpdateBody, label: 'Country', action: 'Org Admin, PM' },
    { path: 'sals', create: C.salCreateBody, label: 'SAL', action: 'Org Admin, PM' },
    { path: 'campuses', create: C.campusCreateBody, label: 'Campus', action: 'Org Admin, PM' },
    { path: 'buildings', create: C.buildingCreateBody, update: C.buildingUpdateBody, label: 'Building', action: 'Org Admin, PM' },
    { path: 'wings', create: C.wingCreateBody, label: 'Wing', action: 'Org Admin, PM' },
    { path: 'floors', create: C.floorCreateBody, update: C.floorUpdateBody, label: 'Floor', action: 'Org Admin, PM, Architect' },
    { path: 'rooms', create: C.roomCreateBody, update: C.roomUpdateBody, label: 'Room', action: 'Org Admin, PM, Architect' },
    { path: 'racks', create: C.rackCreateBody, update: C.rackUpdateBody, label: 'Rack', action: 'Org Admin, PM, Architect' },
  ]
  for (const level of hierarchyLevels) {
    registry.registerPath({
      method: 'post',
      path: `/api/v1/orgs/{orgId}/projects/{projectId}/hierarchy/${level.path}`,
      summary: `Create a ${level.label} (${level.action})`,
      request: { params: projectParams, body: { content: json(level.create) } },
      responses: { 201: ok('Created', z.object({ [level.path]: z.any() })), 400: err('Parent does not exist in this project'), 403: err('Forbidden') },
    })
    if (level.update) {
      registry.registerPath({
        method: 'patch',
        path: `/api/v1/orgs/{orgId}/projects/{projectId}/hierarchy/${level.path}/{id}`,
        summary: `Update a ${level.label} (${level.action})`,
        request: { params: hierarchyIdParams, body: { content: json(level.update) } },
        responses: { 200: ok('Updated', z.object({ [level.path]: z.any() })), 404: err('Not found') },
      })
    }
    registry.registerPath({
      method: 'delete',
      path: `/api/v1/orgs/{orgId}/projects/{projectId}/hierarchy/${level.path}/{id}`,
      summary: `Delete a ${level.label} (${level.action}); refused while it still has children`,
      request: { params: hierarchyIdParams },
      responses: { 200: ok('Deleted', z.object({ id: z.string(), deleted: z.boolean() })), 404: err('Not found'), 409: err('Still has children') },
    })
  }

  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/blockers',
    summary: 'Blockers raised against one building',
    request: { params: projectParams, query: z.object({ buildingId: z.string() }) },
    responses: { 200: ok('Blockers', z.object({ blockers: z.array(z.any()) })) },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/blockers',
    summary: 'Raise a blocker (any project role)',
    request: { params: projectParams, body: { content: json(C.blockerCreateBody) } },
    responses: { 201: ok('Raised', z.object({ blocker: z.any() })), 403: err('Forbidden') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/blockers/{id}',
    summary: 'Change status or owner, per the transition rules (owner/PM for most, anyone to reopen)',
    request: { params: hierarchyIdParams, body: { content: json(C.blockerUpdateBody) } },
    responses: { 200: ok('Updated', z.object({ blocker: z.any() })), 400: err('Not a valid transition'), 403: err('Forbidden') },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/dashboard/buildings/{buildingId}',
    summary: 'Real dashboard for one building: Quick Stats, blockers, recent activity',
    request: { params: projectParams.extend({ buildingId: z.string() }) },
    responses: { 200: ok('Dashboard', z.object({ building: z.any(), phases: z.any(), kpis: z.any(), blockers: z.any(), recentActivity: z.any() })), 404: err('Not found') },
  })

  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/view-as',
    summary: 'Start a View As session (Org Admin only), bound to the caller, 1-hour TTL',
    request: { params: projectParams, body: { content: json(C.viewAsStartBody) } },
    responses: { 201: ok('Started', z.object({ session: z.any() })), 403: err('Forbidden') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/view-as/{sessionId}/end',
    summary: 'End a View As session',
    request: { params: projectParams.extend({ sessionId: z.string() }) },
    responses: { 200: ok('Ended', z.object({ id: z.string(), ended: z.boolean() })), 404: err('Not found or already ended') },
  })

  return registry
}

export function buildOpenApiDocument({ version }) {
  const generator = new OpenApiGeneratorV3(buildRegistry().definitions)
  return generator.generateDocument({
    openapi: '3.0.3',
    info: { title: 'Rackium API', version, description: 'Generated from the Zod contracts in @rackium/shared.' },
    servers: [{ url: '/' }],
  })
}
