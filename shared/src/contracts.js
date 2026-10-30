// API contracts (M1). Zod schemas shared by the server (request validation and
// OpenAPI generation) and the client. Field rules here are the only definition.
import { DEFAULT_ROLE_CODES, ROLE_CODE_PATTERN, duplicateRoleCodes, resolveRoleCodes, HLD_ROLE_KEYS } from './hldRoles.js'
import { BLUEPRINT_KEYS, BLUEPRINT_VARIANT_KEYS, blueprintProblem } from './hldBlueprints.js'
import { z } from 'zod'
import { ALL_ROLES, PROJECT_ROLES, ORG_MEMBER_ROLE } from './policy.js'
import { PHASE_KEYS } from './phaseCalculations.js'
import { NOTIFICATION_TYPE_KEYS, DELIVERY_MODE_KEYS, TASK_STATUSES, TASK_RELATED_TYPES } from './notifications.js'
import { isValidTimeZone } from './timeZone.js'
import { isLocalDate, STANDARD_MILESTONE_KEYS } from './schedule.js'
import { catalogueItemSchema, CATEGORY_GROUPS, CATALOGUE_CATEGORIES, OPTIC_MEDIA } from './catalogue.js'
import { REPORT_KEYS, REPORT_FORMATS, SCHEDULE_FREQUENCIES } from './reports.js'
import { CMO_DECISIONS, MODE_LABEL_MAX } from './modeState.js'
import { RULE_OPERATORS, RULE_SEVERITIES, ruleProblems } from './customRules.js'

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

// socketType (M5a, brief §6.7): the PDU socket decides the power cord.
const sockets = z.object({ totalSockets: nonNegInt, freeSockets: nonNegInt, socketType: z.enum(['C13', 'C19']).nullable().optional() }).nullable()
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
  // The name or label recorded on site (fix/cmo-naming-gaps): free text, no
  // naming pattern. Omitted = keep; null or empty = clear.
  existingLabel: z.string().trim().max(120).nullable().optional(),
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

export const FILE_CATEGORIES = ['photo_room', 'photo_rack', 'photo_reference', 'photo_device_label', 'evidence', 'document', 'certificate']
export const fileAttachment = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surveyTab'), ...surveyTarget }),
  z.object({ type: z.literal('room'), id: objectId }),
  z.object({ type: z.literal('rack'), id: objectId }),
  z.object({ type: z.literal('pathway'), id: objectId }),
  z.object({ type: z.literal('device'), id: objectId }),
  z.object({ type: z.literal('deploymentException'), id: objectId }),
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
// Cable stock lengths (brief §6.3, configurable by the Org Admin; M4b): the
// whole table, each list ascending, positive metres.
const lengthList = z
  .array(z.number().positive().max(10000))
  .min(1)
  .max(20)
  .refine((l) => l.every((v, i) => i === 0 || v > l[i - 1]), 'Lengths must be in ascending order without repeats')
export const stockLengthsSchema = z.object({
  cat6a: z.object({ 'same-rack': lengthList, 'same-room': lengthList, 'cross-room': lengthList }),
  os2: lengthList,
  om4: lengthList,
  dac: lengthList,
  stack: lengthList,
})
// Cage nuts per RU on each face a device is fixed to (M5a review).
export const cageNutsPerRuSchema = z.object({ front: z.number().int().min(0).max(20), rear: z.number().int().min(0).max(20) })
// The organisation's time zone (IANA name) and the daily digest's local send time (M5b review).
export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, 'Not a time zone (use an IANA name such as Europe/Berlin)')
// DGUV V3 intervals (brief §6.9; M6a): months between inspections and the
// two warning windows in days ("Expiring" within "Expiring soon").
export const dguvSettingsSchema = z
  .object({ intervalMonths: z.number().int().min(1).max(120), expiringSoonDays: z.number().int().min(1).max(365), expiringDays: z.number().int().min(1).max(365) })
  .refine((d) => d.expiringDays <= d.expiringSoonDays, { message: '"Expiring" must be at most "Expiring soon"', path: ['expiringDays'] })
export const digestTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)')
// The state labels (M7b-4a, DATA-MODEL §5.21): CMO / IMO / FMO by default; null clears an override.
const modeLabel = z.string().trim().min(1, 'A label needs 1 to 24 characters').max(MODE_LABEL_MAX, 'A label needs 1 to 24 characters').nullable().optional()
export const modeLabelsSchema = z.object({ current: modeLabel, interim: modeLabel, future: modeLabel }).strict()
export const projectModeLabelsBody = z
  .object({ modeLabels: modeLabelsSchema })
  .strict()
  .refine((b) => Object.values(b.modeLabels).some((v) => v !== undefined), { message: 'Nothing to update' })
export const organisationSettingsBody = z
  .object({ modeLabels: modeLabelsSchema.optional(), architectsSeePrices: z.boolean().optional(), namingRoleCodes: namingRoleCodesSchema.optional(), stockLengths: stockLengthsSchema.optional(), cageNutsPerRu: cageNutsPerRuSchema.optional(), timeZone: timeZoneSchema.optional(), digestTime: digestTimeSchema.optional(), dguv: dguvSettingsSchema.optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' })

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
  vendor: cmoCell,
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

// The audit log screen (M5b): filters, newest first, cursor pagination (`before` = the previous page's nextBefore).
const dayField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
export const auditFilters = {
  projectId: objectId.optional(),
  from: dayField.optional(),
  to: dayField.optional(),
  userId: objectId.optional(),
  action: z.string().trim().min(1).max(80).regex(/^[a-z_.]+$/, 'Letters, dots and underscores').optional(),
  module: z.string().trim().min(1).max(40).optional(),
  objectType: z.string().trim().min(1).max(60).optional(),
  buildingId: objectId.optional(),
  changeType: z.string().trim().min(1).max(40).optional(),
}
export const auditQuery = z.object({
  ...auditFilters,
  before: z.string().regex(/^[0-9TZ:.-]+_[a-f0-9]{24}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export const auditExportQuery = z.object(auditFilters)
export const auditEntryQuery = z.object({ projectId: objectId.optional() })

// --- M5b: tasks and notifications ------------------------------------------
const deadlineField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
export const taskCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  relatedObjectType: z.enum(TASK_RELATED_TYPES).nullable().optional(),
  relatedObjectId: z.string().trim().min(1).max(40).nullable().optional(),
  buildingId: objectId.nullable().optional(),
  assignedTo: objectId,
  deadline: deadlineField.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})
export const taskUpdateBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    assignedTo: objectId.optional(),
    deadline: deadlineField.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' })
export const taskListQuery = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  assignedTo: z.union([objectId, z.literal('me')]).optional(),
  buildingId: objectId.optional(),
  relatedObjectType: z.enum(TASK_RELATED_TYPES).optional(),
  relatedObjectId: z.string().trim().min(1).max(40).optional(),
  overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
})
export const myTasksQuery = z.object({ status: z.enum(TASK_STATUSES).optional(), includeComplete: z.enum(['true', 'false']).transform((v) => v === 'true').optional() })
export const tasksFromResourcesBody = z.object({
  buildingId: objectId,
  roomCodes: z.array(z.string().trim().min(1).max(40)).max(200).optional(),
  taskIds: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  assignedTo: objectId,
  deadline: deadlineField.nullable().optional(),
})
export const notificationListQuery = z.object({
  tab: z.enum(['all', 'unread', 'mentions']).default('all'),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export const notificationPreferencesBody = z.object({ modes: z.partialRecord(z.enum(NOTIFICATION_TYPE_KEYS), z.enum(DELIVERY_MODE_KEYS)) })

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

export const clientConfigResponse = z.object({ banner: z.string().nullable(), signupEnabled: z.boolean() })
export const healthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  app: z.literal('up'),
  database: z.enum(['up', 'down']),
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
  // Interim (IMO) or future (FMO, the default) — M7b-4a, DATA-MODEL §5.21.
  modeState: z.enum(['interim', 'future']).optional(),
}
// preset = blueprint size; variant = topology variant (default: the size's own).
export const hldGenerateBody = z
  .object({ buildingId: objectId, preset: z.enum(BLUEPRINT_KEYS), variant: z.enum(BLUEPRINT_VARIANT_KEYS).optional(), baseRevision })
  .superRefine((b, ctx) => {
    const problem = blueprintProblem(b.preset, b.variant)
    if (problem) ctx.addIssue({ code: 'custom', path: ['variant'], message: problem })
  })
const designMode = z.enum(['interim', 'future'])
export const hldDeviceCreateBody = z.object({ buildingId: objectId, role: z.enum(HLD_ROLE_KEYS), roomId: objectId, branchId: objectId.optional(), catalogueKey: z.string().trim().min(1).max(200).optional(), modeState: designMode.optional(), baseRevision })
export const hldDeviceUpdateBody = z
  .object({ catalogueKey: z.string().trim().min(1).max(200).optional(), psuConfigured: z.number().int().min(0).max(8).optional(), modeState: designMode.optional(), baseRevision })
  .refine((b) => b.catalogueKey !== undefined || b.psuConfigured !== undefined || b.modeState !== undefined, { message: 'Nothing to update' })
export const hldUplinkCreateBody = z.object({ buildingId: objectId, branchId: objectId.optional(), ...uplinkFields, cableId: z.string().trim().min(1).max(32).nullable().optional(), baseRevision })
export const hldUplinkUpdateBody = z.object({
  source: hldEnd.optional(),
  dest: hldEnd.optional(),
  media: z.enum(OPTIC_MEDIA).optional(),
  speed: z.enum(HLD_SPEEDS).optional(),
  sourceSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  destSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  viaPatchPanel: z.boolean().optional(),
  cableId: z.string().trim().min(1).max(32).nullable().optional(),
  modeState: designMode.optional(),
  baseRevision,
})
export const hldUplinkCheckBody = z.object({ buildingId: objectId, connectionId: objectId.optional(), branchId: objectId.optional(), ...uplinkFields })
export const hldPositionBody = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) })
export const hldRevisionQuery = z.object({ baseRevision: z.coerce.number().int().min(0) })
// A change request's branch of the HLD (M5a review); omitted = the main HLD.
export const hldViewQuery = z.object({ branchId: objectId.optional() })
export const hldSubmitBody = z.object({ buildingId: objectId, baseRevision })
export const hldDecisionBody = z.object({ buildingId: objectId, decision: z.enum(['approved', 'changes_requested']), comment: z.string().trim().max(2000).optional() })

// --- M7b-3: the HLD design tools (DATA-MODEL §5.20; addendum v2.3 Q1) ---------
// Break: the reason is kept with the archived link.
export const hldBreakBody = z.object({ reason: z.string().trim().min(1, 'Give the reason for breaking the uplink').max(300), baseRevision }).strict()
// Reroute: same ends, another route — via the destination room's patch panel
// or direct, and/or through other rooms in order (empty = the direct pathway).
export const hldRerouteBody = z
  .object({ viaPatchPanel: z.boolean().optional(), viaRoomIds: z.array(objectId).max(10).optional(), baseRevision })
  .strict()
  .refine((b) => b.viaPatchPanel !== undefined || b.viaRoomIds !== undefined, { message: 'Choose the patch-panel routing or the rooms to route through' })
// Replace Endpoint: a new cable ID by default; keepCableId keeps the old one.
export const hldReplaceEndpointBody = z
  .object({ end: z.enum(['source', 'dest']), deviceId: objectId, portId: z.string().trim().min(1).max(40).nullable().optional(), keepCableId: z.boolean().optional(), baseRevision })
  .strict()
// Split: an existing device or a new one (role and room) goes into the link.
export const hldSplitBody = z
  .object({
    deviceId: objectId.optional(),
    newDevice: z.object({ role: z.enum(HLD_ROLE_KEYS), roomId: objectId, catalogueKey: z.string().trim().min(1).max(200).optional() }).strict().optional(),
    ports: z.object({ towardSource: z.string().trim().min(1).max(40).optional(), towardDest: z.string().trim().min(1).max(40).optional() }).strict().optional(),
    baseRevision,
  })
  .strict()
  .refine((b) => Boolean(b.deviceId) !== Boolean(b.newDevice), { message: 'Name the device to insert, or describe a new one — one of the two' })
// Merge: the joined link's medium and speed default to the first link's.
export const hldMergeBody = z.object({ media: z.enum(OPTIC_MEDIA).optional(), speed: z.enum(HLD_SPEEDS).optional(), baseRevision }).strict()

// --- M7b-5: custom validation rules (DATA-MODEL §3.11) -------------------------
// The allowlists and the typed value are checked by ruleProblems, the builder's own check.
const validationRuleFields = z
  .object({
    name: z.string().trim().min(1, 'Name the rule').max(120),
    object: z.string(),
    subjectRole: z.string().nullable().optional(),
    field: z.string(),
    operator: z.enum(RULE_OPERATORS),
    value: z.union([z.string().trim().max(200), z.number(), z.boolean(), z.array(z.string().trim().max(200)).max(50)]).nullable().optional(),
    severity: z.enum(RULE_SEVERITIES),
    message: z.string().trim().max(300).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
const checkRule = (rule, ctx, prefix = []) => {
  for (const { path, message } of ruleProblems(rule)) ctx.addIssue({ code: 'custom', path: [...prefix, path], message })
}
export const validationRuleBody = validationRuleFields.superRefine((rule, ctx) => checkRule(rule, ctx))
export const validationRuleEnabledBody = z.object({ enabled: z.boolean() }).strict()
export const validationRulePreviewBody = z.object({ buildingId: objectId, rule: validationRuleFields }).strict().superRefine((b, ctx) => checkRule(b.rule, ctx, ['rule']))

// --- M7b-4b: after cutover (DATA-MODEL §5.22) ----------------------------------
// Removing interim kit or replaced/removed CMO gear; the PM keeping CMO gear on
// site at handover (a reason is mandatory; null withdraws it).
export const cutoverRemovalBody = z.object({ note: z.string().trim().max(500).optional() }).strict()
export const oldGearOverrideBody = z.object({ reason: z.string().trim().min(1, 'Give the reason the gear stays on site').max(500).nullable() }).strict()

// --- M7b-4a: decisions on existing (CMO) gear (DATA-MODEL §5.21) --------------
// Keep (a role for its new name), Replace (by a device of the design) or
// Remove. Existing gear is shared by every design, so a branch is named.
export const hldCmoDecisionBody = z
  .object({ decision: z.enum(CMO_DECISIONS), role: z.enum(HLD_ROLE_KEYS).optional(), replacedById: objectId.optional(), branchId: objectId.optional(), baseRevision })
  .strict()
  .superRefine((b, ctx) => {
    if (b.decision === 'keep' && !b.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Choose the role the device has in the future design' })
    if (b.decision === 'replace' && !b.replacedById) ctx.addIssue({ code: 'custom', path: ['replacedById'], message: 'Choose the device that replaces it' })
    if (b.decision !== 'keep' && b.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Only a kept device takes a role' })
    if (b.decision !== 'replace' && b.replacedById) ctx.addIssue({ code: 'custom', path: ['replacedById'], message: 'Only a replaced device names its replacement' })
  })
export const hldCmoDecisionClearQuery = z.object({ baseRevision: z.coerce.number().int().min(0), branchId: objectId.optional() }).strict()

// --- M4b: LLD, Rackium Editor, design versions ----------------------------------
// `branchId` (optional) addresses an LLD branch; omitted = the main LLD.
const branchRef = { branchId: objectId.optional() }
const cableIdField = z.string().trim().min(1, 'A Cable ID needs 1 to 32 characters').max(32, 'A Cable ID needs 1 to 32 characters')
const lldEnd = z.object({ deviceId: objectId, portId: z.string().trim().min(1).max(40).nullable().optional() })
export const lldHop = z.object({
  patchPanelId: objectId,
  inPort: z.string().trim().min(1).max(40),
  outPort: z.string().trim().min(1).max(40),
  segmentCableId: cableIdField.nullable().optional(),
  // Optional: the server derives each side from the cable type and refuses a wrong one.
  inSide: z.enum(['front', 'rear']).optional(),
  outSide: z.enum(['front', 'rear']).optional(),
  // The cable after this panel (route segment seq; M5a review); omitted = kept.
  engineerSelectedM: z.number().positive().max(100000).nullable().optional(),
})
// One cable's Engineer Selected length: segment 0 is the connection's own
// cable, segment k the cable after hop k.
const segmentLengths = z.array(z.object({ segment: z.number().int().min(0).max(8), engineerSelectedM: z.number().positive().max(100000).nullable() })).max(9)
const lldConnectionFields = {
  source: lldEnd,
  dest: lldEnd,
  media: z.enum(OPTIC_MEDIA),
  speed: z.enum(HLD_SPEEDS),
  sourceSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  destSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  hops: z.array(lldHop).max(8).optional(),
  cableId: cableIdField.nullable().optional(),
  engineerSelectedM: z.number().positive().max(100000).nullable().optional(),
}
export const lldStartBody = z.object({ buildingId: objectId })
export const lldRebaseBody = z.object({ buildingId: objectId, baseRevision })
export const lldCopyBody = z.object({ buildingId: objectId, ...branchRef, hldDeviceIds: z.array(objectId).max(200).default([]), hldConnectionIds: z.array(objectId).max(400).default([]), baseRevision })
export const lldDeviceCreateBody = z.object({ buildingId: objectId, ...branchRef, catalogueKey: z.string().trim().min(1).max(200), rackId: objectId, ru: z.number().int().min(1).max(60).nullable(), face: z.enum(['front', 'rear']).default('front'), label: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/, 'Letters, digits and hyphens, up to 63 characters (hostname-safe)').optional(), baseRevision })
export const lldPlacementBody = z.object({ rackId: objectId.nullable(), ru: z.number().int().min(1).max(60).nullable(), face: z.enum(['front', 'rear']).default('front'), baseRevision })
// Renaming a planned patch panel or cable manager (fix/cmo-naming-gaps).
export const lldDeviceLabelBody = z.object({ label: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/, 'Letters, digits and hyphens, up to 63 characters (hostname-safe)'), baseRevision })
export const lldConnectionCreateBody = z.object({ buildingId: objectId, ...branchRef, ...lldConnectionFields, baseRevision })
export const lldConnectionUpdateBody = z.object({
  source: lldEnd.optional(),
  dest: lldEnd.optional(),
  media: z.enum(OPTIC_MEDIA).optional(),
  speed: z.enum(HLD_SPEEDS).optional(),
  sourceSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  destSfpCode: z.string().trim().min(1).max(200).nullable().optional(),
  hops: z.array(lldHop).max(8).optional(),
  cableId: cableIdField.nullable().optional(),
  engineerSelectedM: z.number().positive().max(100000).nullable().optional(),
  segmentLengths: segmentLengths.optional(),
  baseRevision,
})
export const lldViewQuery = z.object({ branchId: objectId.optional() })
const hostnameField = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/, 'Letters, digits and hyphens, up to 63 characters')
export const lldRenamePreviewBody = z
  .object({ buildingId: objectId, ...branchRef, renames: z.array(z.object({ deviceId: objectId, hostname: hostnameField })).max(500).optional(), regenerate: z.boolean().optional() })
  .refine((b) => b.regenerate || b.renames?.length, { message: 'Give the new hostnames, or regenerate them from the naming codes' })
export const lldRenameBody = z
  .object({ buildingId: objectId, ...branchRef, renames: z.array(z.object({ deviceId: objectId, hostname: hostnameField })).max(500).optional(), regenerate: z.boolean().optional(), baseRevision })
  .refine((b) => b.regenerate || b.renames?.length, { message: 'Give the new hostnames, or regenerate them from the naming codes' })
export const lldVersionBody = z.object({ buildingId: objectId, ...branchRef, label: z.string().trim().min(1).max(80) })
export const lldDiffQuery = z.object({ buildingId: objectId, from: z.string().regex(/^([a-f0-9]{24}|current(:[a-f0-9]{24})?)$/), to: z.string().regex(/^([a-f0-9]{24}|current(:[a-f0-9]{24})?)$/) })
export const lldRestoreBody = z.object({ ...branchRef, baseRevision })
export const lldBranchBody = z.object({ buildingId: objectId, name: z.string().trim().min(1).max(80), fromVersionId: objectId.optional() })
export const lldBranchPromoteBody = z.object({ baseRevision })
export const lldSubmitBody = z.object({ buildingId: objectId, baseRevision })
export const lldDecisionBody = z.object({ buildingId: objectId, decision: z.enum(['approved', 'changes_requested']), comment: z.string().trim().max(2000).optional() })

// --- M5a: BOM, Solution Package, client approval, change requests ----------
const minutes = z.number().int().min(0).max(24 * 60)
export const commercialSettingsBody = z
  .object({
    marginPercent: z.number().min(0).max(500).optional(),
    resourceMinutes: z.record(z.string().regex(/^[a-z-]{2,40}$/), minutes).optional(),
    powerCordStandard: z.object({ label: z.string().trim().min(1).max(80), connectorPair: z.string().trim().min(3).max(40) }).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' })

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date (YYYY-MM-DD)')
const entryId = z.string().trim().min(1).max(40)
export const addressingEntry = z.object({
  id: entryId,
  label: z.string().trim().max(80).default(''),
  vlanId: z.union([z.number().int(), z.literal('')]).default(''),
  cidr: z.string().trim().max(43).default(''),
  gateway: z.string().trim().max(39).default(''),
})
export const kvPair = z.object({ id: entryId, key: z.string().trim().max(120).default(''), value: z.string().trim().max(2000).default('') })
export const requiredInputGroupBody = z
  .object({
    buildingId: objectId,
    ownerId: objectId.nullable().optional(),
    dueDate: isoDay.nullable().optional(),
    addressingEntries: z.array(addressingEntry).max(200).optional(),
    kvPairs: z.array(kvPair).max(100).optional(),
    baseRevision,
  })
  .refine((b) => ['ownerId', 'dueDate', 'addressingEntries', 'kvPairs'].some((k) => b[k] !== undefined), { message: 'Nothing to update' })
export const acceptWarningBody = z.object({ buildingId: objectId, areaKey: z.string().trim().min(1).max(40), baseRevision })

// Share links (PM): password optional (generated when blank), expiry 1–30 days.
const sharePassword = z.string().min(8, 'At least 8 characters').max(128)
export const shareLinkCreateBody = z.object({ buildingId: objectId, password: sharePassword.optional(), expiryDays: z.number().int().min(1).max(30).default(14) })
export const shareLinkExtendBody = z.object({ days: z.number().int().min(1).max(30) })
// Empty for a download link without a password (M6b); a protected link answers "password required".
export const publicViewBody = z.object({ password: z.string().max(128).default('') })
export const publicDecisionBody = z
  .object({
    password: z.string().min(1).max(128),
    decision: z.enum(['approved', 'changes_requested', 'rejected']),
    name: z.string().trim().min(1, 'Your name is required').max(120),
    role: z.string().trim().max(120).default(''),
    comments: z.string().trim().max(4000).default(''),
    termsAccepted: z.literal(true, { message: 'Confirm you have reviewed the package and may decide on it' }),
    // A drawn signature as a PNG data URL (optional, ≤ 300 KB).
    signature: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(400_000).nullable().optional(),
  })
  .refine((b) => b.decision === 'approved' || b.comments.length > 0, { message: 'Say what needs to change', path: ['comments'] })

// Procurement (PM, after the procurement BOM is approved).
export const bomApproveBody = z.object({ buildingId: objectId })
export const procurementLineBody = z
  .object({
    buildingId: objectId,
    lineKey: z.string().trim().min(1).max(300),
    status: z.enum(['not_ordered', 'quotation_requested', 'quoted', 'ordered', 'shipped', 'delivered']).optional(),
    vendor: z.string().trim().max(120).nullable().optional(),
    poNumber: z.string().trim().max(60).nullable().optional(),
    expectedDelivery: isoDay.nullable().optional(),
    actualDelivery: isoDay.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    version: z.number().int().min(0),
  })
  .refine((b) => ['status', 'vendor', 'poNumber', 'expectedDelivery', 'actualDelivery', 'notes'].some((k) => b[k] !== undefined), { message: 'Nothing to update' })

// Change requests.
export const changeRequestCreateBody = z.object({
  buildingId: objectId,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).default(''),
  reason: z.string().trim().max(2000).default(''),
})
export const changeRequestUpdateBody = z
  .object({ title: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(4000).optional(), reason: z.string().trim().max(2000).optional(), affectedItems: z.array(z.string().trim().min(1).max(200)).max(200).optional() })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' })
export const changeRequestSendBody = z.object({ password: sharePassword.optional(), expiryDays: z.number().int().min(1).max(30).default(14) })

// --- M6a: deployment & installation -----------------------------------------
const installedSegment = z.object({
  index: z.number().int().min(0).max(20),
  cableId: z.string().trim().max(60).nullable().optional(),
  installedM: z.number().min(0).max(10000).nullable().optional(),
  confirmed: z.boolean().optional(),
})
// The Field Engineer's installation record of one device. Fields left out
// keep their value; null clears one.
export const installationBody = z
  .object({
    serial: z.string().trim().max(64).nullable().optional(),
    mac: z.string().trim().max(32).nullable().optional(),
    rackId: objectId.nullable().optional(),
    ru: z.number().int().min(1).max(60).nullable().optional(),
    face: z.enum(['front', 'rear']).nullable().optional(),
    pduOutlet: z.string().trim().max(40).nullable().optional(),
    gps: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100000).nullable().optional() }).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    // Marks the device installed (needs Delivered); otherwise a draft.
    markInstalled: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to update' })
// A device's DGUV obligation against its model's default (addendum v2.3 Q13):
// false = exempt, true = required anyway, null = back to the default. A
// reason is mandatory for an override (checked with the default, server-side).
export const dguvOverrideBody = z.object({ required: z.boolean().nullable(), reason: z.string().trim().max(500).optional() }).strict()
export const dguvInspectionBody = z.object({
  inspectionDate: isoDay,
  inspector: z.string().trim().min(1, 'Who inspected the device?').max(120),
  certificateFileId: objectId.nullable().optional(),
})
export const deviceStepBody = z.object({ status: z.enum(['configured', 'tested', 'accepted']), note: z.string().trim().max(1000).optional() })
// Patching of one connection, per end and per cable segment.
export const connectionInstallBody = z.object({
  sourcePort: z.string().trim().max(60).nullable().optional(),
  destPort: z.string().trim().max(60).nullable().optional(),
  media: z.string().trim().max(20).nullable().optional(),
  sourceSfpCode: z.string().trim().max(60).nullable().optional(),
  destSfpCode: z.string().trim().max(60).nullable().optional(),
  segments: z.array(installedSegment).max(21).optional(),
  // Confirms the patching (every segment confirmed) → Installed.
  confirm: z.boolean().optional(),
  // The version of the link's record the screen loaded (0 before any save):
  // the save-time conflict check (addendum v2.3 Q2).
  version: z.number().int().min(0),
})
export const connectionTestBody = z.object({ result: z.enum(['pass', 'fail']), note: z.string().trim().max(1000).optional() })
export const exceptionCreateBody = z.object({
  deviceId: objectId,
  connectionId: objectId.nullable().optional(),
  field: z.string().trim().min(1).max(40),
  reason: z.string().trim().min(1, 'Say why the installation differs from the design').max(2000),
  photoFileIds: z.array(objectId).max(10).default([]),
})
export const exceptionReviewBody = z
  .object({ decision: z.enum(['accepted', 'rejected']), note: z.string().trim().max(2000).default('') })
  .refine((b) => b.decision === 'accepted' || b.note.length > 0, { message: 'Say why the exception is rejected', path: ['note'] })

// --- M6a: CMDB ----------------------------------------------------------------
export const cmdbOperationalBody = z
  .object({
    assetTag: z.string().trim().max(60).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['in_service', 'maintenance']).optional(),
    warrantyStart: isoDay.nullable().optional(),
    warrantyEnd: isoDay.nullable().optional(),
    refreshDate: isoDay.nullable().optional(),
    version: z.number().int().min(0),
  })
  .refine((b) => ['assetTag', 'notes', 'status', 'warrantyStart', 'warrantyEnd', 'refreshDate'].some((k) => b[k] !== undefined), { message: 'Nothing to update' })
// Lifecycle import: the parsed sheet's rows (header → cell); the server
// matches them again (serial, then hostname). `apply: false` previews.
export const lifecycleImportBody = z.object({
  buildingId: objectId,
  fileName: z.string().trim().max(255).default('import'),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(5000),
  apply: z.boolean().default(false),
})
export const cmdbQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['accepted', 'in_service', 'maintenance']).optional(),
  category: z.string().trim().max(60).optional(),
})

// --- M6b: document engine, labels, handover ---------------------------------
export const documentRequestBody = z.object({
  buildingId: objectId.nullable().optional(),
  typeKey: z.string().trim().min(1).max(40),
  format: z.enum(['pdf', 'docx', 'xlsx', 'csv', 'json', 'zip', 'svg', 'png']),
  options: z
    .object({
      prices: z.enum(['none', 'sell', 'cost']).optional(),
      labelSize: z.string().trim().max(40).optional(),
      connectionIds: z.array(objectId).max(500).optional(),
      filters: z
        .object({
          from: isoDay.optional(),
          to: isoDay.optional(),
          userId: objectId.optional(),
          action: z.string().trim().max(80).optional(),
          module: z.string().trim().max(40).optional(),
          objectType: z.string().trim().max(60).optional(),
          buildingId: objectId.optional(),
          changeType: z.string().trim().max(40).optional(),
        })
        .optional(),
    })
    .default({}),
})
export const documentListQuery = z.object({ buildingId: objectId.optional(), typeKey: z.string().trim().max(40).optional() })
export const documentShareLinkBody = z.object({
  buildingId: objectId,
  documentIds: z.array(objectId).min(1).max(50),
  expiryDays: z.number().int().min(1).max(30).default(7),
  password: sharePassword.optional(),
  label: z.string().trim().max(120).optional(),
})
export const publicDownloadBody = z.object({ password: z.string().max(128).default('') })
export const logoBody = z.object({ dataUrl: z.string().max(800_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Use a PNG or JPEG image') })
export const scheduleHeadingsBody = z.object({ headings: z.record(z.string().trim().min(1).max(30), z.string().trim().max(60)) })
export const handoverDeliverBody = z.object({ password: sharePassword.optional(), expiryDays: z.number().int().min(1).max(30).default(14) })

// --- M7a-1: schedule (targets, milestones, dependencies, SLAs) --------------
const localDay = z.string().refine(isLocalDate, 'Use a date as YYYY-MM-DD')
const schedulePhase = z.enum(PHASE_KEYS)
export const scheduleTargetsBody = z.object({
  targets: z
    .array(z.object({ buildingId: objectId, phaseKey: schedulePhase, startDate: localDay.nullable().optional(), targetDate: localDay.nullable().optional() }))
    .min(1)
    .max(1000),
})
export const scheduleSettingsBody = z.object({
  riskElapsedPct: z.number().int().min(1).max(100).optional(),
  riskProgressPct: z.number().int().min(1).max(100).optional(),
  parallelPhases: z.array(schedulePhase).max(PHASE_KEYS.length).optional(),
  // Who an SLA breach escalates to besides the PMs and the Org Admins
  // (addendum v2.3 Q12); null = the Org Admins alone.
  escalationContactId: objectId.nullable().optional(),
})
export const milestoneCreateBody = z.object({ buildingId: objectId.nullable().optional(), name: z.string().trim().min(1).max(120), dueDate: localDay.nullable().optional() })
export const milestoneUpdateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), dueDate: localDay.nullable().optional(), completedOn: localDay.nullable().optional() })
export const standardMilestoneDueBody = z.object({ buildingId: objectId, standardKey: z.enum(STANDARD_MILESTONE_KEYS), dueDate: localDay.nullable() })
const dependencyEnd = z.object({ buildingId: objectId, phaseKey: schedulePhase })
export const dependencyCreateBody = z.object({ from: dependencyEnd, to: dependencyEnd })
export const slaCreateBody = z.object({ name: z.string().trim().min(1).max(120), buildingId: objectId.nullable().optional(), phaseKey: schedulePhase.nullable().optional(), startDate: localDay.optional(), dueDate: localDay })
export const slaUpdateBody = z.object({ name: z.string().trim().min(1).max(120).optional(), startDate: localDay.optional(), dueDate: localDay.optional() })
export const buildingAssigneesBody = z.object({ primaryArchitectId: objectId.nullable().optional(), primaryFieldEngineerId: objectId.nullable().optional() })

// --- M7a-2: global search, DGUV dashboards, field help (DATA-MODEL §5.16) ---
export const searchQuery = z.object({ q: z.string().max(200), projectId: objectId.optional() })
export const DGUV_LEVEL_KEYS = ['project', 'country', 'sal', 'building', 'floor', 'room', 'rack', 'device']
export const DGUV_STATE_KEYS = ['overdue', 'not_inspected', 'expiring', 'expiring_soon', 'valid', 'exempt']
export const dguvQuery = z.object({ level: z.enum(DGUV_LEVEL_KEYS).default('project'), id: objectId.optional(), status: z.enum(DGUV_STATE_KEYS).optional() })
// Plain text (≤ 1000 characters each, as shared/fieldHelp.js); null clears a part.
const helpText = z.string().max(1000).nullable().optional()
export const fieldHelpBody = z.object({ meaning: helpText, lookFor: helpText, example: helpText, mistakes: helpText }).strict()
export const fieldHelpListQuery = z.object({ prefix: z.string().regex(/^survey:[a-z0-9:_-]*$/).default('survey:') })
export const fieldHelpKeyParam = z.object({ key: z.string().regex(/^survey:[a-z0-9-]+:[a-z0-9_]+$/) })

// --- M7a-3: dashboards, workload, reports, report schedules, analytics ---
// Recipients are members, named by id — never free-text email addresses
// (the schema is strict: an `emails` field is refused).
const scheduleTiming = {
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  weekday: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  time: digestTimeSchema.optional(),
}
const timingProblem = (b) => (b.frequency === 'weekly' && b.weekday === undefined) || (b.frequency === 'monthly' && b.dayOfMonth === undefined)
export const reportScheduleBody = z
  .object({
    name: z.string().trim().max(120).optional(),
    typeKey: z.enum(REPORT_KEYS),
    format: z.enum(REPORT_FORMATS),
    prices: z.enum(['none', 'sell', 'cost']).default('none'),
    ...scheduleTiming,
    recipientIds: z.array(objectId).min(1).max(50),
  })
  .strict()
  .refine((b) => !timingProblem(b), { message: 'A weekly schedule needs a weekday; a monthly one a day of the month (1–28)' })
export const reportScheduleUpdateBody = z
  .object({
    name: z.string().trim().max(120).optional(),
    format: z.enum(REPORT_FORMATS).optional(),
    prices: z.enum(['none', 'sell', 'cost']).optional(),
    frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    time: digestTimeSchema.optional(),
    recipientIds: z.array(objectId).min(1).max(50).optional(),
    paused: z.boolean().optional(),
  })
  .strict()
