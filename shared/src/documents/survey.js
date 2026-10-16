// Survey data for the survey report (M6b review): every section of a stored
// tab record as the report shows it — key/value sections as label/value
// pairs, table and item-list sections as full tables (rows and columns),
// photos collected for the report. Pure; the template (docs/survey-fields.json)
// supplies the labels.

const humanise = (key) => String(key).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function cellText(field, value) {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') {
    if (Array.isArray(value.fileIds)) return `${value.fileIds.length} ${field?.type === 'file' ? 'file' : 'photo'}(s)`
    if ('lat' in value && 'lng' in value) return `${value.lat}, ${value.lng}`
    return JSON.stringify(value)
  }
  return String(value)
}
const photoIdsOf = (field, value) => (value && typeof value === 'object' && Array.isArray(value.fileIds) && field?.type !== 'file' ? value.fileIds.map(String) : [])

// tabDef: the template tab; record: the stored record ({ tab, status, sections });
// rackCodeOf(rackId) names a rack for per-rack rows.
export function surveyTabForReport(tabDef, record, { rackCodeOf = () => null } = {}) {
  const fields = []
  const tables = []
  const photos = []
  for (const stored of record.sections ?? []) {
    const def = tabDef?.sections?.[stored.sectionIndex]
    const byKey = new Map((def?.fields ?? []).map((f) => [f.key, f]))
    const title = def?.section ?? 'Section'
    for (const fv of stored.fieldValues ?? []) {
      const f = byKey.get(fv.key)
      photos.push(...photoIdsOf(f, fv.value))
      const text = cellText(f, fv.value)
      if (text) fields.push({ label: f?.label ?? humanise(fv.key), value: text })
    }
    const rows = stored.rows ?? []
    if (!rows.length && !['table', 'item_list'].includes(def?.layout ?? stored.layout)) continue
    if ((def?.layout ?? stored.layout) === 'item_list') {
      const columnKeys = def?.item_columns ?? [...new Set(rows.flatMap((r) => (r.fieldValues ?? []).map((fv) => fv.key)))]
      tables.push({
        title,
        columns: [{ key: '__item', label: 'Item' }, ...columnKeys.map((k) => ({ key: k, label: humanise(k) }))],
        rows: rows.map((r) => {
          const out = { __item: byKey.get(r.rowKey)?.label ?? humanise(r.rowKey ?? '') }
          for (const fv of r.fieldValues ?? []) {
            photos.push(...photoIdsOf({ type: 'photo_multi' }, fv.value))
            out[fv.key] = cellText(null, fv.value)
          }
          return out
        }),
      })
      continue
    }
    const perRack = rows.some((r) => r.rackId)
    const columns = [...(perRack ? [{ key: '__rack', label: 'Rack' }] : []), ...(def?.fields ?? []).map((f) => ({ key: f.key, label: f.label }))]
    tables.push({
      title,
      columns,
      rows: rows.map((r) => {
        const out = perRack ? { __rack: rackCodeOf(r.rackId) ?? '' } : {}
        for (const fv of r.fieldValues ?? []) {
          const f = byKey.get(fv.key)
          photos.push(...photoIdsOf(f, fv.value))
          out[fv.key] = cellText(f, fv.value)
        }
        return out
      }),
    })
  }
  return { tab: record.tab, status: record.status, fields, tables, photos }
}
