// Global search (brief v2.3 §6.12; M7a-2): what a query means and how a match
// ranks. Pure — the server runs the lookups with these and checks every result
// with the screen's own access rule before returning it.

export const SEARCH_MIN = 2
export const SEARCH_MAX = 100
export const SEARCH_LIMIT = 50

// The kinds of result, in the order the top bar groups them.
export const SEARCH_TYPES = [
  { key: 'project', label: 'Projects' },
  { key: 'country', label: 'Countries' },
  { key: 'sal', label: 'SAL codes' },
  { key: 'campus', label: 'Campuses' },
  { key: 'building', label: 'Buildings' },
  { key: 'floor', label: 'Floors' },
  { key: 'room', label: 'Rooms' },
  { key: 'rack', label: 'Racks' },
  { key: 'device', label: 'Devices' },
  { key: 'cable', label: 'Cables' },
  { key: 'port', label: 'Panel ports' },
]
export const SEARCH_TYPE_KEYS = SEARCH_TYPES.map((t) => t.key)

// What a device result matched on, shown under its name.
export const MATCH_LABEL = {
  hostname: 'Hostname',
  label: 'Name',
  existingLabel: 'Existing label / name',
  legacyHostname: 'Old hostname',
  serial: 'Serial',
  mac: 'MAC',
  assetTag: 'Asset ID',
  cableId: 'Cable ID',
  code: 'Code',
  name: 'Name',
}

const collapse = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')

// A MAC in any notation — colons, dashes, Cisco dots, spaces or none — to the
// stored form (lower case, colon-separated): `full` for all 12 digits,
// `prefix` for the first 4 to 11 (e.g. "00-1A-2B" → "00:1a:2b"). null when
// the query is not MAC-shaped.
export function macQuery(q) {
  const s = collapse(q)
  if (!s || /[^0-9a-f:.\- ]/i.test(s)) return null
  const hex = s.replace(/[:.\- ]/g, '').toLowerCase()
  if (hex.length < 4 || hex.length > 12) return null
  // Plain digits are a serial or a port more often than a MAC fragment.
  if (/^\d+$/.test(hex) && hex.length < 12) return null
  const pairs = hex.match(/.{1,2}/g).join(':')
  return hex.length === 12 ? { full: pairs } : { prefix: pairs }
}

// "PP-01 08", "PP-01/08", "PP-01:8", "PP-01 port 8", "PP-01 p8" → the panel's
// name and the port. null when the query does not end in a port number.
export function portQuery(q) {
  const s = collapse(q)
  const m = s.match(/^(.+?)(?:\s*[/:#]\s*|\s+(?:port\s*|p)?)(\d{1,3})$/i)
  if (!m) return null
  const panel = m[1].trim()
  if (panel.length < 2 || /^\d+$/.test(panel)) return null
  return { panel, port: Number(m[2]) }
}

// Port ids compare as numbers when they are numbers ("08" is port 8).
export function samePort(portId, port) {
  if (portId == null) return false
  const s = String(portId).trim()
  return /^\d+$/.test(s) ? Number(s) === port : false
}

// Everything the server needs about one query.
export function parseQuery(raw) {
  const text = collapse(raw)
  if (text.length < SEARCH_MIN || text.length > SEARCH_MAX) return null
  return { text, lower: text.toLowerCase(), mac: macQuery(text), port: portQuery(text) }
}

// How well `value` matches: 0 exact, 1 prefix, 2 contains, null none
// (case-insensitive, whitespace collapsed).
export function matchRank(value, lowerQuery) {
  if (value == null) return null
  const v = collapse(value).toLowerCase()
  if (!v) return null
  if (v === lowerQuery) return 0
  if (v.startsWith(lowerQuery)) return 1
  if (v.includes(lowerQuery)) return 2
  return null
}

// The best rank over a result's fields, with the field that gave it.
export function bestMatch(fields, lowerQuery) {
  let best = null
  for (const [field, value] of Object.entries(fields)) {
    const rank = matchRank(value, lowerQuery)
    if (rank != null && (!best || rank < best.rank)) best = { rank, field }
  }
  return best
}

// Escapes a string for use inside a RegExp.
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The final order: the current project first, then rank, then type order,
// then title — and at most `limit`.
export function orderResults(results, { currentProjectId = null, limit = SEARCH_LIMIT } = {}) {
  const typeIndex = (t) => SEARCH_TYPE_KEYS.indexOf(t)
  return [...results]
    .sort(
      (a, b) =>
        Number(b.projectId === currentProjectId) - Number(a.projectId === currentProjectId) ||
        a.rank - b.rank ||
        typeIndex(a.type) - typeIndex(b.type) ||
        String(a.title).localeCompare(String(b.title))
    )
    .slice(0, limit)
}
