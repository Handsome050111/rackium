// CMO Inventory import (brief v2.3 §5.1, v2.2 §3.5a/§20.2). Pure
// calculation only — file parsing and store writes live in
// api/cmoDesign.js, same split as every other phase's lib/ module.

// The columns a client's CMO Excel/CSV must map onto. `required` fields
// block commit when unmapped; the rest are optional (brief's explicit
// Step 9 field list: "hostname, model, serial, MAC, building, floor, room,
// rack, RU").
export const CMO_FIELDS = [
  { key: 'hostname', label: 'Hostname', required: false },
  { key: 'model', label: 'Model', required: false },
  { key: 'serial', label: 'Serial number', required: true },
  { key: 'mac', label: 'MAC address', required: false },
  { key: 'building', label: 'Building', required: false },
  { key: 'floor', label: 'Floor', required: false },
  { key: 'room', label: 'Room', required: false },
  { key: 'rack', label: 'Rack', required: false },
  { key: 'ru', label: 'RU', required: false },
]

// Best-effort header -> field guess, so the mapping step starts pre-filled
// for a reasonably-named sheet instead of forcing every column by hand.
const HEADER_ALIASES = {
  hostname: ['hostname', 'host name', 'device name', 'name'],
  model: ['model', 'device model'],
  serial: ['serial', 'serial number', 'serial no', 's/n'],
  mac: ['mac', 'mac address'],
  building: ['building', 'building code'],
  floor: ['floor'],
  room: ['room', 'comms room'],
  rack: ['rack', 'rack code'],
  ru: ['ru', 'ru position'],
}

export function guessColumnMapping(headers) {
  const mapping = {}
  for (const field of CMO_FIELDS) {
    const aliases = HEADER_ALIASES[field.key]
    const index = headers.findIndex((h) => aliases.includes(String(h ?? '').trim().toLowerCase()))
    mapping[field.key] = index
  }
  return mapping
}

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i

export function isValidMac(mac) {
  if (!mac) return true // MAC is optional — absence isn't a format error
  return MAC_RE.test(mac.trim())
}

// Stored form (DATA-MODEL §4.1a, "normalised"): lower case, colon-separated.
export function normaliseMac(mac) {
  if (!mac || !isValidMac(mac)) return null
  return mac.trim().toLowerCase().replace(/-/g, ':')
}

function countBy(rows, valueOf) {
  const counts = new Map()
  for (const r of rows) {
    const v = valueOf(r)
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

// Turns the raw parsed grid (first row headers, rest data) into row
// objects keyed by CMO_FIELDS, using the user's column mapping
// ({ fieldKey: columnIndex }). Columns left unmapped come through as null.
export function applyColumnMapping(dataRows, mapping) {
  return dataRows.map((row, i) => {
    const values = {}
    for (const field of CMO_FIELDS) {
      const colIndex = mapping[field.key]
      const raw = colIndex == null || colIndex < 0 ? null : row[colIndex]
      values[field.key] = raw == null || raw === '' ? null : String(raw).trim()
    }
    return { rowIndex: i, ...values }
  })
}

// Row-level validation (brief Step 9): missing serial, duplicate serial
// within the file, duplicate against the project, bad MAC format, unknown
// building. `resolveBuilding` looks up a building code/name and returns an
// id or null — kept external so this stays a pure function over plain
// data, not the site-structure API.
//
// The real backend adds checks the mock never needed, each opt-in so the
// mock's results are unchanged: `projectMacs` / `projectHostnames` (Sets of
// normalised values already in the project) also flag MAC and hostname
// duplicates — the devices collection has unique indexes on both, so these
// must be caught here rather than abort the commit. `resolveRoom` /
// `resolveRack` place a device in a room and rack; an unknown room, rack or
// RU is a warning only (the device still imports, just not placed).
export function validateCmoRows(rows, { projectSerials, resolveBuilding, projectMacs, projectHostnames, resolveRoom, resolveRack }) {
  const serialCounts = countBy(rows, (r) => r.serial?.toLowerCase())
  const macCounts = projectMacs ? countBy(rows, (r) => normaliseMac(r.mac)) : null
  const hostnameCounts = projectHostnames ? countBy(rows, (r) => r.hostname?.toLowerCase()) : null

  return rows.map((r) => {
    const errors = []
    const warnings = []
    if (!r.serial) errors.push('missing_serial')
    if (r.serial && serialCounts.get(r.serial.toLowerCase()) > 1) errors.push('duplicate_in_file')
    if (r.serial && projectSerials.has(r.serial.toLowerCase())) errors.push('duplicate_in_project')
    if (r.mac && !isValidMac(r.mac)) errors.push('invalid_mac')

    const mac = normaliseMac(r.mac)
    if (macCounts && mac && macCounts.get(mac) > 1) errors.push('duplicate_mac_in_file')
    if (projectMacs && mac && projectMacs.has(mac)) errors.push('duplicate_mac_in_project')
    const hostname = r.hostname?.toLowerCase()
    if (hostnameCounts && hostname && hostnameCounts.get(hostname) > 1) errors.push('duplicate_hostname_in_file')
    if (projectHostnames && hostname && projectHostnames.has(hostname)) errors.push('duplicate_hostname_in_project')

    const buildingId = r.building ? resolveBuilding(r.building) : null
    if (r.building && !buildingId) errors.push('unknown_building')

    let roomId = null
    let rackId = null
    let ruPosition = null
    if (resolveRoom && buildingId && r.room) {
      roomId = resolveRoom(buildingId, r.room)
      if (!roomId) warnings.push('unknown_room')
    }
    if (resolveRack && roomId && r.rack) {
      rackId = resolveRack(roomId, r.rack)
      if (!rackId) warnings.push('unknown_rack')
    }
    if (r.ru != null) {
      const n = Number(r.ru)
      if (Number.isInteger(n) && n >= 1) ruPosition = n
      else warnings.push('invalid_ru')
    }

    return {
      ...r,
      buildingId,
      roomId,
      rackId,
      ruPosition,
      errors,
      warnings,
      valid: errors.length === 0 || (errors.length === 1 && errors[0] === 'unknown_building'),
    }
  })
}

export const ROW_ERROR_LABEL = {
  missing_serial: 'Missing serial',
  duplicate_in_file: 'Duplicate in file',
  duplicate_in_project: 'Duplicate in project',
  invalid_mac: 'Invalid MAC format',
  unknown_building: 'Unknown building — goes to Unassigned',
  duplicate_mac_in_file: 'Duplicate MAC in file',
  duplicate_mac_in_project: 'MAC already in project',
  duplicate_hostname_in_file: 'Duplicate hostname in file',
  duplicate_hostname_in_project: 'Hostname already in project',
}

export const ROW_WARNING_LABEL = {
  unknown_room: 'Unknown room — imported without a room',
  unknown_rack: 'Unknown rack — imported without a rack',
  invalid_ru: 'RU is not a whole number from 1 — ignored',
}

export function computeCmoKpis(devices) {
  const assigned = devices.filter((d) => d.buildingId)
  const unassigned = devices.filter((d) => !d.buildingId)
  return {
    total: devices.length,
    assigned: assigned.length,
    unassigned: unassigned.length,
  }
}

// Brief Step 9: "CMO phase becomes Completed when import is done and no
// unassigned devices remain." The "no unassigned devices" half is SAL-wide
// (it's a global blocker, independent of which building you're looking
// at — see computeCmoKpis/the dashboard's openBlockers), but a single
// building's own CMO phase card tracks whether ITS inventory has been
// imported: otherwise resolving an unrelated building's leftover devices
// would silently flip an already-progressed building's CMO status back and
// forth, regressing its "current phase" calculation for no reason.
export function computeBuildingCmoStatus(buildingDevices) {
  return buildingDevices.length === 0 ? 'not_started' : 'completed'
}

// Real-backend rule (M3a): "Completed when imported and no unassigned devices
// remain". Unassigned devices sit at SAL level and are open blockers there,
// so while any remain in the building's SAL an imported building is Blocked
// rather than Completed. The mock keeps computeBuildingCmoStatus above.
export function computeCmoPhaseStatus({ buildingDeviceCount, salUnassignedCount }) {
  if (buildingDeviceCount === 0) return 'not_started'
  return salUnassignedCount > 0 ? 'blocked' : 'completed'
}
