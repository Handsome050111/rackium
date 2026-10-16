// QR cable labels (M6b): printable sheets for common label stock. Two labels
// per cable — one for each end — with the cable ID, this end and the far end,
// and a QR code linking to the connection record (sign-in required).

// Sizes in millimetres. Sheets are A4; single labels print one per page.
export const LABEL_SIZES = [
  { key: 'avery-l7651', name: 'Avery L7651 — 38.1 × 21.2 mm, 65 per A4 sheet', width: 38.1, height: 21.2, cols: 5, rows: 13, marginTop: 10.7, marginLeft: 4.7, gapX: 2.5, gapY: 0, page: { width: 210, height: 297 } },
  { key: 'avery-l7160', name: 'Avery L7160 — 63.5 × 38.1 mm, 21 per A4 sheet', width: 63.5, height: 38.1, cols: 3, rows: 7, marginTop: 15.1, marginLeft: 7.2, gapX: 2.5, gapY: 0, page: { width: 210, height: 297 } },
  { key: 'brady-54x25', name: 'Brady / DYMO 54 × 25 mm single labels', width: 54, height: 25, cols: 1, rows: 1, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0, page: { width: 54, height: 25 } },
]
export const LABEL_SIZE_KEYS = LABEL_SIZES.map((s) => s.key)
export const labelSize = (key) => LABEL_SIZES.find((s) => s.key === key) ?? null

// The client path a QR code opens: the app resolves the connection for the
// signed-in user (404 outside their scope).
export const connectionPath = (orgId, projectId, connectionId) => `/l/${orgId}/${projectId}/c/${connectionId}`

// Labels for the chosen connections: per cable segment, two ends.
// connections: [{ id, segments: [{ cableId, from: { name, portId }, to: { name, portId } }] }]
export function cableLabels(connections) {
  const out = []
  for (const c of connections) {
    for (const s of c.segments ?? []) {
      const id = s.cableId ?? '(no cable ID)'
      out.push({ connectionId: c.id, cableId: id, here: `${s.from.name} ${s.from.portId ?? ''}`.trim(), far: `${s.to.name} ${s.to.portId ?? ''}`.trim(), end: 'A' })
      out.push({ connectionId: c.id, cableId: id, here: `${s.to.name} ${s.to.portId ?? ''}`.trim(), far: `${s.from.name} ${s.from.portId ?? ''}`.trim(), end: 'B' })
    }
  }
  return out
}

// Labels placed on pages: [{ page, x, y, label }] in mm from the top-left.
export function layoutLabels(labels, sizeKey) {
  const size = labelSize(sizeKey)
  if (!size) throw new Error(`Unknown label size ${sizeKey}`)
  const perPage = size.cols * size.rows
  return labels.map((label, i) => {
    const k = i % perPage
    return { page: Math.floor(i / perPage), x: size.marginLeft + (k % size.cols) * (size.width + size.gapX), y: size.marginTop + Math.floor(k / size.cols) * (size.height + size.gapY), label }
  })
}
