// BOM -> Excel (SheetJS), same lazy-load pattern as lib/lldExport.js.
export const BOM_COLUMNS = [
  { heading: 'Category', value: (l) => l.category },
  { heading: 'Item', value: (l) => l.item },
  { heading: 'Specification', value: (l) => l.spec },
  { heading: 'Basis', value: (l) => l.basis },
  { heading: 'Qty', value: (l) => l.qty },
  { heading: 'Unit', value: (l) => l.unit },
  { heading: 'Status', value: (l) => l.status },
  { heading: 'Vendor', value: (l) => l.vendor ?? '' },
  { heading: 'Procurement status', value: (l) => l.procurementStatus },
  { heading: 'Unit price', value: (l) => l.unitPrice ?? '' },
  { heading: 'Line total', value: (l) => l.lineTotal ?? '' },
]

export function buildBomSheet(lines) {
  return [BOM_COLUMNS.map((c) => c.heading), ...lines.map((l) => BOM_COLUMNS.map((c) => c.value(l)))]
}

export async function exportBomXlsx(lines, fileName) {
  const XLSX = await import('xlsx')
  const sheet = XLSX.utils.aoa_to_sheet(buildBomSheet(lines))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'BOM')
  XLSX.writeFile(book, fileName)
}
