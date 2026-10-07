// Hierarchy CSV/Excel import (wizard Structure step and Project Settings ->
// Hierarchy). One flat row per building (DATA-MODEL §3.3-§3.6). Pure and
// side-effect-free, so the client can preview and the server can re-validate
// with the exact same function before the transactional bulk-create.

// Codes are concatenated directly into hostnames (brief §7), so they must be
// short and hostname-safe: letters and digits only, no spaces, dots or
// punctuation.
const CODE_RE = /^[A-Za-z0-9]{1,10}$/

const REQUIRED_FIELDS = ['countryCode', 'countryName', 'salCode', 'campusCode', 'buildingCode', 'buildingName']
const CODE_FIELDS = ['countryCode', 'salCode', 'campusCode', 'buildingCode', 'wingCode']

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : value
}

// A floor's hostname form (DATA-MODEL §3.6): the token with dots and spaces
// removed, e.g. "1.OG" -> "1OG". Used when a device hostname is built from a
// floor; the floor's displayed token (with the dot) is unchanged.
export function floorHostnameToken(token) {
  return (token ?? '').replace(/[.\s]/g, '')
}

// One row -> { ok, errors: [{ field, message }], row: <normalised> }.
export function validateHierarchyRow(raw) {
  const row = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, trimmed(v)]))
  const errors = []

  for (const field of REQUIRED_FIELDS) {
    if (!row[field]) errors.push({ field, message: `${field} is required` })
  }
  if (row.wingCode && !row.wingName) errors.push({ field: 'wingName', message: 'wingName is required when wingCode is given' })
  if (row.wingName && !row.wingCode) errors.push({ field: 'wingCode', message: 'wingCode is required when wingName is given' })

  for (const field of CODE_FIELDS) {
    if (row[field] && !CODE_RE.test(row[field])) {
      errors.push({ field, message: `${field} must be 1-10 letters or digits, no spaces or punctuation` })
    }
  }

  return { ok: errors.length === 0, errors, row }
}

// Validates every row, then groups into deduplicated entity lists in parent
// order (country -> SAL -> campus -> building -> wing), each keyed by its
// natural codes so the caller can create in order and reuse the created ids.
// Returns { ok: false, rowErrors } on any row error (nothing is dropped
// silently); otherwise { ok: true, countries, sals, campuses, buildings, wings }.
export function buildHierarchyImportPlan(rawRows) {
  const rowErrors = []
  const rows = rawRows.map((raw, index) => {
    const result = validateHierarchyRow(raw)
    if (!result.ok) rowErrors.push({ index, errors: result.errors })
    return result.row
  })
  if (rowErrors.length > 0) return { ok: false, rowErrors }

  const countries = new Map() // code -> { code, name }
  const sals = new Map() // countryCode|salCode -> { countryCode, code }
  const campuses = new Map() // countryCode|salCode|campusCode -> { countryCode, salCode, code }
  const buildings = new Map() // countryCode|salCode|campusCode|buildingCode -> {..., name}
  const wings = new Map()
  const conflict = (field, key, before, after) => rowErrors.push({ index: null, errors: [{ field, message: `${key}: ${field} was given as both "${before}" and "${after}"` }] })

  for (const row of rows) {
    const countryKey = row.countryCode
    const existingCountry = countries.get(countryKey)
    if (existingCountry && existingCountry.name !== row.countryName) conflict('countryName', countryKey, existingCountry.name, row.countryName)
    countries.set(countryKey, { code: row.countryCode, name: row.countryName })

    const salKey = `${countryKey}|${row.salCode}`
    sals.set(salKey, { countryCode: row.countryCode, code: row.salCode })

    const campusKey = `${salKey}|${row.campusCode}`
    campuses.set(campusKey, { countryCode: row.countryCode, salCode: row.salCode, code: row.campusCode })

    const buildingKey = `${campusKey}|${row.buildingCode}`
    const existingBuilding = buildings.get(buildingKey)
    if (existingBuilding && existingBuilding.name !== row.buildingName) conflict('buildingName', buildingKey, existingBuilding.name, row.buildingName)
    buildings.set(buildingKey, { countryCode: row.countryCode, salCode: row.salCode, campusCode: row.campusCode, code: row.buildingCode, name: row.buildingName })

    if (row.wingCode) {
      const wingKey = `${buildingKey}|${row.wingCode}`
      wings.set(wingKey, { countryCode: row.countryCode, salCode: row.salCode, campusCode: row.campusCode, buildingCode: row.buildingCode, code: row.wingCode, name: row.wingName })
    }
  }

  if (rowErrors.length > 0) return { ok: false, rowErrors }
  return {
    ok: true,
    countries: [...countries.values()],
    sals: [...sals.values()],
    campuses: [...campuses.values()],
    buildings: [...buildings.values()],
    wings: [...wings.values()],
  }
}
