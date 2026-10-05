// API contracts (M1). Zod schemas shared by the server (request validation and
// OpenAPI generation) and the client. Field rules here are the only definition.
import { z } from 'zod'
import { ALL_ROLES, PROJECT_ROLES } from './policy.js'

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

export const projectCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits and hyphens only')
    .optional(),
})

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
