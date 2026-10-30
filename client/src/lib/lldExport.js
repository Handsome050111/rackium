// Cable Schedule → Excel (SheetJS). The client's SC spreadsheet headings
// have not arrived yet, so SC_COLUMNS holds PLACEHOLDER headings — swap the
// `heading` strings here when they do; nothing else needs to change.
import { DEPLOYMENT_PLACEHOLDER } from '@rackium/shared/lldModel.js'

const metres = (n) => (n == null ? '' : n)

export const SC_COLUMNS = [
  { heading: 'Cable ID', value: (r) => r.cableId ?? '' },
  { heading: 'Source Device', value: (r) => r.source.entity.hostname ?? r.source.entity.label },
  { heading: 'Source Port', value: (r) => r.source.port ?? '' },
  { heading: 'Hops', value: (r) => (r.hops.length === 0 ? 'Direct' : r.hops.map((h) => h.label).join(' > ')) },
  // The route with panel sides (real mode); the prototype's rows have none.
  { heading: 'Route', value: (r) => r.trace ?? '' },
  { heading: 'Destination Device', value: (r) => r.dest.entity.hostname ?? r.dest.entity.label },
  { heading: 'Destination Port', value: (r) => r.dest.port ?? '' },
  { heading: 'Media', value: (r) => r.mediaLabel },
  { heading: 'Speed', value: (r) => r.speed },
  { heading: 'Suggested Length (m)', value: (r) => metres(r.length.suggested) },
  { heading: 'Engineer Selected Length (m)', value: (r) => metres(r.length.effective) },
  { heading: 'Installed Length (m)', value: () => DEPLOYMENT_PLACEHOLDER },
  { heading: 'Pathway', value: (r) => (r.length.estimated ? 'Estimated' : 'Surveyed / local') },
  { heading: 'Status', value: (r) => r.statusLabel },
]

// Real mode (M5a review): every cable of a route is its own physical cable,
// so the schedule lists one line per cable, with the connection it belongs to.
export const CABLE_COLUMNS = [
  { heading: 'Cable ID', value: (r, s) => s.cableId ?? '' },
  { heading: 'Connection', value: (r) => r.cableId ?? '' },
  { heading: 'Cable', value: (r, s) => `${s.index + 1} of ${r.segments.length}` },
  { heading: 'From', value: (r, s) => s.from },
  { heading: 'To', value: (r, s) => s.to },
  { heading: 'Type', value: (r, s) => s.kindLabel },
  { heading: 'Media', value: (r) => r.mediaLabel },
  { heading: 'Speed', value: (r) => r.speed },
  { heading: 'Suggested Length (m)', value: (r, s) => metres(s.length.suggested) },
  { heading: 'Engineer Selected Length (m)', value: (r, s) => metres(s.length.effective) },
  { heading: 'Installed Length (m)', value: (r, s) => (s.length.installed == null ? DEPLOYMENT_PLACEHOLDER : s.length.installed) },
  { heading: 'Pathway', value: (r, s) => (s.length.estimated ? 'Estimated' : 'Surveyed / local') },
  { heading: 'Route', value: (r) => r.trace ?? '' },
  { heading: 'Status', value: (r, s) => (s.cableId ? r.statusLabel : 'Cable ID pending') },
]

export function buildCableScheduleSheet(rows) {
  if (rows.some((r) => r.segments?.length)) {
    return [CABLE_COLUMNS.map((c) => c.heading), ...rows.flatMap((r) => r.segments.map((s) => CABLE_COLUMNS.map((c) => c.value(r, s))))]
  }
  return [SC_COLUMNS.map((c) => c.heading), ...rows.map((r) => SC_COLUMNS.map((c) => c.value(r)))]
}

// SheetJS is loaded on demand so it stays out of the main bundle.
export async function exportCableScheduleXlsx(rows, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildCableScheduleSheet(rows))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Cable Schedule')
  XLSX.writeFile(book, fileName)
}

// Placeholder headings here too, matching the render's table (v2.2 §3.7
// Tab 3) until the client's real headings arrive.
export const PORT_SCHEDULE_COLUMNS = [
  { heading: 'Device', value: (r) => r.deviceLabel },
  { heading: 'Interface', value: (r) => r.port },
  { heading: 'Type', value: (r) => r.type },
  { heading: 'Speed', value: (r) => r.speed },
  { heading: 'Status', value: (r) => r.status },
  { heading: 'Connected To', value: (r) => r.destination },
  { heading: 'Cable ID', value: (r) => r.cableId ?? '' },
  { heading: 'VLAN', value: (r) => r.vlan ?? '' },
  { heading: 'PoE', value: (r) => r.poe },
]

export function buildPortScheduleSheet(rows) {
  return [PORT_SCHEDULE_COLUMNS.map((c) => c.heading), ...rows.map((r) => PORT_SCHEDULE_COLUMNS.map((c) => c.value(r)))]
}

export async function exportPortScheduleXlsx(rows, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildPortScheduleSheet(rows))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Port Schedule')
  XLSX.writeFile(book, fileName)
}
