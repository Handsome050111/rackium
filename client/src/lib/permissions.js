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
