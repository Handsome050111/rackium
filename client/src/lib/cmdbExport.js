// CMDB inventory -> Excel (SheetJS), same lazy-load pattern as
// lib/lldExport.js / lib/bomExport.js.
export const CMDB_COLUMNS = [
  { heading: 'Hostname', value: (r) => r.hostname },
  { heading: 'Role', value: (r) => r.role },
  { heading: 'Model', value: (r) => r.model },
  { heading: 'Floor', value: (r) => r.floorName ?? '' },
  { heading: 'Room', value: (r) => r.roomCode ?? '' },
  { heading: 'Rack / RU', value: (r) => (r.rackCode ? `${r.rackCode} / RU${r.ru ?? '—'}` : '') },
  { heading: 'Serial Number', value: (r) => r.serial ?? '' },
  { heading: 'MAC Address', value: (r) => r.mac ?? '' },
  { heading: 'Lifecycle', value: (r) => r.lifecycle },
  { heading: 'Acceptance', value: (r) => r.acceptance },
  { heading: 'DGUV Status', value: (r) => (r.dguv ? r.dguv.status : 'n/a') },
]

export function buildCmdbSheet(rows) {
  return [CMDB_COLUMNS.map((c) => c.heading), ...rows.map((r) => CMDB_COLUMNS.map((c) => c.value(r)))]
}

export async function exportCmdbXlsx(rows, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildCmdbSheet(rows))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'CMDB Inventory')
  XLSX.writeFile(book, fileName)
}

// Handover's "CMDB extract" document (v2.2 §3.11) is CSV + PDF — the CSV
// half is real, the PDF half is a document-engine stub like everything
// else PDF in this prototype.
export async function exportCmdbCsv(rows, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildCmdbSheet(rows))
  XLSX.writeFile({ Sheets: { Sheet1: sheet }, SheetNames: ['Sheet1'] }, fileName)
}

// Port Connectivity screen's per-port export (brief page 18): one row per
// access/uplink-module port, not per CI, so it's a separate sheet shape
// from the inventory export above.
export const CONNECTION_COLUMNS = [
  { heading: 'Port', value: (p) => p.port },
  { heading: 'State', value: (p) => p.state },
  { heading: 'Destination', value: (p) => p.destination ?? '' },
  { heading: 'Cable ID', value: (p) => p.cableId ?? '' },
  { heading: 'Medium', value: (p) => p.medium ?? '' },
  { heading: 'Validation', value: (p) => p.validation ?? '' },
]

export function buildConnectionsSheet(ports) {
  return [CONNECTION_COLUMNS.map((c) => c.heading), ...ports.map((p) => CONNECTION_COLUMNS.map((c) => c.value(p)))]
}

export async function exportConnectionsXlsx(ports, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildConnectionsSheet(ports))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Port Connectivity')
  XLSX.writeFile(book, fileName)
}
