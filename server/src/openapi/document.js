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
