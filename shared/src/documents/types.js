// Generated documents (brief v2.2 §3.11, §10, §11.8; v2.3 §5.5, §5.9; M6b).
// One registry: what each document is, its formats, whether it belongs to
// the handover package, and whether it can carry prices.

export const DOCUMENT_TYPES = [
  // The 11 handover documents (v2.2 §3.11), in package order.
  { key: 'exec-summary', name: 'Executive summary', formats: ['pdf'], handover: ['pdf'] },
  { key: 'survey-report', name: 'Survey report', formats: ['pdf'], handover: ['pdf'] },
  { key: 'hld-document', name: 'HLD document', formats: ['pdf'], handover: ['pdf'] },
  { key: 'lld-document', name: 'LLD document', formats: ['pdf'], handover: ['pdf'] },
  { key: 'cable-matrix', name: 'Cable schedule, cable matrix and port schedule', formats: ['xlsx'], handover: ['xlsx'] },
  { key: 'bom-final', name: 'BOM', formats: ['xlsx', 'pdf'], handover: ['xlsx'], prices: true },
  { key: 'deployment-report', name: 'Deployment report', formats: ['pdf'], handover: ['pdf'] },
  { key: 'cmdb-extract', name: 'CMDB extract', formats: ['csv', 'json', 'pdf'], handover: ['csv', 'pdf'] },
  { key: 'as-built', name: 'As-built vs as-designed', formats: ['pdf'], handover: ['pdf'] },
  { key: 'exception-register', name: 'Exception register', formats: ['pdf'], handover: ['pdf'] },
  { key: 'photo-evidence', name: 'Photo evidence pack', formats: ['zip'], handover: ['zip'] },
  // Other documents.
  { key: 'solution-package', name: 'Solution Package', formats: ['pdf', 'docx'], prices: true },
  { key: 'dguv-report', name: 'DGUV V3 report', formats: ['pdf', 'xlsx'] },
  { key: 'topology-diagram', name: 'Topology diagram', formats: ['svg', 'png'] },
  { key: 'audit-log', name: 'Audit log', formats: ['csv', 'pdf'], scope: 'project' },
  { key: 'cable-labels', name: 'Cable labels', formats: ['pdf'] },
  { key: 'handover-package', name: 'Handover package', formats: ['zip'], system: true },
]
export const DOCUMENT_TYPE_KEYS = DOCUMENT_TYPES.map((t) => t.key)
export const HANDOVER_TYPES = DOCUMENT_TYPES.filter((t) => t.handover)
export const typeOf = (key) => DOCUMENT_TYPES.find((t) => t.key === key) ?? null
export const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx', 'csv', 'json', 'zip', 'svg', 'png']
export const FORMAT_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip',
  svg: 'image/svg+xml',
  png: 'image/png',
}
// Price modes (M5a rules): `none` for everyone; `sell` (the client's price,
// margin applied and never shown) and `cost` only for those who may see prices.
export const PRICE_MODES = ['none', 'sell', 'cost']

// The handover package is complete when every document has every handover format ready.
export const HANDOVER_FILE_COUNT = HANDOVER_TYPES.reduce((n, t) => n + t.handover.length, 0)

export const fileNameOf = ({ buildingCode, typeKey, version, format }) => `${buildingCode ? `${buildingCode}-` : ''}${typeKey}-v${version}.${format}`

// Why a request cannot be made (null: it can). `roles`: the caller's
// project roles; `canSeePrices`: from the M5a rule.
export function requestProblem({ typeKey, format, options = {}, roles = [], canSeePrices = false }) {
  const type = typeOf(typeKey)
  if (!type || type.system) return 'Unknown document type'
  if (!type.formats.includes(format)) return `${type.name} is not available as ${format.toUpperCase()}`
  const prices = options.prices ?? 'none'
  if (!PRICE_MODES.includes(prices)) return 'Unknown price mode'
  if (prices !== 'none' && !type.prices) return `${type.name} has no prices`
  if (prices !== 'none' && !canSeePrices) return 'Only those who may see prices can export them'
  if (typeKey === 'audit-log' && !roles.some((r) => ['org_admin', 'pm', 'architect', 'reviewer'].includes(r))) return 'Only an Org Admin, PM, Architect or Reviewer exports the audit log'
  return null
}
