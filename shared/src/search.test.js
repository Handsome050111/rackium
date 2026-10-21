import { describe, it, expect } from 'vitest'
import { macQuery, portQuery, samePort, parseQuery, matchRank, bestMatch, orderResults, escapeRegex } from './search.js'

describe('Global search queries (M7a-2)', () => {
  it('a MAC in any notation becomes the stored form; a part of one becomes a prefix', () => {
    for (const q of ['00:1A:2B:3C:4D:5E', '00-1a-2b-3c-4d-5e', '001a.2b3c.4d5e', '001A2B3C4D5E', ' 00 1a 2b 3c 4d 5e ']) expect(macQuery(q)).toEqual({ full: '00:1a:2b:3c:4d:5e' })
    expect(macQuery('00-1A-2B')).toEqual({ prefix: '00:1a:2b' })
    expect(macQuery('001a2')).toEqual({ prefix: '00:1a:2' })
    // Not MAC-shaped: other letters, too short, plain short numbers.
    expect(macQuery('SW-ERL-01')).toBeNull()
    expect(macQuery('0a1')).toBeNull()
    expect(macQuery('1234')).toBeNull()
    expect(macQuery('001a2b3c4d5e6f')).toBeNull()
  })

  it('panel-port queries: a panel name and a port number, with any separator', () => {
    for (const q of ['PP-01 08', 'PP-01/08', 'PP-01:8', 'PP-01 port 8', 'PP-01 p8', 'pp-01 #8']) expect(portQuery(q)).toMatchObject({ port: 8 })
    expect(portQuery('PP-01/08').panel).toBe('PP-01')
    expect(portQuery('Patch panel A 12')).toEqual({ panel: 'Patch panel A', port: 12 })
    expect(portQuery('PP-01')).toBeNull()
    expect(portQuery('12 08')).toBeNull()
    expect(samePort('08', 8)).toBe(true)
    expect(samePort('8', 8)).toBe(true)
    expect(samePort('Gi1/0/8', 8)).toBe(false)
    expect(samePort(null, 8)).toBe(false)
  })

  it('a query is 2 to 100 characters, whitespace collapsed', () => {
    expect(parseQuery('a')).toBeNull()
    expect(parseQuery('x'.repeat(101))).toBeNull()
    expect(parseQuery('  B0   01 ')).toMatchObject({ text: 'B0 01', lower: 'b0 01' })
  })

  it('exact before prefix before contains, case-insensitive; the best field wins', () => {
    expect(matchRank('SW-ERL-01', 'sw-erl-01')).toBe(0)
    expect(matchRank('SW-ERL-01', 'sw-erl')).toBe(1)
    expect(matchRank('SW-ERL-01', 'erl')).toBe(2)
    expect(matchRank('SW-ERL-01', 'muc')).toBeNull()
    expect(matchRank(null, 'x')).toBeNull()
    expect(bestMatch({ hostname: 'AP-VT-01', existingLabel: 'VT-A-01' }, 'vt-a-01')).toEqual({ rank: 0, field: 'existingLabel' })
    expect(escapeRegex('a.b*(c)')).toBe('a\\.b\\*\\(c\\)')
  })

  it('the current project first, then rank, type and title; capped', () => {
    const r = [
      { projectId: 'p2', rank: 0, type: 'device', title: 'B' },
      { projectId: 'p1', rank: 2, type: 'device', title: 'Z' },
      { projectId: 'p1', rank: 0, type: 'rack', title: 'R' },
      { projectId: 'p1', rank: 0, type: 'building', title: 'B001' },
    ]
    expect(orderResults(r, { currentProjectId: 'p1' }).map((x) => x.title)).toEqual(['B001', 'R', 'Z', 'B'])
    expect(orderResults(r, { limit: 2 })).toHaveLength(2)
  })
})
