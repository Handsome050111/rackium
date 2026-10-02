// Role permissions for the rack survey screen (brief v2.3 §4.3 RACI table
// plus the §4.1 rack placement rules, which give Architect and PM/Org Admin
// narrower powers than the general "who fills the survey" RACI entry).

export const ROLES = [
  { id: 'org_admin', label: 'Org Admin' },
  { id: 'pm', label: 'PM' },
  { id: 'architect', label: 'Architect' },
  { id: 'reviewer', label: 'Reviewer' },
  { id: 'field_engineer', label: 'Field Engineer' },
  { id: 'viewer', label: 'Viewer' },
]

// Field Engineers fill the survey and place equipment (§4.3: "Fill survey,
// upload photos" is Field Engineer only).
export function canMoveDevices(role) {
  return role === 'field_engineer'
}

// Reserved is set by the Architect and can be released by the Architect
// (§4.1).
export function canReserve(role) {
  return role === 'architect'
}

// Blocked is set by PM or Org Admin; the Architect cannot override it
// (§4.1).
export function canBlock(role) {
  return role === 'pm' || role === 'org_admin'
}

export function canUploadEvidence(role) {
  return role === 'field_engineer'
}

export function canEditAnything(role) {
  return canMoveDevices(role) || canReserve(role) || canBlock(role)
}

export function getRackPermissions(role) {
  return {
    canMoveDevices: canMoveDevices(role),
    canReserve: canReserve(role),
    canBlock: canBlock(role),
    canUploadEvidence: canUploadEvidence(role),
    readOnly: !canEditAnything(role),
  }
}

// Site Structure (brief v2.3 §4.1/§4.3): Field Engineer creates/edits;
// PM or Architect may pre-create. Architect separately verifies (not a
// full workflow yet — see Step 4 scope notes). Everyone else, including
// Org Admin, is read-only here.
export function canEditSiteStructure(role) {
  return role === 'field_engineer' || role === 'pm' || role === 'architect'
}

export function getSiteStructurePermissions(role) {
  const canEdit = canEditSiteStructure(role)
  return { canEdit, readOnly: !canEdit }
}

// LLD (brief v2.3 §5.4): the Architect assigns ports, Cable IDs and
// Engineer Selected lengths. Everyone else sees the design read-only.
export function canEditLld(role) {
  return role === 'architect'
}

// BOM pricing/margin (brief v2.3 §6.5 D20): visible only to Org Admin, PM
// and Reviewer — never Architect, Field Engineer or Viewer.
export function canViewBomPricing(role) {
  return role === 'org_admin' || role === 'pm' || role === 'reviewer'
}

// Vendor is editable any time; procurement status/PO/delivery fields are
// additionally gated by Solution Package approval (api/bomDesign.js).
export function canEditBomVendor(role) {
  return role === 'pm' || role === 'org_admin'
}

// Brief D21: "PM approves the procurement BOM" — no separate reviewer step,
// unlike HLD/Solution Package's architect-submits / pm-or-reviewer-approves
// split.
export function canApproveBom(role) {
  return role === 'pm'
}

// Solution Package (brief v2.2 §3.7A.5): the Architect compiles/edits;
// PM or Reviewer reviews before the package goes out for client approval.
export function canEditSolutionPackage(role) {
  return role === 'architect'
}

export function canSubmitSolutionPackageForApproval(role) {
  return role === 'pm'
}

// Deployment (brief v2.3 D14): Field Engineers record patching and
// installation progress against the read-only LLD.
export function canRecordDeployment(role) {
  return role === 'field_engineer'
}

// Brief Step 8: only the Reviewer or PM may accept a device (the final
// Accepted status), distinct from the Field Engineer who installs it.
export function canAcceptDevice(role) {
  return role === 'reviewer' || role === 'pm'
}

// CMDB (brief v2.3 D15): Architects and PMs make operational edits, each
// flagged "operational change" in the audit trail. Field Engineers cannot
// edit the CMDB.
export function canEditCmdb(role) {
  return role === 'architect' || role === 'pm'
}

// CMO import (brief v2.3 §5.1/D39): no RACI row names this explicitly, so
// it follows the same PM-or-Org-Admin cluster as other project-setup
// actions ("Create buildings, set phase targets" §4.3). Assignment of an
// Unassigned device to a building is narrower — D39 names the PM alone.
export function canImportCmo(role) {
  return role === 'pm' || role === 'org_admin'
}

export function canAssignCmoDevice(role) {
  return role === 'pm'
}

// Handover (brief v2.3 §4.3/§5.9): the PM drives the whole workflow —
// compiling, marking reviewed, and generating the client share link ("No |
// Yes | No | No | No | No" for "Generate client share link (Solution
// Package, Handover)").
export function canManageHandover(role) {
  return role === 'pm'
}

// Survey form tabs (brief v2.3 §5.2/§4.3): "Fill survey, upload photos" is
// Field Engineer only; "Verify or reject survey" is Architect only. Prefill
// (Location Details' prefilled/prefilled_validated fields) is set up ahead
// of the survey by whoever creates the project record — Architect or PM,
// same cluster as "PM or Architect may pre-create" floors/rooms/racks
// (§4.1).
export function canFillSurveyForm(role) {
  return role === 'field_engineer'
}

export function canVerifySurveyForm(role) {
  return role === 'architect'
}

export function canPrefillSurveyForm(role) {
  return role === 'architect' || role === 'pm'
}

// Custom fields (brief §5.2): "Org Admin can add extra fields to a tab."
export function canAddCustomSurveyField(role) {
  return role === 'org_admin'
}
