// API contracts (M1). Zod schemas shared by the server (request validation and
// OpenAPI generation) and the client. Field rules here are the only definition.
import { DEFAULT_ROLE_CODES, ROLE_CODE_PATTERN, duplicateRoleCodes, resolveRoleCodes, HLD_ROLE_KEYS } from './hldRoles.js'
import { BLUEPRINT_KEYS } from './hldBlueprints.js'
import { z } from 'zod'
import { ALL_ROLES, PROJECT_ROLES, ORG_MEMBER_ROLE } from './policy.js'
import { PHASE_KEYS } from './phaseCalculations.js'
import { catalogueItemSchema, CATEGORY_GROUPS, CATALOGUE_CATEGORIES, OPTIC_MEDIA } from './catalogue.js'

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

// --- M3b: site structure, rack survey, survey forms, files, sync ---------
const nonNegInt = z.number().int().min(0).max(100000)
// During the survey a room or rack may be added with a generated code
// (TR-<floor>-NN, R0N), as in the prototype.
export const surveyRoomCreateBody = z.object({ floorId: objectId, code: z.string().trim().min(1).max(40).optional(), name: placeName.optional() })
export const surveyRackCreateBody = z.object({ roomId: objectId, code: z.string().trim().min(1).max(20).optional(), heightU: z.coerce.number().int().positive().default(42) })
export const roomSurveyBody = z
  .object({
    access: z.enum(['verified', 'not_verified']).optional(),
    power: z.enum(['available', 'not_available', 'unknown']).optional(),
    environment: z.enum(['verified', 'to_verify', 'issue', 'unknown']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one survey fact' })

const sockets = z.object({ totalSockets: nonNegInt, freeSockets: nonNegInt }).nullable()
export const rackFactsBody = z.object({
  details: z
    .object({
      type: z.string().trim().max(60).nullable(),
      standard: z.string().trim().max(60).nullable(),
      externalDepthMm: nonNegInt.nullable(),
      usableDepthMm: nonNegInt.nullable(),
      railDistanceMm: nonNegInt.nullable(),
      condition: z.string().trim().max(60).nullable(),
    })
    .partial()
    .optional(),
  mountingPower: z
    .object({
      cageNutType: z.string().trim().max(30).nullable(),
      availableCageNutSets: nonNegInt.nullable(),
      mountingRails: z.string().trim().max(60).nullable(),
      redundantPower: z.enum(['available', 'not_available']).nullable(),
      earthingVerified: z.boolean().nullable(),
      pduA: sockets,
      pduB: sockets,
    })
    .partial()
    .optional(),
  cablePath: z
    .object({
      mainCableEntry: z.string().trim().max(120).nullable(),
      pathway: z.string().trim().max(120).nullable(),
      secondaryEntry: z.string().trim().max(120).nullable(),
      verticalManagers: nonNegInt.nullable(),
      horizontalManagers: nonNegInt.nullable(),
    })
    .partial()
    .optional(),
  accessibility: z
    .object({
      front: z.enum(['accessible', 'not_accessible']).nullable(),
      rear: z.enum(['accessible', 'not_accessible']).nullable(),
      left: z.enum(['accessible', 'not_accessible']).nullable(),
      right: z.enum(['accessible', 'not_accessible']).nullable(),
      frontClearanceMm: nonNegInt.nullable(),
      rearClearanceMm: nonNegInt.nullable(),
    })
    .partial()
    .optional(),
})

export const pathwayCreateBody = z.object({
  fromRoomId: objectId,
  toRoomId: objectId,
  routeStatus: z.enum(['surveyed', 'estimated']).default('estimated'),
  distanceM: z.number().positive().max(100000).nullable().default(null),
})
export const pathwayUpdateBody = z
  .object({ routeStatus: z.enum(['surveyed', 'estimated']).optional(), distanceM: z.number().positive().max(100000).nullable().optional() })
  .refine((v) => v.routeStatus !== undefined || v.distanceM !== undefined, { message: 'Provide routeStatus or distanceM' })

// One rack's existing gear, replaced as a whole on every (auto)save. A
// placement with deviceId moves that device (a CMO device of the building, or
// one placed earlier); without it a new existing device is recorded.
export const rackPlacementBody = z.object({
  deviceId: objectId.nullable().default(null),
  ru: z.number().int().min(0).max(60),
  heightU: z.number().int().min(0).max(60),
  face: z.enum(['front', 'rear']),
  fullDepth: z.boolean().default(false),
  mounting: z.enum(['rack', '0U']).default('rack'),
  railSide: z.enum(['left', 'right']).nullable().default(null),
  category: z.string().trim().max(60).nullable().default(null),
  label: z.string().trim().min(1).max(120),
  sublabel: z.string().trim().max(120).nullable().default(null),
  // Identity: omitted = keep what the device has; null = clear it.
  catalogueKey: z.string().trim().max(200).nullable().optional(),
  hostname: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serial: z.string().trim().max(120).nullable().optional(),
  mac: z.string().trim().max(40).nullable().optional(),
})
export const rackPlacementsBody = z.object({ placements: z.array(rackPlacementBody).max(200) })
export const ruStateBody = z.object({
  ru: z.number().int().min(1).max(60),
  face: z.enum(['front', 'rear', 'both']),
  state: z.enum(['reserved', 'blocked']),
  reason: z.string().trim().max(200).nullable().default(null),
})

const surveyTarget = { buildingId: objectId, roomId: objectId.nullable().default(null), tab: z.string().trim().min(1).max(80) }
const surveyOp = z.object({
  kind: z.enum(['setField', 'confirmField', 'addRow', 'duplicateRow', 'removeRow']),
  sectionIndex: z.number().int().min(0).max(20),
  key: z.string().trim().max(120).optional(),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null(), z.object({ fileIds: z.array(objectId).max(50) })]).optional(),
  confirmed: z.boolean().optional(),
  rowId: objectId.optional(),
  newRowId: objectId.optional(),
  rackId: objectId.optional(),
  rowKey: z.string().trim().max(120).optional(),
})
export const surveyEditBody = z.object({ ...surveyTarget, op: surveyOp, baseLastModifiedAt: z.string().datetime().nullable().default(null) })
export const surveyTransitionBody = z.object({ ...surveyTarget, action: z.enum(['submit', 'verify', 'reject']), reason: z.string().trim().max(1000).default('') })
export const surveyRecordQuery = z.object({ buildingId: objectId, roomId: objectId.optional(), tab: z.string().trim().min(1).max(80) })
export const surveyImportBody = z.object({ buildingId: objectId })
export const surveySyncBody = z.object({
  edits: z
    .array(
      z.object({
        opId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
        queuedAt: z.string().datetime(),
        ...surveyTarget,
        op: surveyOp,
        baseLastModifiedAt: z.string().datetime().nullable().default(null),
      })
    )
    .min(1)
    .max(500),
})
export const surveyCustomFieldBody = z.object({
  tab: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'number', 'yes_no']).default('text'),
})

export const FILE_CATEGORIES = ['photo_room', 'photo_rack', 'photo_reference', 'photo_device_label', 'evidence', 'document']
export const fileAttachment = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surveyTab'), ...surveyTarget }),
  z.object({ type: z.literal('room'), id: objectId }),
  z.object({ type: z.literal('rack'), id: objectId }),
  z.object({ type: z.literal('pathway'), id: objectId }),
])
export const uploadStartBody = z.object({
  // Chosen by the client so an offline edit can reference the photo before it uploads.
  fileId: objectId,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(3).max(100),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.enum(FILE_CATEGORIES),
  attachedTo: fileAttachment,
  capturedAt: z.string().datetime().nullable().default(null),
  caption: z.string().trim().max(200).nullable().default(null),
})

// --- Organisation-level permissions and settings (M3a review) -------------
export const projectCreationBody = z.object({ allowed: z.boolean() })
// Hostname role codes (brief §6.6; M4a): per role, 1-4 upper-case letters or
// digits, distinct across roles. Omitted roles keep their default.
export const namingRoleCodesSchema = z
  .partialRecord(z.enum(Object.keys(DEFAULT_ROLE_CODES)), z.string().trim().toUpperCase().regex(ROLE_CODE_PATTERN, 'Use 1 to 4 letters or digits'))
  .superRefine((codes, ctx) => {
    for (const message of duplicateRoleCodes(resolveRoleCodes(codes))) ctx.addIssue({ code: 'custom', message })
  })
export const organisationSettingsBody = z
  .object({ architectsSeePrices: z.boolean().optional(), namingRoleCodes: namingRoleCodesSchema.optional() })
  .refine((b) => b.architectsSeePrices !== undefined || b.namingRoleCodes !== undefined, { message: 'Nothing to update' })

// --- M3a: catalogue -------------------------------------------------------
// Create and replace take the whole item (shared/src/catalogue.js is the one
// definition of an item's fields and rules).
export const catalogueItemBody = catalogueItemSchema
export const catalogueQuery = z.object({
  projectId: objectId.optional(),
  q: z.string().trim().max(120).optional(),
  group: z.enum(CATEGORY_GROUPS.map((g) => g.key)).optional(),
  category: z.enum(CATALOGUE_CATEGORIES).optional(),
  vendor: z.string().trim().max(80).optional(),
  minPorts: z.coerce.number().int().min(1).max(1024).optional(),
  poe: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  speed: z.string().trim().max(20).optional(),
})
export const catalogueItemQuery = z.object({ projectId: objectId.optional() })
export const catalogueImportBody = z.object({ rows: z.array(z.record(z.string(), z.string())).min(1).max(2000) })

// --- M3a: CMO import ------------------------------------------------------
const cmoCell = z.string().trim().max(200).nullable().default(null)
export const cmoRow = z.object({
  rowIndex: z.number().int().min(0),
  hostname: cmoCell,
  model: cmoCell,
  serial: cmoCell,
  mac: cmoCell,
  building: cmoCell,
  floor: cmoCell,
  room: cmoCell,
  rack: cmoCell,
  ru: cmoCell,
})
export const cmoImportBody = z.object({
  // The SAL that rows without a known building land in (Unassigned).
  // Optional only when the project has exactly one SAL.
  salId: objectId.optional(),
  fileName: z.string().trim().max(255).optional(),
  rows: z.array(cmoRow).min(1).max(5000),
})
export const cmoAssignBody = z.object({ buildingId: objectId })

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
  role: z.enum([...ALL_ROLES, ORG_MEMBER_ROLE]),
  scopes: z.array(scopeSchema),
  canCreateProjects: z.boolean().nullable(),
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

// --- M4a: HLD -----------------------------------------------------------------
// Every design write carries the revision the client loaded (brief §6.10): a
// write based on an older revision is refused, never merged.
const baseRevision = z.number().int().min(0)
export const HLD_SPEEDS = ['1G', '2.5G', '10G', '25G', '40G', '100G']
const hldEnd = z.object({ deviceId: objectId, portId: z.string().trim().min(1).max(40).nullable().optional() })
const uplinkFields = {
  source: hldEnd,
  dest: hldEnd,
  media: z.enum(OPTIC_MEDIA),
  speed: z.enum(HLD_SPEEDS),
  sourceSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  destSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  viaPatchPanel: z.boolean().optional(),
}
export const hldGenerateBody = z.object({ buildingId: objectId, preset: z.enum(BLUEPRINT_KEYS), baseRevision })
export const hldDeviceCreateBody = z.object({ buildingId: objectId, role: z.enum(HLD_ROLE_KEYS), roomId: objectId, catalogueKey: z.string().trim().min(1).max(200).optional(), baseRevision })
export const hldDeviceUpdateBody = z
  .object({ catalogueKey: z.string().trim().min(1).max(200).optional(), psuConfigured: z.number().int().min(0).max(8).optional(), baseRevision })
  .refine((b) => b.catalogueKey !== undefined || b.psuConfigured !== undefined, { message: 'Nothing to update' })
export const hldUplinkCreateBody = z.object({ buildingId: objectId, ...uplinkFields, cableId: z.string().trim().min(1).max(32).nullable().optional(), baseRevision })
export const hldUplinkUpdateBody = z.object({
  source: hldEnd.optional(),
  dest: hldEnd.optional(),
  media: z.enum(OPTIC_MEDIA).optional(),
  speed: z.enum(HLD_SPEEDS).optional(),
  sourceSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  destSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  viaPatchPanel: z.boolean().optional(),
  cableId: z.string().trim().min(1).max(32).nullable().optional(),
  baseRevision,
})
export const hldUplinkCheckBody = z.object({ buildingId: objectId, connectionId: objectId.optional(), ...uplinkFields })
export const hldPositionBody = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) })
export const hldRevisionQuery = z.object({ baseRevision: z.coerce.number().int().min(0) })
export const hldSubmitBody = z.object({ buildingId: objectId, baseRevision })
export const hldDecisionBody = z.object({ buildingId: objectId, decision: z.enum(['approved', 'changes_requested']), comment: z.string().trim().max(2000).optional() })
