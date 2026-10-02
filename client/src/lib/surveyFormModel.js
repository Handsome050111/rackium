// Generic survey-form engine (brief v2.3 §5.2, Step 10), driven entirely by
// docs/survey-fields.json — one renderer for all 18 tabs, no hand-written
// form per tab. This module is the pure calculation half (field
// completeness, select-option parsing, format validation, auto-fill); the
// store and workflow live in api/surveyFormsDesign.js, same split as every
// other phase.
import surveyFields from '../../../docs/survey-fields.json'
import { matchSerial } from './cmoValidation.js'
import { isValidMac } from './cmoModel.js'

export const SURVEY_TABS = surveyFields.tabs

export function getTabDefinition(tabName) {
  return SURVEY_TABS.find((t) => t.tab === tabName) ?? null
}

export function tabSlug(tabName) {
  return tabName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export function tabBySlug(slug) {
  return SURVEY_TABS.find((t) => tabSlug(t.tab) === slug) ?? null
}

// --- Select-from-hint parsing ------------------------------------------

// A hint only becomes a select's option list when it reads like a short
// slash-separated enumeration ("Static/DHCP", "SC/LC") rather than a
// clarifying note ("or label on device", "LED Green") or a long aside
// ("Latitude/longitude of the buildings to build..."). Tokens over ~20
// characters or 3 words read as prose, not an option list, and fall back
// to a plain text field with the hint shown as help text instead.
export function parseHintOptions(hint) {
  if (!hint || !hint.includes('/')) return null
  const tokens = hint
    .split('/')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length < 2) return null
  if (tokens.some((t) => t.length > 20 || t.split(/\s+/).length > 3)) return null
  return tokens
}

// --- Format validation ---------------------------------------------------

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isValidIp(value) {
  if (!value) return true // empty isn't a format error — missing-ness is handled by the `must` check
  const m = IP_RE.exec(value.trim())
  if (!m) return false
  return m.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255)
}

export function isValidEmail(value) {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export { isValidMac, matchSerial }

// --- Field completeness ---------------------------------------------------

export function isFieldRequired(field) {
  return field.requirement === 'must' || field.requirement === 'must_if_allowed'
}

// `confirmed` only matters for `prefill: "prefilled_validated"` fields: the
// Architect/PM-entered value isn't enough on its own — the Field Engineer
// must explicitly tick "Validated on site" during the real survey, or the
// field isn't actually filled yet for submit purposes.
export function isFieldFilled(field, value, confirmed) {
  if (field.type === 'photo' || field.type === 'photo_multi') return (value?.count ?? 0) > 0
  if (field.type === 'file') return Boolean(value?.fileName)
  if (field.type === 'rack_elevation') return true // captured via the Rack Survey screen, never blocks this form's submit
  if (value == null || String(value).trim() === '') return false
  if (field.prefill === 'prefilled_validated' && !confirmed) return false
  return true
}

// Looks up both a field's value and its "Validated on site" confirmation
// flag from a flat record object, using the `${key}__confirmed` convention
// every record (key_value or table row) stores it under.
function fieldValueAndConfirmed(field, record) {
  return [record?.[field.key], record?.[`${field.key}__confirmed`]]
}

export function fieldFormatError(field, value) {
  if (!value) return null
  if (field.type === 'mac' && !isValidMac(value)) return 'Invalid MAC format'
  if (field.type === 'ip' && !isValidIp(value)) return 'Invalid IPv4 format'
  if (field.type === 'email' && !isValidEmail(value)) return 'Invalid email format'
  return null
}

// --- Section/tab completeness --------------------------------------------
// A `key_value` record is one object `{fieldKey: value}`. A `table`
// record is an array of row objects — an EMPTY table counts as complete
// (not every tab's inventory applies to every room; a table blocks submit
// only once a row has been started but left missing a required cell, not
// for having zero rows at all).

function countKeyValueSection(section, record) {
  const requiredFields = section.fields.filter(isFieldRequired)
  // Rack Layout's `repeatable_per: "rack"` section gets one instance per
  // real rack in the room instead of a single record — nothing to require
  // until at least one rack exists to survey.
  if (section.repeatable_per) {
    const instances = Array.isArray(record) ? record : []
    if (instances.length === 0) return { required: 0, filled: 0 }
    let required = 0
    let filled = 0
    for (const instance of instances) {
      for (const f of requiredFields) {
        required++
        if (isFieldFilled(f, ...fieldValueAndConfirmed(f, instance))) filled++
      }
    }
    return { required, filled }
  }
  let required = 0
  let filled = 0
  for (const f of requiredFields) {
    required++
    if (isFieldFilled(f, ...fieldValueAndConfirmed(f, record))) filled++
  }
  return { required, filled }
}

function countTableSection(section, rows) {
  const requiredFields = section.fields.filter(isFieldRequired)
  if (!rows || rows.length === 0) return { required: 0, filled: 0 }
  let required = 0
  let filled = 0
  for (const row of rows) {
    for (const f of requiredFields) {
      required++
      if (isFieldFilled(f, ...fieldValueAndConfirmed(f, row))) filled++
    }
  }
  return { required, filled }
}

// item_list: each `field` is a row; every item_column cell on a `must` row
// must be filled.
function countItemListSection(section, record) {
  const requiredRows = section.fields.filter(isFieldRequired)
  let required = 0
  let filled = 0
  for (const row of requiredRows) {
    for (const col of section.item_columns) {
      required++
      const cell = record?.[row.key]?.[col]
      const isPhoto = col === 'photograph'
      if (isPhoto ? (cell?.count ?? 0) > 0 : cell != null && String(cell).trim() !== '') filled++
    }
  }
  return { required, filled }
}

function countGallerySection(section, record) {
  const requiredFields = section.fields.filter(isFieldRequired)
  let filled = 0
  for (const f of requiredFields) {
    if (isFieldFilled(f, ...fieldValueAndConfirmed(f, record))) filled++
  }
  return { required: requiredFields.length, filled }
}

// `getRecord(section)` returns that section's stored data (shape depends on
// its layout) — kept external so this stays a pure function over data the
// caller already fetched, not the api/ store.
export function computeTabCompleteness(tabDef, getRecord) {
  let required = 0
  let filled = 0
  for (const section of tabDef.sections) {
    const record = getRecord(section)
    let counts
    if (section.layout === 'table') counts = countTableSection(section, record)
    else if (section.layout === 'item_list') counts = countItemListSection(section, record)
    else if (section.layout === 'gallery') counts = countGallerySection(section, record)
    else counts = countKeyValueSection(section, record) // key_value, and repeatable_per:'rack' instances (summed by the caller)
    required += counts.required
    filled += counts.filled
  }
  const percent = required === 0 ? 100 : Math.round((filled / required) * 100)
  return { required, filled, percent, complete: filled === required }
}

export const WORKFLOW_STATES = ['draft', 'submitted', 'verified', 'rejected']

export const WORKFLOW_LABEL = {
  draft: 'Draft',
  submitted: 'Submitted',
  verified: 'Verified',
  rejected: 'Rejected',
  imported: 'Imported into HLD',
}

// --- Auto-fill ---------------------------------------------------------
// These exact key spellings repeat verbatim across many tabs/tables (brief:
// "Auto-fill from existing data where obvious... show such fields as
// calculated/read-only"). Deliberately narrow — only keys that are a clean,
// unambiguous match for real site-structure data get auto-filled; anything
// else (e.g. "wan_cpe_buillding_name", "building_number_name" — different
// spellings used elsewhere in the source workbook) stays a normal typed
// field rather than guessing at a fuzzy match. Rack identity is
// deliberately excluded here — a room can hold several racks, so "which
// rack" only has one unambiguous answer inside Rack Layout's own
// per-rack-instance context (rackInstanceCalculatedValue below), never for
// a generic table row that merely mentions a rack in passing.
export function calculatedFieldValue(fieldKey, ctx) {
  switch (fieldKey) {
    case 'building_name':
      return ctx.buildingName ?? null
    case 'building_number':
      return ctx.buildingCode ?? null
    case 'floor_number':
      return ctx.floorName ?? null
    case 'room_name_number':
    case 'comms_room_number':
      return ctx.roomCode ?? null
    default:
      return undefined // not a calculated key — caller leaves the field as a normal input
  }
}

// Rack Layout's repeatable_per:'rack' section renders one instance per real
// rack — within that context (unlike a generic table row) "which rack" is
// unambiguous, so its own identity fields can be calculated too.
export function rackInstanceCalculatedValue(fieldKey, rackCtx) {
  switch (fieldKey) {
    case 'rack_name':
      return rackCtx.rackCode ?? null
    case 'sequence_no':
      return rackCtx.rackPosition != null ? String(rackCtx.rackPosition) : null
    default:
      return undefined
  }
}
