// API contracts (M1). Zod schemas shared by the server (request validation and
// OpenAPI generation) and the client. Field rules here are the only definition.
import { z } from 'zod'
import { ALL_ROLES, PROJECT_ROLES } from './policy.js'
import { PHASE_KEYS } from './phaseCalculations.js'

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

// Emails are trimmed and lower-cased before any comparison or storage.
const email = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email())

const password = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)

const personName = z.string().trim().min(1).max(120)
const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Expected a 24-character hex id')
const token = z.string().min(20).max(200)

export const scopeSchema = z.object({
  type: z.enum(['country', 'sal', 'building']),
  refId: objectId,
})

export const signUpBody = z.object({
  organisationName: z.string().trim().min(1).max(120),
  name: personName,
  email,
  password,
})

export const verifyEmailBody = z.object({ token })

export const resendVerificationBody = z.object({ email })

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
})

export const passwordResetRequestBody = z.object({ email })

export const passwordResetConfirmBody = z.object({ token, password })

// Accepting an invitation: a new user supplies name and password; an existing
// user supplies their current password to link the membership.
export const inviteAcceptBody = z.object({
  organisationId: objectId,
  token,
  name: personName.optional(),
  password: z.string().min(1).max(PASSWORD_MAX),
})

export const inviteCreateBody = z
  .object({
    email,
    role: z.enum(ALL_ROLES),
    projectId: objectId.optional(),
    scopes: z.array(scopeSchema).max(100).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.projectId && !PROJECT_ROLES.includes(value.role)) {
      ctx.addIssue({ code: 'custom', path: ['role'], message: 'Project invitations need a project role' })
    }
    if (!value.projectId && value.role !== 'org_admin') {
      ctx.addIssue({ code: 'custom', path: ['role'], message: 'Organisation invitations are for Org Admin only' })
    }
    if (!value.projectId && value.scopes.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['scopes'], message: 'Scopes apply to project memberships only' })
    }
  })

export const membershipUpdateBody = z
  .object({
    role: z.enum(ALL_ROLES).optional(),
    scopes: z.array(scopeSchema).max(100).optional(),
  })
  .refine((value) => value.role !== undefined || value.scopes !== undefined, {
    message: 'Provide role or scopes',
  })

// Codes below this point go into a hostname (brief §7), so they are short and
// hostname-safe: letters and digits only.
const hierarchyCode = z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, '1-10 letters or digits, no spaces or punctuation')
const placeName = z.string().trim().min(1).max(120)

const hierarchyImportPlanBody = z
  .object({
    countries: z.array(z.object({ code: hierarchyCode, name: placeName })).max(50).default([]),
    sals: z.array(z.object({ countryCode: hierarchyCode, code: hierarchyCode })).max(200).default([]),
    campuses: z.array(z.object({ countryCode: hierarchyCode, salCode: hierarchyCode, code: hierarchyCode })).max(500).default([]),
    buildings: z
      .array(z.object({ countryCode: hierarchyCode, salCode: hierarchyCode, campusCode: hierarchyCode, code: hierarchyCode, name: placeName }))
      .max(1000)
      .default([]),
    wings: z
      .array(z.object({ countryCode: hierarchyCode, salCode: hierarchyCode, campusCode: hierarchyCode, buildingCode: hierarchyCode, code: hierarchyCode, name: placeName }))
      .max(1000)
      .default([]),
  })
  .default({ countries: [], sals: [], campuses: [], buildings: [], wings: [] })

const workTypeEntry = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  isPredefined: z.boolean(),
})

// One wizard submission is one transaction: project, hierarchy and team
// invitations are all created together; invitation emails are sent only
// after it commits (M2).
export const projectCreateBody = z.object({
  name: placeName,
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens only')
    .optional(),
  clientName: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  workTypes: z.array(workTypeEntry).max(40).default([]),
  // DATA-MODEL §3.2 default: all nine phases, in order.
  activePhaseKeys: z.array(z.enum(PHASE_KEYS)).min(1).max(PHASE_KEYS.length).default(PHASE_KEYS),
  hierarchy: hierarchyImportPlanBody,
  team: z
    .array(z.object({ email, role: z.enum(PROJECT_ROLES), scopes: z.array(scopeSchema).max(20).default([]) }))
    .max(50)
    .default([]),
})

export const activePhasesUpdateBody = z.object({
  phaseKeys: z.array(z.enum(PHASE_KEYS)).min(1).max(PHASE_KEYS.length),
})

// Project Settings: General, Work types & phases, Danger zone (archive).
// Hierarchy and Members & permissions have their own endpoints.
export const projectUpdateBody = z
  .object({
    name: placeName.optional(),
    clientName: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    workTypes: z.array(workTypeEntry).max(40).optional(),
    activePhaseKeys: z.array(z.enum(PHASE_KEYS)).min(1).max(PHASE_KEYS.length).optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' })

// Hierarchy CRUD, used by Project Settings -> Hierarchy once the project
// exists. Create bodies name the parent; update bodies only the editable
// fields (moving a node to a different parent is not supported in M2).
export const countryCreateBody = z.object({ code: hierarchyCode, name: placeName })
export const countryUpdateBody = z.object({ name: placeName })

export const salCreateBody = z.object({ countryId: objectId, code: hierarchyCode })

export const campusCreateBody = z.object({ salId: objectId, code: hierarchyCode })

export const buildingCreateBody = z.object({ campusId: objectId, code: hierarchyCode, name: placeName, siteSize: z.enum(['S']).default('S') })
export const buildingUpdateBody = z.object({ name: placeName.optional(), siteSize: z.enum(['S']).optional() })

export const wingCreateBody = z.object({ buildingId: objectId, code: hierarchyCode, name: placeName, order: z.coerce.number().int().min(0).default(0) })
export const wingUpdateBody = z.object({ name: placeName.optional(), order: z.coerce.number().int().min(0).optional() })

export const floorCreateBody = z.object({
  buildingId: objectId,
  wingId: objectId.nullable().optional(),
  token: z.string().trim().min(1).max(20),
  name: placeName,
  order: z.coerce.number().int().min(0),
})
export const floorUpdateBody = z.object({ token: z.string().trim().min(1).max(20).optional(), name: placeName.optional(), order: z.coerce.number().int().min(0).optional() })

export const roomCreateBody = z.object({ floorId: objectId, code: z.string().trim().min(1).max(40), name: placeName.optional(), isMainRoom: z.boolean().default(false) })
export const roomUpdateBody = z.object({ name: placeName.optional(), isMainRoom: z.boolean().optional() })

export const rackCreateBody = z.object({ roomId: objectId, code: z.string().trim().min(1).max(20), heightU: z.coerce.number().int().positive() })
export const rackUpdateBody = z.object({ heightU: z.coerce.number().int().positive().optional() })

export const hierarchyImportBody = z.object({ rows: z.array(z.record(z.string(), z.string())).min(1).max(2000) })

export const blockerCreateBody = z.object({
  buildingId: objectId,
  phaseKey: z.enum(PHASE_KEYS),
  description: z.string().trim().min(1).max(500),
  relatedObjectType: z.string().trim().max(60).optional(),
  relatedObjectId: objectId.optional(),
  ownerId: objectId.optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
})
export const blockerUpdateBody = z
  .object({
    status: z.enum(['open', 'in_progress', 'resolved']).optional(),
    ownerId: objectId.nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.ownerId !== undefined, { message: 'Provide status or ownerId' })

export const viewAsStartBody = z.object({ projectId: objectId, role: z.enum(PROJECT_ROLES) })

export const auditQuery = z.object({
  projectId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const errorResponse = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
})

export const userSummary = z.object({
  id: objectId,
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
})

export const membershipSummary = z.object({
  id: objectId,
  organisationId: objectId,
  projectId: objectId.nullable(),
  level: z.enum(['organisation', 'project']),
  role: z.enum(ALL_ROLES),
  scopes: z.array(scopeSchema),
})

export const meResponse = z.object({
  user: userSummary,
  memberships: z.array(membershipSummary),
})

export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
})

export const accepted = z.object({
  message: z.string(),
})
