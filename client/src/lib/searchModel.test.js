import { describe, it, expect } from 'vitest'
import { groupResults } from './searchModel.js'

describe('Top-bar search results (M7a-2)', () => {
  it('groups by type in the order of their best result, keeps the order, numbers every item', () => {
    const r = (type, title) => ({ type, title })
    const groups = groupResults([r('device', 'SW-1'), r('building', 'B001'), r('device', 'SW-2'), r('cable', 'C-1')])
    expect(groups.map((g) => [g.label, g.items.map((i) => [i.title, i.index])])).toEqual([
      ['Devices', [['SW-1', 0], ['SW-2', 1]]],
      ['Buildings', [['B001', 2]]],
      ['Cables', [['C-1', 3]]],
    ])
    expect(groupResults([])).toEqual([])
  })
})
