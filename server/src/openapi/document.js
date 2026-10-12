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
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/members/{userId}/project-creation',
    summary: 'Grant or revoke project creation for an organisation member (Org Admin); audited',
    request: { params: z.object({ orgId: z.string(), userId: z.string() }), body: { content: json(C.projectCreationBody) } },
    responses: {
      200: ok('Updated', z.object({ userId: z.string(), canCreateProjects: z.boolean() })),
      403: err('Forbidden'),
      404: err('Not a member of this organisation'),
      409: err('An Org Admin can always create projects'),
    },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/settings',
    summary: 'Organisation settings (any member)',
    request: { params: z.object({ orgId: z.string() }) },
    responses: { 200: ok('Settings', z.object({ settings: z.object({ architectsSeePrices: z.boolean() }) })), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/settings',
    summary: 'Change organisation settings (Org Admin); audited',
    request: { params: z.object({ orgId: z.string() }), body: { content: json(C.organisationSettingsBody) } },
    responses: { 200: ok('Updated', z.object({ settings: z.object({ architectsSeePrices: z.boolean() }) })), 403: err('Forbidden') },
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
    summary: 'Create a project (Org Admin, or a member granted project creation); the creator becomes its PM in the same transaction',
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

  // --- M3a: catalogue (organisation level) ---
  const orgParams = z.object({ orgId: z.string() })
  const catalogueItemParams = orgParams.extend({ id: z.string() })
  const catalogueListResponse = z.object({ items: z.array(z.any()), vendors: z.array(z.string()), total: z.number(), pricesVisible: z.boolean() })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/catalogue',
    summary: 'Browse the effective catalogue (seeded, SERVON, organisation, and project layer when projectId is given); prices only for roles that may see them',
    request: { params: orgParams, query: C.catalogueQuery },
    responses: { 200: ok('Items', catalogueListResponse), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/catalogue/{id}',
    summary: 'One catalogue item with its expanded port list and the layers that define it',
    request: { params: catalogueItemParams, query: C.catalogueItemQuery },
    responses: { 200: ok('Item', z.object({ item: z.any(), ports: z.array(z.any()), layers: z.array(z.any()), effectiveId: z.string(), pricesVisible: z.boolean() })), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/catalogue',
    summary: 'Add an organisation catalogue item (Org Admin)',
    request: { params: orgParams, body: { content: json(C.catalogueItemBody) } },
    responses: { 201: ok('Created', z.object({ item: z.any() })), 403: err('Forbidden'), 409: err('Already in the organisation catalogue') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/catalogue/{id}',
    summary: 'Replace an organisation catalogue item (Org Admin); seeded items are read-only',
    request: { params: catalogueItemParams, body: { content: json(C.catalogueItemBody) } },
    responses: { 200: ok('Updated', z.object({ item: z.any() })), 403: err('Forbidden or read-only'), 404: err('Not found') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/catalogue/import',
    summary: 'CSV import into the organisation layer (Org Admin): re-validated server-side, all rows or none',
    request: { params: orgParams, body: { content: json(C.catalogueImportBody) } },
    responses: { 201: ok('Imported', z.object({ imported: z.object({ created: z.number(), updated: z.number() }) })), 400: err('Rows did not validate'), 403: err('Forbidden') },
  })

  // --- M3a: CMO import (project level) ---
  registry.registerPath({
    method: 'get',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/cmo',
    summary: 'CMO inventory: imported devices, Unassigned devices, KPIs, and CMO status per building',
    request: { params: projectParams },
    responses: { 200: ok('CMO context', z.object({ sals: z.any(), buildings: z.any(), devices: z.any(), kpis: z.any(), lastImportAt: z.any() })) },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/cmo/preview',
    summary: 'Validate mapped CMO rows against the project (serial registry, MACs, hostnames, buildings); writes nothing',
    request: { params: projectParams, body: { content: json(C.cmoImportBody) } },
    responses: { 200: ok('Validated rows', z.object({ salId: z.string(), rows: z.array(z.any()), summary: z.any() })), 403: err('Forbidden') },
  })
  registry.registerPath({
    method: 'post',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/cmo/import',
    summary: 'Commit a CMO import (Org Admin, PM): batch, devices, serial registry and Unassigned blockers in one transaction',
    request: { params: projectParams, body: { content: json(C.cmoImportBody) } },
    responses: { 201: ok('Committed', z.object({ batchId: z.string(), salId: z.string(), summary: z.any() })), 400: err('Nothing importable'), 403: err('Forbidden'), 409: err('Conflict') },
  })
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/orgs/{orgId}/projects/{projectId}/cmo/devices/{deviceId}/assignment',
    summary: 'Assign an Unassigned device to a building in its SAL (PM); resolves its blocker',
    request: { params: projectParams.extend({ deviceId: z.string() }), body: { content: json(C.cmoAssignBody) } },
    responses: { 200: ok('Assigned', z.object({ device: z.any() })), 400: err('Wrong SAL'), 403: err('Forbidden'), 404: err('Not found'), 409: err('Already assigned') },
  })

  // --- M3b: Physical Site Survey and files (project level; every route checks the caller's building scope) ---
  const S = '/api/v1/orgs/{orgId}/projects/{projectId}/survey'
  const F = '/api/v1/orgs/{orgId}/projects/{projectId}/files'
  const p = (extra = {}) => projectParams.extend(Object.fromEntries(Object.keys(extra).map((k) => [k, z.string()])))
  const any = (description) => ok(description, z.any())
  const route = (method, path, summary, { params = p(), body, query, status = 200, errors = {} } = {}) =>
    registry.registerPath({
      method,
      path,
      summary,
      request: { params, ...(body ? { body: { content: json(body) } } : {}), ...(query ? { query } : {}) },
      responses: { [status]: any(summary), 403: err('Forbidden'), 404: err('Not found or outside your scope'), ...errors },
    })
  route('get', `${S}/buildings/{buildingId}/structure`, 'Site structure of one building: floors, rooms (survey facts, photo count), racks, pathways, validation findings', { params: p({ buildingId: 1 }) })
  route('get', `${S}/buildings/{buildingId}/campus-structure`, 'Site structure of every in-scope building of the same campus', { params: p({ buildingId: 1 }) })
  route('post', `${S}/floors`, 'Add a floor (Field Engineer within scope, PM, Architect, Org Admin)', { body: C.floorCreateBody, status: 201 })
  route('post', `${S}/rooms`, 'Add a room; the code is generated when omitted (TR-<floor>-NN)', { body: C.surveyRoomCreateBody, status: 201 })
  route('post', `${S}/racks`, 'Add a rack; the code is generated when omitted (R0N); height must be an allowed rack height', { body: C.surveyRackCreateBody, status: 201 })
  route('patch', `${S}/rooms/{roomId}/survey`, 'Room survey facts: access, power, environment', { params: p({ roomId: 1 }), body: C.roomSurveyBody })
  route('get', `${S}/pathways`, "All the project's pathways, in the shape the shared cable-length engine reads")
  route('post', `${S}/pathways`, 'Add a pathway between two rooms (also across buildings)', { body: C.pathwayCreateBody, status: 201, errors: { 409: err('Already connected') } })
  route('patch', `${S}/pathways/{pathwayId}`, 'Route status (surveyed/estimated) and distance', { params: p({ pathwayId: 1 }), body: C.pathwayUpdateBody })
  route('delete', `${S}/pathways/{pathwayId}`, 'Remove a pathway', { params: p({ pathwayId: 1 }) })
  route('get', `${S}/racks/{rackId}`, 'Rack survey: placements, reserved/blocked RUs, facts, calculated readiness, the building’s CMO devices', { params: p({ rackId: 1 }) })
  route('patch', `${S}/racks/{rackId}/placements`, 'Replace the rack’s existing gear (Field Engineer); validated with the shared rack rules; serials/MACs via the registry', { params: p({ rackId: 1 }), body: C.rackPlacementsBody, errors: { 400: err('Overlap, boundary or identity problem'), 409: err('Serial or MAC already used') } })
  route('post', `${S}/racks/{rackId}/versions`, 'Save version (Field Engineer): bumps the rack revision', { params: p({ rackId: 1 }), status: 201 })
  route('patch', `${S}/racks/{rackId}/facts`, 'Rack survey facts (depth, PDUs, cable path, accessibility)', { params: p({ rackId: 1 }), body: C.rackFactsBody })
  route('post', `${S}/racks/{rackId}/ru-states`, 'Reserve an RU (Architect) or block it (PM, Org Admin)', { params: p({ rackId: 1 }), body: C.ruStateBody, status: 201, errors: { 409: err('RU occupied') } })
  route('delete', `${S}/racks/{rackId}/ru-states/{stateId}`, 'Release a reservation (Architect) or a block (PM, Org Admin)', { params: p({ rackId: 1, stateId: 1 }) })
  route('get', `${S}/records`, 'One survey tab record, with calculated values, completeness and status', { query: C.surveyRecordQuery })
  route('post', `${S}/records/edits`, 'One edit (last save wins; a conflict is reported). Verified/Imported tabs revert to Draft', { body: C.surveyEditBody, errors: { 409: err('Tab submitted, or row gone') } })
  route('post', `${S}/records/transitions`, 'Submit (Field Engineer), verify or reject (Architect)', { body: C.surveyTransitionBody, errors: { 409: err('Not a valid transition') } })
  route('get', `${S}/buildings/{buildingId}/progress`, 'Every expected tab of the building with its status, and the survey phase status', { params: p({ buildingId: 1 }) })
  route('post', `${S}/import`, 'Import the verified building survey into HLD (Architect, PM)', { body: C.surveyImportBody, errors: { 409: err('Not every tab is verified') } })
  route('get', `${S}/serials/check`, 'Check a serial against the building CMO and the project serial registry', { query: z.object({ buildingId: z.string(), serial: z.string() }) })
  route('get', `${S}/custom-fields`, 'Organisation custom fields of a tab', { query: z.object({ tab: z.string() }) })
  route('post', `${S}/custom-fields`, 'Add an organisation custom field (Org Admin)', { body: C.surveyCustomFieldBody, status: 201 })
  route('post', `${S}/sync`, 'Replay offline edits in queued order, each in its own transaction; idempotent by opId; conflicts reported', { body: C.surveySyncBody })
  route('post', `${F}/uploads`, 'Start (or resume) a chunked upload; limits from organisation settings', { body: C.uploadStartBody, status: 201, errors: { 413: err('Too large') } })
  route('get', `${F}/uploads/{fileId}`, 'How much of an upload has arrived (to resume)', { params: p({ fileId: 1 }) })
  route('patch', `${F}/uploads/{fileId}`, 'Append a chunk (application/octet-stream) at ?offset=', { params: p({ fileId: 1 }), query: z.object({ offset: z.string() }), errors: { 409: err('Offset mismatch: resume from receivedBytes') } })
  route('post', `${F}/uploads/{fileId}/complete`, 'Finish: size, SHA-256 and content type are checked; photos get a thumbnail', { params: p({ fileId: 1 }), status: 201, errors: { 415: err('Not an accepted type'), 422: err('Checksum mismatch') } })
  route('get', F, 'Files attached to a room, rack, pathway or survey tab', { query: z.object({ type: z.string(), id: z.string().optional(), buildingId: z.string().optional(), roomId: z.string().optional(), tab: z.string().optional() }) })
  route('get', `${F}/{fileId}`, 'File metadata', { params: p({ fileId: 1 }) })
  route('get', `${F}/{fileId}/content`, 'Download the file (authorised; no public URL)', { params: p({ fileId: 1 }) })
  route('get', `${F}/{fileId}/thumbnail`, 'Download the photo thumbnail', { params: p({ fileId: 1 }) })
  route('delete', `${F}/{fileId}`, 'Remove a file (soft delete)', { params: p({ fileId: 1 }) })

  // --- M4a: HLD (every design write carries baseRevision; a stale one is 409 stale_revision) ---
  const H = '/api/v1/orgs/{orgId}/projects/{projectId}/hld'
  const stale = { 409: err('Stale revision, or the HLD is submitted and locked') }
  route('get', `${H}/library`, 'HLD library: roles with hostname codes and catalogue models, optics, blueprint presets')
  route('get', `${H}/buildings/{buildingId}`, 'The HLD of a building: survey rooms and racks, devices, uplinks with lengths, positions, revision, approvals, survey-change flags', { params: p({ buildingId: 1 }) })
  route('get', `${H}/buildings/{buildingId}/validation`, 'Run the validation engine (VAL-001…013 and the listed checks): findings by severity', { params: p({ buildingId: 1 }) })
  route('post', `${H}/generate`, 'Generate HLD from the verified survey and a blueprint preset (Architect); adds only what is missing', { body: C.hldGenerateBody, status: 201, errors: stale })
  route('post', `${H}/devices`, 'Add a planned device from the library (Architect); hostname from the organisation naming codes', { body: C.hldDeviceCreateBody, status: 201, errors: stale })
  route('patch', `${H}/devices/{id}`, 'Change a planned device’s model or configured PSUs (Architect)', { params: p({ id: 1 }), body: C.hldDeviceUpdateBody, errors: stale })
  route('delete', `${H}/devices/{id}`, 'Delete a planned device and its uplinks (Architect); ports released, cable IDs retired', { params: p({ id: 1 }), query: C.hldRevisionQuery, errors: stale })
  route('put', `${H}/devices/{id}/position`, 'Move a device on the canvas (positions are stored apart from the design)', { params: p({ id: 1 }), body: C.hldPositionBody })
  route('post', `${H}/uplinks/check`, 'Edit Uplink step 4: check a draft uplink with the validation rules', { body: C.hldUplinkCheckBody })
  route('post', `${H}/uplinks`, 'Create an uplink (Architect); ports and cable ID registered in the same transaction', { body: C.hldUplinkCreateBody, status: 201, errors: { 409: err('Port or cable ID in use, or stale revision') } })
  route('patch', `${H}/uplinks/{id}`, 'Edit Uplink / Change Medium (Architect)', { params: p({ id: 1 }), body: C.hldUplinkUpdateBody, errors: { 409: err('Port or cable ID in use, or stale revision') } })
  route('delete', `${H}/uplinks/{id}`, 'Delete an uplink (Architect)', { params: p({ id: 1 }), query: C.hldRevisionQuery, errors: stale })
  route('post', `${H}/submit`, 'Submit the HLD for approval (Architect): refused while any Critical finding is open; creates the version and the approval', { body: C.hldSubmitBody, status: 201, errors: { 409: err('Critical findings, stale revision or already submitted') } })
  route('post', `${H}/decision`, 'Approve or request changes (PM or Reviewer, never the submitter); approval freezes the version', { body: C.hldDecisionBody, errors: { 409: err('Not awaiting approval') } })

  // --- M4b: LLD, Rackium Editor, versions and branches (stale writes are 409 stale_revision) ---
  const L = '/api/v1/orgs/{orgId}/projects/{projectId}/lld'
  const lstale = { 409: err('Stale revision, the LLD is submitted, or the branch is closed') }
  const taken = { 409: err('Port or cable ID in use, or stale revision') }
  route('get', `${L}/buildings/{buildingId}`, 'The LLD of a building (or one of its branches): racks with RU states, devices with ports and occupancy, connections with lengths, versions, branches, approvals, HLD baseline', { params: p({ buildingId: 1 }), query: C.lldViewQuery })
  route('get', `${L}/buildings/{buildingId}/validation`, 'HLD rules plus the LLD checks (ports, cable IDs, RU placement, hops)', { params: p({ buildingId: 1 }), query: C.lldViewQuery })
  route('get', `${L}/buildings/{buildingId}/reconciliation`, 'Side-by-side HLD vs LLD: devices and uplinks only in the HLD, only in the LLD, or changed', { params: p({ buildingId: 1 }) })
  route('post', `${L}/start`, 'Start the LLD from the latest approved HLD (Architect): a working copy of its devices and uplinks', { body: C.lldStartBody, status: 201, errors: { 409: err('HLD not approved, or LLD already started') } })
  route('post', `${L}/rebase`, 'Mark the LLD reviewed against the latest approved HLD (Architect)', { body: C.lldRebaseBody, errors: lstale })
  route('post', `${L}/copy-from-hld`, 'Copy chosen HLD devices and uplinks into the LLD (Architect); no automatic re-sync', { body: C.lldCopyBody, errors: lstale })
  route('post', `${L}/devices`, 'Add a patch panel, cable manager or accessory to a rack (Architect); rack rules enforced', { body: C.lldDeviceCreateBody, status: 201, errors: lstale })
  route('put', `${L}/devices/{id}/placement`, 'Place or unplace a device by rack, RU and face (Architect); rack rules enforced', { params: p({ id: 1 }), body: C.lldPlacementBody, errors: lstale })
  route('delete', `${L}/devices/{id}`, 'Delete an LLD device and its connections (Architect); ports released, cable IDs retired', { params: p({ id: 1 }), query: C.hldRevisionQuery, errors: lstale })
  route('post', `${L}/connections`, 'Create a connection with ports, hops and cable IDs (Architect); registries written in one transaction', { body: C.lldConnectionCreateBody, status: 201, errors: taken })
  route('patch', `${L}/connections/{id}`, 'Rackium Editor: ports, patch-panel hops, cable IDs, media, Engineer Selected length (Architect)', { params: p({ id: 1 }), body: C.lldConnectionUpdateBody, errors: taken })
  route('delete', `${L}/connections/{id}`, 'Delete a connection (Architect); ports released, cable IDs retired', { params: p({ id: 1 }), query: C.hldRevisionQuery, errors: lstale })
  route('post', `${L}/rename/preview`, 'Preview a hostname rename (Architect or PM): old → new, with problems', { body: C.lldRenamePreviewBody })
  route('post', `${L}/rename`, 'Rename hostnames in one transaction with audit (Architect or PM); refused once the LLD is approved', { body: C.lldRenameBody, errors: { 409: err('Conflict, stale revision or change request required') } })
  route('post', `${L}/versions`, 'Save a labelled version of the LLD or a branch (Architect)', { body: C.lldVersionBody, status: 201 })
  route('get', `${L}/versions/diff`, 'Diff two versions (or the current design): devices and connections added, removed and changed', { query: C.lldDiffQuery })
  route('post', `${L}/versions/{id}/restore`, 'Restore a version into the LLD or a branch (Architect); the version itself is unchanged', { params: p({ id: 1 }), body: C.lldRestoreBody, errors: lstale })
  route('post', `${L}/branches`, 'Create a branch from the current LLD or a version (Architect)', { body: C.lldBranchBody, status: 201 })
  route('post', `${L}/branches/{id}/promote`, 'Promote a branch: it replaces the main LLD (Architect); no merge', { params: p({ id: 1 }), body: C.lldBranchPromoteBody, errors: lstale })
  route('post', `${L}/branches/{id}/discard`, 'Discard a branch (Architect)', { params: p({ id: 1 }), errors: lstale })
  route('post', `${L}/submit`, 'Submit the LLD for approval (Architect): refused while any Critical finding is open', { body: C.lldSubmitBody, status: 201, errors: { 409: err('Critical findings, stale revision or already submitted') } })
  route('post', `${L}/decision`, 'Approve or request changes on the LLD (PM or Reviewer, never the submitter); approval freezes the version', { body: C.lldDecisionBody, errors: { 409: err('Not awaiting approval') } })

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
