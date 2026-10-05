// Role and action policy (brief v2.3 §4.3). One table, used by API middleware
// now and by the client later. Actions are keyed by what the user is doing,
// not by screen, so the same rule governs every route that performs it.

export const ORG_ROLE = 'org_admin'
export const PROJECT_ROLES = ['pm', 'architect', 'reviewer', 'field_engineer', 'viewer']
export const ALL_ROLES = [ORG_ROLE, ...PROJECT_ROLES]

export const ROLE_LABELS = {
  org_admin: 'Org Admin',
  pm: 'PM',
  architect: 'Architect',
  reviewer: 'Reviewer',
  field_engineer: 'Field Engineer',
  viewer: 'Viewer',
}

export const ACTIONS = {
  MANAGE_USERS_SETTINGS_CATALOGUE: 'manage_users_settings_catalogue',
  CREATE_PROJECTS: 'create_projects',
  INVITE_PROJECT_MEMBERS: 'invite_project_members',
  CREATE_BUILDINGS_SET_TARGETS: 'create_buildings_set_targets',
  FILL_SURVEY_UPLOAD_PHOTOS: 'fill_survey_upload_photos',
  VERIFY_REJECT_SURVEY: 'verify_reject_survey',
  EDIT_SUBMIT_HLD_LLD: 'edit_submit_hld_lld',
  APPROVE_HLD_LLD_SP_INTERNAL: 'approve_hld_lld_sp_internal',
  GENERATE_CLIENT_SHARE_LINK: 'generate_client_share_link',
  APPROVE_BOM_UPDATE_PROCUREMENT: 'approve_bom_update_procurement',
  DEPLOYMENT_CHECKLIST_PATCHING_EVIDENCE: 'deployment_checklist_patching_evidence',
  MARK_INSTALLATION_ACCEPTED: 'mark_installation_accepted',
  CMDB_OPERATIONAL_EDITS: 'cmdb_operational_edits',
  SEE_PRICES_MARGINS: 'see_prices_margins',
  DOWNLOAD_PORT_CABLE_SCHEDULES: 'download_port_cable_schedules',
  VIEW_AUDIT_LOG: 'view_audit_log',
}

// Who may perform each action. An Org Admin's organisation-level role grants
// only the actions listed here; design approvals need a project role.
const MATRIX = {
  [ACTIONS.MANAGE_USERS_SETTINGS_CATALOGUE]: ['org_admin'],
  [ACTIONS.CREATE_PROJECTS]: ['org_admin', 'pm'],
  // A PM invites into a project only where they hold the PM role; the caller's
  // roles are checked for that project, so a PM elsewhere has no rights here.
  [ACTIONS.INVITE_PROJECT_MEMBERS]: ['org_admin', 'pm'],
  [ACTIONS.CREATE_BUILDINGS_SET_TARGETS]: ['org_admin', 'pm'],
  [ACTIONS.FILL_SURVEY_UPLOAD_PHOTOS]: ['field_engineer'],
  [ACTIONS.VERIFY_REJECT_SURVEY]: ['architect'],
  [ACTIONS.EDIT_SUBMIT_HLD_LLD]: ['architect'],
  [ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL]: ['pm', 'reviewer'],
  [ACTIONS.GENERATE_CLIENT_SHARE_LINK]: ['pm'],
  [ACTIONS.APPROVE_BOM_UPDATE_PROCUREMENT]: ['pm'],
  [ACTIONS.DEPLOYMENT_CHECKLIST_PATCHING_EVIDENCE]: ['field_engineer'],
  [ACTIONS.MARK_INSTALLATION_ACCEPTED]: ['pm', 'reviewer'],
  [ACTIONS.CMDB_OPERATIONAL_EDITS]: ['pm', 'architect'],
  [ACTIONS.SEE_PRICES_MARGINS]: ['org_admin', 'pm', 'reviewer'],
  [ACTIONS.DOWNLOAD_PORT_CABLE_SCHEDULES]: ['org_admin', 'pm', 'architect', 'reviewer', 'field_engineer', 'viewer'],
  [ACTIONS.VIEW_AUDIT_LOG]: ['org_admin', 'pm', 'architect', 'reviewer'],
}

// Roles a user may hold at each level. Invitations and memberships are
// validated against these lists.
export function rolesForLevel(level) {
  if (level === 'organisation') return [ORG_ROLE]
  if (level === 'project') return PROJECT_ROLES
  throw new Error(`Unknown membership level: ${level}`)
}

export function isKnownAction(action) {
  return Object.prototype.hasOwnProperty.call(MATRIX, action)
}

// `roles` is every role the actor holds for the context being checked: the
// organisation role, and the project role when the action is project-scoped.
export function can(roles, action) {
  if (!isKnownAction(action)) throw new Error(`Unknown policy action: ${action}`)
  const allowed = MATRIX[action]
  return (roles ?? []).some((role) => allowed.includes(role))
}

export function allowedActions(roles) {
  return Object.keys(MATRIX).filter((action) => can(roles, action))
}

// Brief §4.3: Architect cannot approve their own work. Applies to internal
// approval actions, where the approver and the submitter must differ.
export function canApproveSubmission({ roles, actorId, submitterId }) {
  if (!can(roles, ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL)) return false
  return String(actorId) !== String(submitterId)
}
