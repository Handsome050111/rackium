// The rows of the stock-length table (brief §6.3): Cat6A per situation,
// the other media one list each.
export const ROWS = [
  { key: 'cat6a.same-rack', label: 'Cat6A — same rack' },
  { key: 'cat6a.same-room', label: 'Cat6A — same room' },
  { key: 'cat6a.cross-room', label: 'Cat6A — cross room' },
  { key: 'os2', label: 'OS2 single-mode' },
  { key: 'om4', label: 'OM4 multimode' },
  { key: 'dac', label: 'DAC' },
  { key: 'stack', label: 'Stack cable' },
]

export const get = (table, key) => key.split('.').reduce((o, k) => o?.[k], table) ?? []

// "1, 2,3 " → [1, 2, 3]; null when not ascending positive numbers.
export function parseLengthList(text) {
  const parts = String(text).split(/[,\s]+/).filter(Boolean)
  if (!parts.length) return null
  const list = parts.map(Number)
  if (list.some((n) => !Number.isFinite(n) || n <= 0)) return null
  if (list.some((n, i) => i > 0 && n <= list[i - 1])) return null
  return list
}

export function tableFromTexts(texts) {
  const out = { cat6a: {} }
  for (const row of ROWS) {
    const list = parseLengthList(texts[row.key])
    if (!list) return { error: `${row.label}: enter ascending lengths in metres, separated by commas` }
    const [media, situation] = row.key.split('.')
    if (situation) out.cat6a[situation] = list
    else out[media] = list
  }
  return { table: out }
}
