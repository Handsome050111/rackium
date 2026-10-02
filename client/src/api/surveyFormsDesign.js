// Survey form tabs (brief v2.3 §5.2, Step 10) — the generic engine behind
// every one of the 18 tabs in docs/survey-fields.json. One record shape per
// tab-instance: `{ sections: [sectionData, ...] }`, index-aligned with the
// tab definition's own `sections` array, so a tab that mixes layouts
// (Location Details has a key_value section *and* a table section) still
// has one coherent record. `sectionData`'s own shape depends on that
// section's layout — see the comment above each mutator below.
import { getBuildingSiteStructure } from './siteStructure.js'
import { getRackSurveyContext } from './survey.js'
import { getRackSurveyMeta } from '../mock/rackSurveyMeta.js'
import { getCmoForRoom } from './cmoDesign.js'
import { getDevices } from './networkStore.js'
import { updatePhaseStatus } from './buildings.js'
import { SURVEY_TABS, getTabDefinition, computeTabCompleteness, isFieldFilled, matchSerial } from '../lib/surveyFormModel.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

let idCounter = 1
function newId(prefix) {
  return `${prefix}-${Date.now()}-${idCounter++}`
}

// key -> { sections: [...] }
const recordsByKey = {}
// key -> { status, submittedAt, submittedBy, verifiedAt, verifiedBy, rejectedAt, rejectReason }
const statusByKey = {}
// tabName -> [{ key, label, type }], Org Admin additions (brief: "stored and
// shown but never used in calculations" — so they never appear in any
// completeness/required count, only in the rendered form).
const customFieldsByTab = {}

function effectiveTabDef(tabName) {
  const base = getTabDefinition(tabName)
  if (!base) return null
  const customFields = customFieldsByTab[tabName]
  if (!customFields || customFields.length === 0) return base
  const sections = base.sections.map((s, i) => (i === 0 ? { ...s, fields: [...s.fields, ...customFields.map((f) => ({ ...f, requirement: 'unspecified', custom: true }))] } : s))
  return { ...base, sections }
}

function recordKeyFor(tabDef, buildingId, roomId) {
  return tabDef.scope === 'building' ? `building:${buildingId}:${tabDef.tab}` : `room:${roomId}:${tabDef.tab}`
}

function emptySectionData(section) {
  if (section.layout === 'table') return []
  if (section.layout === 'item_list') return {}
  if (section.repeatable_per) return [] // Rack Layout: one instance per real rack, reconciled in getSurveyTabContext
  return {} // key_value, gallery
}

function recordFor(key, tabDef) {
  if (!recordsByKey[key]) {
    recordsByKey[key] = { sections: tabDef.sections.map(emptySectionData) }
  }
  return recordsByKey[key]
}

function statusFor(key) {
  return (statusByKey[key] ??= { status: 'draft', submittedAt: null, submittedBy: null, verifiedAt: null, verifiedBy: null, rejectedAt: null, rejectReason: null })
}

// --- Calculated-field context (brief: "Auto-fill from existing data where
// obvious... show such fields as calculated/read-only") -------------------

async function buildingTreeFor(buildingId) {
  const { buildings } = await getBuildingSiteStructure(buildingId)
  return buildings[0]
}

async function calculatedContextFor(buildingId, roomId) {
  const tree = await buildingTreeFor(buildingId)
  const base = { buildingName: tree.buildingName, buildingCode: tree.buildingCode }
  if (!roomId) return base
  for (const floor of tree.floors) {
    const room = floor.rooms.find((r) => r.id === roomId)
    if (room) return { ...base, floorName: floor.name, roomCode: room.code }
  }
  return base
}

// --- Reads -----------------------------------------------------------------

export async function getSurveyTabContext(buildingId, tabName, roomId) {
  const tabDef = effectiveTabDef(tabName)
  if (!tabDef) return Promise.reject(new Error(`Unknown survey tab: ${tabName}`))
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  const status = statusFor(key)
  const ctx = await calculatedContextFor(buildingId, tabDef.scope === 'room' ? roomId : null)

  let rackList = null
  if (tabDef.sections.some((s) => s.repeatable_per === 'rack')) {
    const tree = await buildingTreeFor(buildingId)
    const racks = tree.floors.flatMap((f) => f.rooms.find((r) => r.id === roomId)?.racks ?? [])
    rackList = racks.map((r, i) => ({ id: r.id, code: r.code, heightU: r.heightU, rackPosition: i + 1 }))
    // Reconcile the repeatable_per section's instances 1:1 with real racks —
    // a rack added in Site Structure since this tab was last opened gets a
    // blank instance; one that's been removed is dropped.
    const sectionIndex = tabDef.sections.findIndex((s) => s.repeatable_per === 'rack')
    const existing = record.sections[sectionIndex]
    record.sections[sectionIndex] = racks.map((r) => existing.find((inst) => inst.rackId === r.id) ?? { rackId: r.id })
  }

  const completeness = computeTabCompleteness(tabDef, (section) => record.sections[tabDef.sections.indexOf(section)])

  return resolveAfter({
    tabDef,
    record,
    status,
    completeness,
    ctx,
    rackList,
    rackStatsByCode: tabDef.tab === 'Comms Rooms Summary' ? await rackStatsForRoom(buildingId, roomId) : null,
  })
}

// Comms Rooms Summary's note: "Mostly calculated from Rack Layout data;
// validate on site" — when a row's "Rack Number" cell matches a real rack
// in the room, its RU/power-socket columns become calculated/read-only
// instead of re-typed (brief: "Comms Rooms Summary RU counts calculated
// from the rack survey"). Resolved once per room load, keyed by rack code
// so the table can look it up synchronously per row during render.
async function rackStatsForRoom(buildingId, roomId) {
  const tree = await buildingTreeFor(buildingId)
  const racks = tree.floors.flatMap((f) => f.rooms.find((r) => r.id === roomId)?.racks ?? [])
  const entries = await Promise.all(
    racks.map(async (r) => {
      const survey = await getRackSurveyContext(r.id)
      const usedRu = survey.placements.filter((p) => p.mounting === 'rack').reduce((sum, p) => sum + p.heightU, 0)
      const meta = getRackSurveyMeta(r.id)
      return [
        r.code,
        {
          total_number_rack_units: r.heightU,
          used_rus_in_existing_racks: usedRu,
          unused_rus_in_existing_racks: r.heightU - usedRu,
          free_power_sockets_in_existing_rack_pdu_1: meta.mountingPower.pduA?.freeSockets ?? 0,
          free_power_sockets_in_existing_rack_pdu_2: meta.mountingPower.pduB?.freeSockets ?? 0,
        },
      ]
    })
  )
  return Object.fromEntries(entries)
}

export async function getRoomSurveyProgress(buildingId, roomId) {
  const roomTabs = SURVEY_TABS.filter((t) => t.scope === 'room')
  const results = await Promise.all(
    roomTabs.map(async (t) => {
      const { status, completeness } = await getSurveyTabContext(buildingId, t.tab, roomId)
      return { tab: t.tab, status: status.status, completeness }
    })
  )
  return { tabs: results, allVerified: results.every((r) => r.status === 'verified' || r.status === 'imported') }
}

export async function getBuildingSurveyProgress(buildingId) {
  const tree = await buildingTreeFor(buildingId)
  const allRooms = tree.floors.flatMap((f) => f.rooms)

  const buildingTabs = SURVEY_TABS.filter((t) => t.scope === 'building')
  const buildingResults = await Promise.all(
    buildingTabs.map(async (t) => {
      const { status, completeness } = await getSurveyTabContext(buildingId, t.tab, null)
      return { tab: t.tab, roomId: null, status: status.status, completeness }
    })
  )
  const roomResults = (
    await Promise.all(allRooms.map((room) => getRoomSurveyProgress(buildingId, room.id).then((p) => p.tabs.map((t) => ({ ...t, roomId: room.id, roomCode: room.code })))))
  ).flat()

  const all = [...buildingResults, ...roomResults]
  const verifiedCount = all.filter((r) => r.status === 'verified' || r.status === 'imported').length
  const allVerified = all.length > 0 && verifiedCount === all.length

  // Opportunistic push, same pattern as cmdbDesign.js/deploymentDesign.js:
  // the 'survey' phase badge is derived from real tab-verification state
  // every time this is read, rather than requiring every mutator above to
  // remember to update it.
  const anyStarted = all.some((r) => r.status !== 'draft')
  await updatePhaseStatus(buildingId, 'survey', allVerified ? 'approved' : anyStarted ? 'in_progress' : 'not_started')

  return resolveAfter({ tabs: all, totalCount: all.length, verifiedCount, allVerified })
}

// --- Mutators ----------------------------------------------------------

function touch(key) {
  const s = statusFor(key)
  // Any edit after a rejection returns a tab to Draft — editing after
  // Submitted/Verified does not silently revert those states; the explicit
  // actions below (submit/verify/reject) are the only way to change status
  // other than this one rejection-recovery case.
  if (s.status === 'rejected') s.status = 'draft'
  // lib/offlineQueue.js's conflict check compares against this: a queued
  // offline edit conflicts if the live record was touched again (by
  // anyone) after the edit was queued.
  s.lastModifiedAt = new Date().toISOString()
}

// Used by the offline sync flow to decide whether a queued edit still
// applies cleanly or now conflicts with a change made while this device
// was offline.
export async function getRecordModifiedAt(buildingId, tabName, roomId) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  return resolveAfter(statusFor(key).lastModifiedAt ?? null)
}

// key_value / gallery sections: `patch` merges into the section's flat
// record, same "merge against the live record, not a client snapshot"
// pattern as requiredInputsStore.js, so two fast edits never clobber each
// other.
export async function updateKeyValueSection(buildingId, tabName, roomId, sectionIndex, patch) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  record.sections[sectionIndex] = { ...record.sections[sectionIndex], ...patch }
  touch(key)
  return resolveAfter({ ok: true })
}

export async function confirmPrefillField(buildingId, tabName, roomId, sectionIndex, fieldKey) {
  return updateKeyValueSection(buildingId, tabName, roomId, sectionIndex, { [`${fieldKey}__confirmed`]: true })
}

export async function addTableRow(buildingId, tabName, roomId, sectionIndex) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  const row = { id: newId('row') }
  record.sections[sectionIndex] = [...record.sections[sectionIndex], row]
  touch(key)
  return resolveAfter(row)
}

export async function duplicateTableRow(buildingId, tabName, roomId, sectionIndex, rowId) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  const source = record.sections[sectionIndex].find((r) => r.id === rowId)
  const row = { ...source, id: newId('row') }
  record.sections[sectionIndex] = [...record.sections[sectionIndex], row]
  touch(key)
  return resolveAfter(row)
}

export async function removeTableRow(buildingId, tabName, roomId, sectionIndex, rowId) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  record.sections[sectionIndex] = record.sections[sectionIndex].filter((r) => r.id !== rowId)
  touch(key)
  return resolveAfter({ ok: true })
}

export async function updateTableRow(buildingId, tabName, roomId, sectionIndex, rowId, patch) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  record.sections[sectionIndex] = record.sections[sectionIndex].map((r) => (r.id === rowId ? { ...r, ...patch } : r))
  touch(key)
  return resolveAfter({ ok: true })
}

// item_list: record.sections[i] = { [rowFieldKey]: { [column]: value } }
export async function updateItemListCell(buildingId, tabName, roomId, sectionIndex, rowFieldKey, column, value) {
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  const section = record.sections[sectionIndex]
  record.sections[sectionIndex] = { ...section, [rowFieldKey]: { ...section[rowFieldKey], [column]: value } }
  touch(key)
  return resolveAfter({ ok: true })
}

// Rack Layout's repeatable_per:'rack' section: record.sections[0] = [{
// rackId, ...fieldValues }], one entry per real rack (reconciled on read).
export async function updateRackInstance(buildingId, roomId, rackId, patch) {
  const tabDef = effectiveTabDef('Rack Layout')
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const record = recordFor(key, tabDef)
  record.sections[0] = record.sections[0].map((inst) => (inst.rackId === rackId ? { ...inst, ...patch } : inst))
  touch(key)
  return resolveAfter({ ok: true })
}

// --- Serial validation (brief: "serial — validate against CMO + project
// duplicates, same logic as Step 3/4's device scanner") -------------------

export async function validateSurveySerial(roomId, serial) {
  const cmoEntries = getCmoForRoom(roomId)
  const projectSerials = getDevices()
    .filter((d) => d.installation?.serial)
    .map((d) => ({ deviceId: d.id, serial: d.installation.serial }))
  return matchSerial(serial, cmoEntries, projectSerials, null)
}

// --- Workflow: Draft -> Submitted -> Verified / Rejected -> Imported -----

export async function submitSurveyTab(buildingId, tabName, roomId, role) {
  if (role !== 'field_engineer') return resolveAfter({ ok: false, error: 'Only the Field Engineer submits a survey tab.' })
  const { tabDef, completeness } = await getSurveyTabContext(buildingId, tabName, roomId)
  if (!completeness.complete) return resolveAfter({ ok: false, error: 'All required fields must be filled before submitting.' })
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const s = statusFor(key)
  s.status = 'submitted'
  s.submittedAt = new Date().toISOString()
  s.submittedBy = role
  return resolveAfter({ ok: true })
}

export async function verifySurveyTab(buildingId, tabName, roomId, role) {
  if (role !== 'architect') return resolveAfter({ ok: false, error: 'Only the Architect verifies a survey tab.' })
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const s = statusFor(key)
  if (s.status !== 'submitted') return resolveAfter({ ok: false, error: 'Only a submitted tab can be verified.' })
  s.status = 'verified'
  s.verifiedAt = new Date().toISOString()
  s.verifiedBy = role
  return resolveAfter({ ok: true })
}

export async function rejectSurveyTab(buildingId, tabName, roomId, role, comment) {
  if (role !== 'architect') return resolveAfter({ ok: false, error: 'Only the Architect can reject a survey tab.' })
  if (!comment?.trim()) return resolveAfter({ ok: false, error: 'A rejection reason is required.' })
  const tabDef = effectiveTabDef(tabName)
  const key = recordKeyFor(tabDef, buildingId, roomId)
  const s = statusFor(key)
  if (s.status !== 'submitted') return resolveAfter({ ok: false, error: 'Only a submitted tab can be rejected.' })
  s.status = 'rejected'
  s.rejectedAt = new Date().toISOString()
  s.rejectReason = comment.trim()
  return resolveAfter({ ok: true })
}

export async function importBuildingIntoHld(buildingId, role) {
  if (role !== 'architect' && role !== 'pm') return resolveAfter({ ok: false, error: 'Only the Architect or PM can import the survey into HLD.' })
  const progress = await getBuildingSurveyProgress(buildingId)
  if (!progress.allVerified) return resolveAfter({ ok: false, error: 'Every tab must be Verified before import.' })
  for (const r of progress.tabs) {
    const tabDef = effectiveTabDef(r.tab)
    const key = recordKeyFor(tabDef, buildingId, r.roomId)
    statusFor(key).status = 'imported'
  }
  return resolveAfter({ ok: true })
}

// --- Custom fields (brief: "Org Admin can add extra fields to a tab; they
// are stored and shown but never used in calculations") -------------------

export async function addCustomField(tabName, field, role) {
  if (role !== 'org_admin') return resolveAfter({ ok: false, error: 'Only the Org Admin can add a custom field.' })
  if (!field.label?.trim()) return resolveAfter({ ok: false, error: 'A field label is required.' })
  customFieldsByTab[tabName] ??= []
  const entry = { key: `custom_${newId('field')}`, label: field.label.trim(), type: field.type ?? 'text' }
  customFieldsByTab[tabName].push(entry)
  return resolveAfter({ ok: true, field: entry })
}

export { isFieldFilled }
