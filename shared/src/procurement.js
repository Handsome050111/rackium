// Procurement line statuses (brief v2.3 §5.6; DATA-MODEL §4.10, M5a). Pure.
// Forward through the steps; a quotation may be skipped (straight to
// Ordered); before ordering one step back is allowed; once ordered there is
// no going back. Ordered needs a PO number, Delivered an actual delivery date.
export const PROCUREMENT_STATUSES = ['not_ordered', 'quotation_requested', 'quoted', 'ordered', 'shipped', 'delivered']
export const PROCUREMENT_LABELS = {
  not_ordered: 'Not ordered',
  quotation_requested: 'Quotation requested',
  quoted: 'Quoted',
  ordered: 'Ordered',
  shipped: 'Shipped',
  delivered: 'Delivered',
}
export const PROCUREMENT_TRANSITIONS = {
  not_ordered: ['quotation_requested', 'ordered'],
  quotation_requested: ['quoted', 'not_ordered'],
  quoted: ['ordered', 'quotation_requested'],
  ordered: ['shipped'],
  shipped: ['delivered'],
  delivered: [],
}

export const nextStatuses = (status) => PROCUREMENT_TRANSITIONS[status] ?? []

// The problem with a requested change, or null. `current`: the stored line
// ({ status, poNumber, actualDelivery }); `patch`: the requested fields.
export function procurementProblem(current, patch) {
  const from = current?.status ?? 'not_ordered'
  const to = patch.status ?? from
  if (!PROCUREMENT_STATUSES.includes(to)) return `Unknown status ${to}`
  if (to !== from && !nextStatuses(from).includes(to)) {
    const allowed = nextStatuses(from).map((s) => PROCUREMENT_LABELS[s])
    return `${PROCUREMENT_LABELS[from]} cannot move to ${PROCUREMENT_LABELS[to]}${allowed.length ? ` — next: ${allowed.join(' or ')}` : ' — the line is complete'}`
  }
  const po = patch.poNumber !== undefined ? patch.poNumber : current?.poNumber
  if (['ordered', 'shipped', 'delivered'].includes(to) && !String(po ?? '').trim()) return 'An ordered line needs a PO number'
  const actual = patch.actualDelivery !== undefined ? patch.actualDelivery : current?.actualDelivery
  if (to === 'delivered' && !actual) return 'A delivered line needs the actual delivery date'
  return null
}
