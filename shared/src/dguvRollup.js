// DGUV V3 compliance rollup (brief v2.2 §20.9.3, §20.9.6; M7a-2): device →
// rack → room → floor → building → project, plus SAL and country. Each item
// is one installed mains-powered device with its status on the organisation's
// local date (deployment.js dguvStatus) or `not_inspected`. Pure.

export const DGUV_LEVELS = ['project', 'country', 'sal', 'building', 'floor', 'room', 'rack', 'device']
// What each level lists when opened.
export const DGUV_CHILD = { project: 'country', country: 'sal', sal: 'building', building: 'floor', floor: 'room', room: 'rack', rack: 'device' }
export const DGUV_LEVEL_LABEL = { project: 'Project', country: 'Country', sal: 'SAL', building: 'Building', floor: 'Floor', room: 'Room', rack: 'Rack', device: 'Device' }

// Statuses, worst first. Not inspected counts with overdue for compliance
// (a device with no inspection has none due), but is listed on its own.
export const DGUV_STATES = ['overdue', 'not_inspected', 'expiring', 'expiring_soon', 'valid']
export const DGUV_STATE_LABEL = { overdue: 'Overdue', not_inspected: 'Not inspected', expiring: 'Expiring (≤ 30 days)', expiring_soon: 'Expiring soon (≤ 90 days)', valid: 'Valid' }
const severity = (s) => DGUV_STATES.length - DGUV_STATES.indexOf(s)

// The field of an item that identifies its place at a level.
const LEVEL_FIELD = { country: 'countryId', sal: 'salId', building: 'buildingId', floor: 'floorId', room: 'roomId', rack: 'rackId', device: 'deviceId' }

export const stateOf = (item) => (item.inspected ? item.status : 'not_inspected')

export function emptyCounts() {
  return { total: 0, valid: 0, expiring_soon: 0, expiring: 0, overdue: 0, not_inspected: 0 }
}

// Counts, the worst state and the compliant share (inspected and not overdue).
export function summarise(items) {
  const counts = emptyCounts()
  let worst = null
  for (const item of items) {
    const s = stateOf(item)
    counts.total += 1
    counts[s] += 1
    if (!worst || severity(s) > severity(worst)) worst = s
  }
  const compliant = counts.valid + counts.expiring_soon + counts.expiring
  return { counts, worst, compliantPct: counts.total ? Math.round((compliant / counts.total) * 100) : null }
}

// The items under one node: `level` and its id (the project: everything).
export function itemsUnder(items, level, id) {
  if (level === 'project') return items
  const field = LEVEL_FIELD[level]
  return items.filter((i) => String(i[field] ?? '') === String(id ?? ''))
}

// One node opened: its own summary and a row per child (a child with no
// place at that level — a device not in a rack — is one row with id null).
export function rollup(items, level, id = null) {
  const under = itemsUnder(items, level, id)
  const childLevel = DGUV_CHILD[level] ?? null
  const rows = []
  if (childLevel) {
    const field = LEVEL_FIELD[childLevel]
    const groups = new Map()
    for (const item of under) {
      const key = item[field] == null ? null : String(item[field])
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
    for (const [key, list] of groups) rows.push({ level: childLevel, id: key, ...summarise(list) })
    // Worst first, then most devices.
    rows.sort((a, b) => severity(b.worst) - severity(a.worst) || b.counts.total - a.counts.total)
  }
  return { level, id, ...summarise(under), childLevel, rows }
}

// The devices of a node, optionally of one state, worst and soonest due first.
export function devicesOf(items, level, id = null, state = null) {
  return itemsUnder(items, level, id)
    .filter((i) => !state || stateOf(i) === state)
    .sort((a, b) => severity(stateOf(b)) - severity(stateOf(a)) || String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')) || String(a.label).localeCompare(String(b.label)))
}
