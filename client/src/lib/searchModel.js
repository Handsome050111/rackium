import { SEARCH_TYPES } from '@rackium/shared/search.js'

const TYPE_LABEL = Object.fromEntries(SEARCH_TYPES.map((t) => [t.key, t.label]))

// The top bar's results by type (M7a-2): groups in the order their best
// result came (the server ranks: current project, then exact / prefix /
// contains), each keeping that order; every item numbered for the keyboard.
export function groupResults(results) {
  const groups = []
  const byType = new Map()
  for (const r of results) {
    if (!byType.has(r.type)) {
      const g = { type: r.type, label: TYPE_LABEL[r.type] ?? r.type, items: [] }
      byType.set(r.type, g)
      groups.push(g)
    }
    byType.get(r.type).items.push(r)
  }
  let index = 0
  return groups.map((g) => ({ ...g, items: g.items.map((r) => ({ ...r, index: index++ })) }))
}
