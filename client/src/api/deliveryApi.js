import { API_MODE } from '../lib/apiMode.js'
import { apiRequest } from './httpClient.js'
import { PROCUREMENT_LABELS } from '@rackium/shared/procurement.js'

const real = API_MODE === 'real'
const base = (orgId, projectId) => `/orgs/${orgId}/projects/${projectId}`
const none = (value) => Promise.resolve(value)

// Real mode only (M5a). Mock mode keeps api/bomDesign.js,
// api/solutionPackageDesign.js and api/shareLink.js.
export const deliveryApi = {
  commercial: (o, p) => (real ? apiRequest(`${base(o, p)}/commercial-settings`) : none(null)),
  setCommercial: (o, p, body) => (real ? apiRequest(`${base(o, p)}/commercial-settings`, { method: 'PATCH', body }) : none(null)),
  bom: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/bom/buildings/${buildingId}`) : none(null)),
  approveBom: (o, p, body) => (real ? apiRequest(`${base(o, p)}/bom/approve`, { method: 'POST', body }) : none(null)),
  updateLine: (o, p, body) => (real ? apiRequest(`${base(o, p)}/bom/lines`, { method: 'PATCH', body }) : none(null)),
  solutionPackage: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/solution-package/buildings/${buildingId}`) : none(null)),
  updateGroup: (o, p, groupKey, body) => (real ? apiRequest(`${base(o, p)}/solution-package/groups/${groupKey}`, { method: 'PUT', body }) : none(null)),
  acceptWarning: (o, p, body) => (real ? apiRequest(`${base(o, p)}/solution-package/accept-warning`, { method: 'POST', body }) : none(null)),
  submitPackage: (o, p, body) => (real ? apiRequest(`${base(o, p)}/solution-package/submit`, { method: 'POST', body }) : none(null)),
  extendLink: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/share-links/${id}/extend`, { method: 'POST', body }) : none(null)),
  revokeLink: (o, p, id) => (real ? apiRequest(`${base(o, p)}/share-links/${id}/revoke`, { method: 'POST', body: {} }) : none(null)),
  changeRequests: (o, p, buildingId) => (real ? apiRequest(`${base(o, p)}/change-requests/buildings/${buildingId}`) : none({ changeRequests: [] })),
  changeRequest: (o, p, id) => (real ? apiRequest(`${base(o, p)}/change-requests/${id}`) : none(null)),
  createChangeRequest: (o, p, body) => (real ? apiRequest(`${base(o, p)}/change-requests`, { method: 'POST', body }) : none(null)),
  updateChangeRequest: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/change-requests/${id}`, { method: 'PATCH', body }) : none(null)),
  submitChangeRequest: (o, p, id) => (real ? apiRequest(`${base(o, p)}/change-requests/${id}/submit`, { method: 'POST', body: {} }) : none(null)),
  sendChangeRequest: (o, p, id, body) => (real ? apiRequest(`${base(o, p)}/change-requests/${id}/send`, { method: 'POST', body }) : none(null)),
  withdrawChangeRequest: (o, p, id) => (real ? apiRequest(`${base(o, p)}/change-requests/${id}/withdraw`, { method: 'POST', body: {} }) : none(null)),
}

// The public approval page (no login): token in the path, password in every body.
const pub = (token) => `/public/share-links/${encodeURIComponent(token)}`
export const publicApprovalApi = {
  status: (token) => (real ? apiRequest(pub(token)) : none(null)),
  view: (token, password) => (real ? apiRequest(`${pub(token)}/view`, { method: 'POST', body: { password } }) : none(null)),
  decide: (token, body) => (real ? apiRequest(`${pub(token)}/decision`, { method: 'POST', body }) : none(null)),
}

// --- Pure helpers (unit-tested) ------------------------------------------------

export const majorUnits = (minor) => (minor == null ? null : Math.round(minor) / 100)

// A server BOM line as the prototype BomTable's line (prices in major units).
export function toTableLine(line) {
  return {
    ...line,
    unitPrice: majorUnits(line.unitPriceMinor),
    lineTotal: majorUnits(line.lineTotalMinor),
    procurementStatus: PROCUREMENT_LABELS[line.procurement?.status ?? 'not_ordered'],
    vendor: line.procurement?.vendor ?? line.vendor ?? null,
  }
}

// The client BOM export (PM chooses, brief §5.6): `sell` = prices including
// the margin, which itself is never shown; `none` = quantities only.
export function clientBomSheet(lines, { mode, marginPercent, currency }) {
  const sell = (minor) => (minor == null ? '' : Math.round(minor * (1 + (Number(marginPercent) || 0) / 100)) / 100)
  const head = ['Category', 'Item', 'Specification', 'Qty', 'Unit', ...(mode === 'sell' ? [`Unit price (${currency})`, `Line total (${currency})`] : [])]
  const rows = lines.map((l) => [l.category, l.item, l.spec, l.qty, l.unit, ...(mode === 'sell' ? [sell(l.unitPriceMinor), sell(l.lineTotalMinor)] : [])])
  if (mode === 'sell') {
    const total = lines.reduce((n, l) => n + (l.lineTotalMinor ?? 0), 0)
    rows.push(['', '', 'Total', '', '', '', sell(total)])
  }
  return [head, ...rows]
}

// The internal BOM / procurement export: every line with its procurement facts.
export function procurementSheet(lines, { showPrices }) {
  const head = ['Category', 'Item', 'Specification', 'Source', 'Reason', 'Qty', 'Unit', ...(showPrices ? ['Unit price', 'Line total'] : []), 'Status', 'Vendor', 'PO number', 'Expected delivery', 'Actual delivery', 'Notes']
  const rows = lines.map((l) => [
    l.category,
    l.item,
    l.spec,
    l.source,
    l.basis,
    l.qty,
    l.unit,
    ...(showPrices ? [majorUnits(l.unitPriceMinor) ?? 'Not priced', majorUnits(l.lineTotalMinor) ?? ''] : []),
    PROCUREMENT_LABELS[l.procurement?.status ?? 'not_ordered'],
    l.procurement?.vendor ?? '',
    l.procurement?.poNumber ?? '',
    l.procurement?.expectedDelivery ?? '',
    l.procurement?.actualDelivery ?? '',
    l.procurement?.notes ?? '',
  ])
  return [head, ...rows]
}

export async function downloadSheet(rows, sheetName, fileName) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName)
  XLSX.writeFile(book, fileName)
}

// The Solution Package view as the prototype components' shapes.
export function toRegisterGroups(groups) {
  return groups.map((g) => ({ ...g, id: g.key, owner: g.ownerName ?? null }))
}
export const toWarningRows = (warnings) => warnings.map((w) => ({ ...w, id: w.areaKey }))
export const toAreaRows = (areas) => areas.map((a) => ({ ...a, id: a.key }))

// One edit to a group's list (addressing entries or key/value pairs), applied
// to the list as it is when the queued save runs — not as it was when the
// field was rendered (regression: a quick second blur saved a stale list and
// wiped the first field's value).
export function editList(list, op) {
  if (op.type === 'add') return [...list, op.item]
  if (op.type === 'remove') return list.filter((x) => x.id !== op.id)
  return list.map((x) => (x.id === op.id ? { ...x, ...op.patch } : x))
}
