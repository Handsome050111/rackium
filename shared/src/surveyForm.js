// Physical Site Survey forms (brief v2.3 §5.2, Step 10; DATA-MODEL §5.4),
// driven entirely by docs/survey-fields.json. Pure: the client renders and
// previews with it, the server re-runs it before every write.
//
// The first half is the prototype's form engine, moved here unchanged from
// client/src/lib/surveyFormModel.js (which now re-exports it). The second
// half is what the real backend adds: the stored record shape and its
// adapters, the edit operations (online and offline replay), the workflow
// transition table, the survey phase status and the membership-scope check.
import surveyFields from '../../docs/survey-fields.json' with { type: 'json' }
import { matchSerial } from './cmoValidation.js'
import { isValidMac } from './cmoModel.js'

export const SURVEY_TEMPLATE_VERSION = surveyFields.version
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

// =============================================================================
// Real backend (M3b)
// =============================================================================

export const BUILDING_TABS = SURVEY_TABS.filter((t) => t.scope === 'building').map((t) => t.tab)
export const ROOM_TABS = SURVEY_TABS.filter((t) => t.scope === 'room').map((t) => t.tab)

const FILE_TYPES = ['photo', 'photo_multi', 'file']
export const isFileField = (field) => FILE_TYPES.includes(field.type)

// Comms Rooms Summary "Comms rooms" columns that come from the real rack
// once a row's rack_number names one (as the prototype's TableSection shows them).
export const RACK_STAT_KEYS = {
  total_number_rack_units: (s) => s.totalRU,
  used_rus_in_existing_racks: (s) => s.usedRU,
  unused_rus_in_existing_racks: (s) => s.freeRU,
  free_power_sockets_in_existing_rack_pdu_1: (s) => s.pduAFree,
  free_power_sockets_in_existing_rack_pdu_2: (s) => s.pduBFree,
}

// Is this key calculated (read-only) in this section? Calculated values are
// never stored; writes to them are refused.
export function isCalculatedKey(tabDef, section, key) {
  if (calculatedFieldValue(key, {}) !== undefined) return true
  if (section.repeatable_per && rackInstanceCalculatedValue(key, {}) !== undefined) return true
  if (tabDef.tab === 'Comms Rooms Summary' && key in RACK_STAT_KEYS) return true
  return false
}

// --- Stored record <-> component shape -------------------------------------
//
// Stored (DATA-MODEL §5.4): sections[] index-aligned with the template, each
//   { sectionIndex, layout, fieldValues: [FV], rows: [{ rowId, rackId?, rowKey?, fieldValues: [FV] }] }
//   FV = { key, value, confirmed, updatedBy, updatedAt }
// value: string | number | boolean | null, or { fileIds: [...] } for photo/file fields.
//
// Component shape (the prototype's survey components consume this):
//   key_value / gallery: { key: value, key__confirmed: true }
//   table: [{ id, key: value, ... }]
//   Rack Layout (repeatable_per rack): [{ rackId, key: value }] one per real rack, in rack order
//   item_list: { rowKey: { column: value } }
//   photo values: { count, fileIds }; file values: { fileName, fileIds }

function fileValueForComponents(field, value, fileNames) {
  const fileIds = value?.fileIds ?? []
  if (field?.type === 'file') return fileIds.length ? { fileName: fileNames?.get(fileIds[0]) ?? 'file', fileIds } : undefined
  return fileIds.length ? { count: fileIds.length, fileIds } : undefined
}

function flatten(fieldValues, fieldsByKey, fileNames) {
  const out = {}
  for (const fv of fieldValues ?? []) {
    const field = fieldsByKey.get(fv.key)
    const isFile = field ? isFileField(field) : fv.value?.fileIds
    const value = isFile ? fileValueForComponents(field, fv.value, fileNames) : fv.value
    if (value !== undefined && value !== null) out[fv.key] = value
    if (fv.confirmed) out[`${fv.key}__confirmed`] = true
  }
  return out
}

// `ctx` = { buildingName, buildingCode, floorName, roomCode }; `rackList` =
// [{ id, code, rackPosition }] (the room's real racks); `rackStatsByCode` =
// { [code]: { totalRU, usedRU, freeRU, pduAFree, pduBFree } }. Calculated values
// are merged in, so completeness counts them (the prototype never did:
// a started row with a calculated must column could never be submitted).
export function toComponentSections(tabDef, record, { ctx = {}, rackList = [], rackStatsByCode = {}, fileNames = null, customFields = [] } = {}) {
  return tabDef.sections.map((section, sectionIndex) => {
    const stored = record?.sections?.find((s) => s.sectionIndex === sectionIndex) ?? { fieldValues: [], rows: [] }
    const fields = sectionIndex === 0 ? [...section.fields, ...customFields] : section.fields
    const fieldsByKey = new Map(fields.map((f) => [f.key, f]))
    const withCalculated = (values, rackCtx) => {
      const out = { ...values }
      for (const f of section.fields) {
        const v = calculatedFieldValue(f.key, ctx)
        if (v !== undefined && v !== null) out[f.key] = v
        if (rackCtx) {
          const r = rackInstanceCalculatedValue(f.key, rackCtx)
          if (r !== undefined && r !== null) out[f.key] = r
        }
      }
      if (tabDef.tab === 'Comms Rooms Summary' && out.rack_number) {
        const stats = rackStatsByCode[String(out.rack_number).trim().toUpperCase()]
        if (stats) for (const [key, get] of Object.entries(RACK_STAT_KEYS)) if (section.fields.some((f) => f.key === key)) out[key] = get(stats)
      }
      return out
    }
    if (section.layout === 'table') {
      return (stored.rows ?? []).map((row) => ({ id: String(row.rowId), ...withCalculated(flatten(row.fieldValues, fieldsByKey, fileNames)) }))
    }
    if (section.layout === 'item_list') {
      const out = {}
      for (const row of stored.rows ?? []) out[row.rowKey] = flatten(row.fieldValues, new Map(), fileNames)
      // item_list cells are free columns; the photograph column holds file ids.
      for (const rowKey of Object.keys(out)) {
        const cell = out[rowKey]
        if (cell.photograph?.fileIds) cell.photograph = { count: cell.photograph.fileIds.length, fileIds: cell.photograph.fileIds }
      }
      return out
    }
    if (section.repeatable_per === 'rack') {
      return rackList.map((rack) => {
        const row = (stored.rows ?? []).find((r) => String(r.rackId) === String(rack.id))
        return { rackId: rack.id, ...withCalculated(flatten(row?.fieldValues, fieldsByKey, fileNames), { rackCode: rack.code, rackPosition: rack.rackPosition }) }
      })
    }
    return withCalculated(flatten(stored.fieldValues, fieldsByKey, fileNames))
  })
}

export function recordCompleteness(tabDef, componentSections) {
  return computeTabCompleteness(tabDef, (section) => componentSections[tabDef.sections.indexOf(section)])
}

// --- Edit operations (online and offline replay share these) ----------------
//
// { kind: 'setField', sectionIndex, key, value, rowId?, rackId?, rowKey? }
// { kind: 'confirmField', sectionIndex, key, confirmed, rowId? }
// { kind: 'addRow', sectionIndex, rowId }            rowId chosen by the client (24-hex), so a replay is idempotent
// { kind: 'duplicateRow', sectionIndex, rowId, newRowId }
// { kind: 'removeRow', sectionIndex, rowId }
// `rowId` targets a table row, `rackId` a Rack Layout instance, `rowKey` an
// item_list row (then `key` is the column).

export const SURVEY_OP_KINDS = ['setField', 'confirmField', 'addRow', 'duplicateRow', 'removeRow']
const ROW_OPS = ['addRow', 'duplicateRow', 'removeRow']
const MAX_TEXT = 2000

function checkValue(field, value) {
  if (value === null) return null
  if (field && isFileField(field)) {
    const ok = value && Array.isArray(value.fileIds) && value.fileIds.every((id) => /^[a-f0-9]{24}$/.test(String(id)))
    return ok ? null : 'Expected file references'
  }
  if (typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'Not a number'
  if (typeof value === 'string') return value.length <= MAX_TEXT ? null : `At most ${MAX_TEXT} characters`
  return 'Unsupported value'
}

// Who may make an edit, and is it well-formed? `roles` are the caller's
// roles; `customFields` the organisation's custom fields for this tab.
// Returns null when allowed, or a message.
export function validateSurveyOp(tabDef, op, { roles = [], customFields = [] } = {}) {
  if (!SURVEY_OP_KINDS.includes(op?.kind)) return 'Unknown edit'
  const section = tabDef.sections[op.sectionIndex]
  if (!section) return 'No such section'
  const isFieldEngineer = roles.includes('field_engineer')
  const canPrefill = roles.includes('architect') || roles.includes('pm')

  if (ROW_OPS.includes(op.kind)) {
    if (!isFieldEngineer) return 'Only the Field Engineer fills the survey'
    if (section.layout !== 'table') return 'Rows can only be added to tables'
    if (!/^[a-f0-9]{24}$/.test(String(op.rowId ?? ''))) return 'A row needs an id'
    if (op.kind === 'duplicateRow' && !/^[a-f0-9]{24}$/.test(String(op.newRowId ?? ''))) return 'A duplicated row needs a new id'
    return null
  }

  const fields = op.sectionIndex === 0 ? [...section.fields, ...customFields] : section.fields
  let field
  if (section.layout === 'item_list') {
    if (!section.fields.some((f) => f.key === op.rowKey)) return 'No such row'
    if (!section.item_columns.includes(op.key)) return 'No such column'
    field = op.key === 'photograph' ? { key: 'photograph', type: 'photo' } : { key: op.key, type: 'text' }
  } else {
    field = fields.find((f) => f.key === op.key)
    if (!field) return 'No such field'
  }
  if (isCalculatedKey(tabDef, section, op.key)) return 'This field is calculated and read-only'
  if (section.layout === 'table' && !op.rowId) return 'A table cell needs its row'
  if (section.repeatable_per === 'rack' && !op.rackId) return 'A rack instance needs its rack'

  if (op.kind === 'confirmField') {
    if (!isFieldEngineer) return 'Only the Field Engineer confirms on site'
    if (field.prefill !== 'prefilled_validated') return 'This field has nothing to confirm'
    return null
  }
  // setField: the Field Engineer fills everything; Architect and PM may only
  // set prefill fields (before the survey — the server also requires Draft).
  if (!isFieldEngineer && !(canPrefill && field.prefill)) {
    return canPrefill ? 'Architects and PMs may only fill prefill fields' : 'Only the Field Engineer fills the survey'
  }
  return checkValue(field, op.value)
}

function setFV(list, key, patch, by, at) {
  const i = list.findIndex((fv) => fv.key === key)
  const before = i >= 0 ? list[i] : null
  const next = { key, value: before?.value ?? null, confirmed: before?.confirmed ?? false, ...patch, updatedBy: by, updatedAt: at }
  const out = i >= 0 ? list.map((fv, j) => (j === i ? next : fv)) : [...list, next]
  return { list: out, before }
}

// Applies one validated op to stored sections; returns the new sections and
// the field-level changes (for the audit entry and the conflict report).
export function applySurveyOp(tabDef, sections, op, { by, at }) {
  const all = tabDef.sections.map((section, sectionIndex) => {
    const s = sections?.find((x) => x.sectionIndex === sectionIndex)
    return { sectionIndex, layout: section.layout, fieldValues: s?.fieldValues ?? [], rows: s?.rows ?? [] }
  })
  const target = all[op.sectionIndex]
  const changes = []
  const fvPatch = op.kind === 'confirmField' ? { confirmed: Boolean(op.confirmed) } : { value: op.value }
  const field = op.kind === 'confirmField' ? 'confirmed' : 'value'

  const updateRow = (match, create) => {
    let row = target.rows.find(match)
    if (!row) {
      if (!create) return false
      row = create()
      target.rows = [...target.rows, row]
    }
    const { list, before } = setFV(row.fieldValues, op.key, fvPatch, by, at)
    target.rows = target.rows.map((r) => (r === row ? { ...row, fieldValues: list } : r))
    changes.push({ field: `${op.key}${op.rowKey ? `.${op.rowKey}` : ''}`, before: before?.[field] ?? null, after: fvPatch[field], previousBy: before?.updatedBy ?? null, previousAt: before?.updatedAt ?? null })
    return true
  }

  if (op.kind === 'addRow') {
    if (!target.rows.some((r) => String(r.rowId) === String(op.rowId))) target.rows = [...target.rows, { rowId: op.rowId, fieldValues: [] }]
    changes.push({ field: 'row', before: null, after: String(op.rowId) })
  } else if (op.kind === 'duplicateRow') {
    const source = target.rows.find((r) => String(r.rowId) === String(op.rowId))
    if (!source) return { sections: all, changes, missing: true }
    if (!target.rows.some((r) => String(r.rowId) === String(op.newRowId))) {
      const at2 = target.rows.indexOf(source) + 1
      const copy = { rowId: op.newRowId, fieldValues: source.fieldValues.map((fv) => ({ ...fv, updatedBy: by, updatedAt: at })) }
      target.rows = [...target.rows.slice(0, at2), copy, ...target.rows.slice(at2)]
    }
    changes.push({ field: 'row', before: null, after: String(op.newRowId) })
  } else if (op.kind === 'removeRow') {
    const removed = target.rows.find((r) => String(r.rowId) === String(op.rowId))
    const exists = Boolean(removed)
    target.rows = target.rows.filter((r) => String(r.rowId) !== String(op.rowId))
    // The row's latest cell change stands for "who last changed it".
    const latest = (removed?.fieldValues ?? []).reduce((acc, fv) => (fv.updatedAt && (!acc || new Date(fv.updatedAt) > new Date(acc.updatedAt)) ? fv : acc), null)
    changes.push({ field: 'row', before: String(op.rowId), after: null, previousBy: latest?.updatedBy ?? null, previousAt: latest?.updatedAt ?? null })
    if (!exists) return { sections: all, changes, missing: true }
  } else if (op.rowId) {
    if (!updateRow((r) => String(r.rowId) === String(op.rowId), null)) return { sections: all, changes, missing: true }
  } else if (op.rackId) {
    updateRow((r) => String(r.rackId) === String(op.rackId), () => ({ rowId: op.rackId, rackId: op.rackId, fieldValues: [] }))
  } else if (op.rowKey) {
    updateRow((r) => r.rowKey === op.rowKey, () => ({ rowId: null, rowKey: op.rowKey, fieldValues: [] }))
  } else {
    const { list, before } = setFV(target.fieldValues, op.key, fvPatch, by, at)
    target.fieldValues = list
    changes.push({ field: op.key, before: before?.[field] ?? null, after: fvPatch[field], previousBy: before?.updatedBy ?? null, previousAt: before?.updatedAt ?? null })
  }
  return { sections: all, changes }
}

// --- Workflow (DATA-MODEL §5.4) ----------------------------------------------

export const SURVEY_STATUSES = ['draft', 'submitted', 'verified', 'rejected', 'imported']

// Status after an edit: Rejected, Verified and Imported revert to Draft
// (Verified/Imported write a `survey.tab.reverted` audit entry; Imported also
// raises a design flag). A Submitted tab is locked until the Architect acts.
export function statusAfterEdit(status) {
  if (status === 'submitted') return { allowed: false, message: 'Submitted for verification — it can be edited again once the Architect verifies or rejects it' }
  return { allowed: true, next: 'draft', reverted: status === 'verified' || status === 'imported', flag: status === 'imported' }
}

export function checkTransition(action, status, { roles = [], complete = true, reason = '' } = {}) {
  const need = (role, label) => (roles.includes(role) ? null : `Only the ${label} can do that`)
  switch (action) {
    case 'submit':
      return need('field_engineer', 'Field Engineer') ?? (status !== 'draft' ? `A ${status} tab cannot be submitted` : null) ?? (complete ? null : 'Fill every "Must" field to submit')
    case 'verify':
      return need('architect', 'Architect') ?? (status !== 'submitted' ? 'Only a submitted tab can be verified' : null)
    case 'reject':
      return need('architect', 'Architect') ?? (status !== 'submitted' ? 'Only a submitted tab can be rejected' : null) ?? (String(reason).trim() ? null : 'A reason is required to reject')
    default:
      return 'Unknown action'
  }
}

// Every tab a building must have Verified: its building tabs once, and every
// room tab for every room.
export function expectedSurveyTabs(roomIds) {
  return [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...roomIds.flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]
}

// Survey phase status per building (brief §5.2, M3b): Approved when every
// room tab and building tab is Verified (or Imported) and the building has at
// least one room; Changes requested while any tab is Rejected; In progress
// once any tab has data or has moved on from Draft; otherwise Not started.
// `records` = [{ tab, roomId, status, hasData }].
export function computeSurveyPhaseStatus({ roomIds, records }) {
  const key = (tab, roomId) => `${tab}|${roomId ?? ''}`
  const byKey = new Map(records.map((r) => [key(r.tab, r.roomId), r]))
  const expected = expectedSurveyTabs(roomIds)
  const done = (r) => r && (r.status === 'verified' || r.status === 'imported')
  if (roomIds.length > 0 && expected.every((e) => done(byKey.get(key(e.tab, e.roomId))))) return 'approved'
  if (records.some((r) => r.status === 'rejected')) return 'changes_requested'
  if (records.some((r) => r.hasData || r.status !== 'draft')) return 'in_progress'
  return 'not_started'
}

// --- Membership scope: moved to scope.js (re-exported for existing imports) ---

export { scopeCoversBuilding } from './scope.js'
