// The neutral document model (M6b): assembly functions (one per document)
// turn data into this; renderers turn it into PDF (HTML), Word, Excel or
// CSV. Pure and easy to test from fixtures.
//
// doc = { title, subtitle, meta: { project, building, client, version, date },
//         sections: [{ id, title, blocks: [Block], children?: [section] }] }
// Block = { type: 'p', text } | { type: 'kv', rows: [[label, value]] }
//       | { type: 'table', columns: [{ key, label }], rows: [{}], caption?, empty? }
//       | { type: 'list', items: [string] } | { type: 'note', text, tone? }
//       | { type: 'svg', svg, caption? } | { type: 'image', fileId, caption? }
//       | { type: 'pagebreak' }

export const p = (text) => ({ type: 'p', text: String(text ?? '') })
// A sub-heading inside a section (not in the contents), e.g. a table's title.
export const h3 = (text) => ({ type: 'h3', text: String(text ?? '') })
export const kv = (rows) => ({ type: 'kv', rows: rows.filter((r) => r && r[1] !== undefined).map(([k, v]) => [k, v == null || v === '' ? '—' : String(v)]) })
export const table = (columns, rows, { caption = null, empty = 'None.' } = {}) => ({
  type: 'table',
  columns: columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c)),
  rows: rows.map((r) => Object.fromEntries(columns.map((c) => [typeof c === 'string' ? c : c.key, cell(r[typeof c === 'string' ? c : c.key])]))),
  caption,
  empty,
})
export const list = (items) => ({ type: 'list', items: items.map(String) })
export const note = (text, tone = 'info') => ({ type: 'note', text, tone })
export const svg = (markup, caption = null) => ({ type: 'svg', svg: markup, caption })
export const image = (fileId, caption = null) => ({ type: 'image', fileId: String(fileId), caption })
export const section = (id, title, blocks = [], children = []) => ({ id, title, blocks: blocks.filter(Boolean), children })

function cell(v) {
  if (v == null || v === '') return '—'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return typeof v === 'number' ? v : String(v)
}
export const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—')
export const yesNo = (b) => (b ? 'Yes' : 'No')

// Every section title in reading order with its number (1, 1.1, …) — the
// table of contents and the tests read it.
export function outline(doc) {
  const out = []
  const walk = (sections, prefix) =>
    sections.forEach((s, i) => {
      const n = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      out.push({ id: s.id, n, title: s.title, depth: prefix ? prefix.split('.').length : 0 })
      walk(s.children ?? [], n)
    })
  walk(doc.sections, '')
  return out
}

// All text of a document model, for tests and search.
export function plainText(doc) {
  const lines = [doc.title, doc.subtitle ?? '']
  const walk = (sections) =>
    sections.forEach((s) => {
      lines.push(s.title)
      for (const b of s.blocks) {
        if (b.type === 'p' || b.type === 'note' || b.type === 'h3') lines.push(b.text)
        if (b.type === 'kv') b.rows.forEach(([k, v]) => lines.push(`${k}: ${v}`))
        if (b.type === 'list') lines.push(...b.items)
        if (b.type === 'table') {
          lines.push(b.columns.map((c) => c.label).join(' | '))
          b.rows.forEach((r) => lines.push(b.columns.map((c) => r[c.key]).join(' | ')))
        }
      }
      walk(s.children ?? [])
    })
  walk(doc.sections)
  return lines.join('\n')
}

// At most `max` photos are printed (M6b review): the rest are left out with a
// note where they were cut and one at the start ("further photos in the
// evidence ZIP"). Returns how many were left out.
export function capImages(doc, max) {
  let seen = 0
  let dropped = 0
  const walk = (sections) =>
    sections.forEach((s) => {
      let here = 0
      s.blocks = s.blocks.filter((b) => {
        if (b.type !== 'image') return true
        seen += 1
        if (seen <= max) return true
        here += 1
        return false
      })
      if (here) s.blocks.push(note(`${here} further photo(s) of this section are not printed here — they are in the photo evidence ZIP.`, 'warning'))
      dropped += here
      walk(s.children ?? [])
    })
  walk(doc.sections)
  if (dropped && doc.sections[0]) doc.sections[0].blocks.unshift(note(`This document prints the first ${max} photos; ${dropped} further photo(s) are in the photo evidence ZIP.`, 'warning'))
  return dropped
}

// A table block as sheet rows (header first) — Excel and CSV exports.
export const sheetOf = (name, block) => ({ name, rows: [block.columns.map((c) => c.label), ...block.rows.map((r) => block.columns.map((c) => r[c.key]))] })

// RFC 4180 CSV; cells that look like formulas are prefixed (as the audit export does).
export function toCsv(rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
}
