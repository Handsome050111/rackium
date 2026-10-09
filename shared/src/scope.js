// Membership scope (DATA-MODEL §1.6, D5). A project membership may be limited
// to countries, SALs or buildings; an empty list is the whole project. The
// Org Admin is never limited (the server decides that before calling these).

// Does a scope list cover a building? `building` = { id, salId, countryId }.
export function scopeCoversBuilding(scopes, building) {
  if (!scopes || scopes.length === 0) return true
  if (!building) return false
  return scopes.some(
    (s) =>
      (s.type === 'building' && String(s.refId) === String(building.id)) ||
      (s.type === 'sal' && String(s.refId) === String(building.salId)) ||
      (s.type === 'country' && String(s.refId) === String(building.countryId))
  )
}

// Does a scope list cover a SAL-level item (one with no building yet, such
// as an Unassigned CMO device and its blocker)? `sal` = { id, countryId }.
// A building scope does not reach SAL-level items: they are not in any of
// its buildings.
export function scopeCoversSal(scopes, sal) {
  if (!scopes || scopes.length === 0) return true
  if (!sal) return false
  return scopes.some((s) => (s.type === 'sal' && String(s.refId) === String(sal.id)) || (s.type === 'country' && String(s.refId) === String(sal.countryId)))
}
