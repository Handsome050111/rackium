import { describe, it, expect } from 'vitest'
import { withLegacyName, deviceDisplayName } from './deviceName.js'
import { buildLocationTree } from './locationTree.js'
import { cmdbRowsOf, cmdbExtract } from './documents/assemble.js'
import { cableLabels } from './documents/labels.js'
import { MATCH_LABEL } from './search.js'

// M7b-2 (addendum v2.3 Q5; DATA-MODEL §5.19): a device renamed through a
// change request keeps its old name, shown "old → new".
describe('the old name of a renamed device', () => {
  it('reads "old → new"; the plain name without an old one, or when it is the same again', () => {
    expect(withLegacyName('E-DE-ERL-C01-B001-EG-009', 'E-DE-ERL-C01-B001-EG-001')).toBe('E-DE-ERL-C01-B001-EG-001 → E-DE-ERL-C01-B001-EG-009')
    expect(withLegacyName('VT-A1', 'PP-TR-EG-02-R01-01')).toBe('PP-TR-EG-02-R01-01 → VT-A1')
    expect(withLegacyName('E-1', null)).toBe('E-1')
    expect(withLegacyName('E-1', '  ')).toBe('E-1')
    expect(withLegacyName('E-1', 'E-1')).toBe('E-1')
    // The display name itself is unchanged (it is what the arrow points to).
    expect(deviceDisplayName({ hostname: 'E-2', legacyHostname: 'E-1' })).toBe('E-2')
  })

  it('the deployment location tree names a renamed device "old → new", by hostname or (a panel) by its name', () => {
    const tree = buildLocationTree({
      building: { id: 'b', name: 'B001' },
      floors: [{ id: 'f', name: 'EG', order: 0 }],
      rooms: [{ id: 'r', code: 'TR-EG-01', floorId: 'f' }],
      racks: [{ id: 'k', code: 'R01', roomId: 'r' }],
      devices: [
        { id: 'e', hostname: 'E-2', legacyHostname: 'E-1', label: 'E-1 → E-2', name: 'E-2', roomId: 'r', rackId: 'k', status: 'installed', deliveryReady: true },
        { id: 'p', hostname: null, legacyHostname: 'PP-01', label: 'PP-01 → VT-A1', name: 'VT-A1', roomId: 'r', rackId: 'k', status: 'installed', deliveryReady: true },
        { id: 'a', hostname: 'A-1', legacyHostname: null, label: 'A-1', name: 'A-1', roomId: 'r', rackId: 'k', status: 'planned', deliveryReady: false },
      ],
    })
    const names = JSON.stringify(tree)
    expect(names).toContain('"E-1 → E-2"')
    expect(names).toContain('"PP-01 → VT-A1"')
    expect(names).not.toContain('PP-01 → PP-01')
    expect(names).toContain('"A-1"')
  })

  it('the CMDB extract has a Legacy hostname column (CSV and JSON)', () => {
    const records = [
      { id: 'e', hostname: 'E-2', legacyHostname: 'E-1', label: 'E-1 → E-2', roleLabel: 'Edge', statusLabel: 'Accepted', dguv: null },
      { id: 'a', hostname: 'A-1', legacyHostname: null, label: 'A-1', roleLabel: 'AP', statusLabel: 'Accepted', dguv: null },
    ]
    expect(cmdbRowsOf(records).map((r) => [r.hostname, r.legacyHostname])).toEqual([['E-2', 'E-1'], ['A-1', '']])
    const out = cmdbExtract({ building: { code: 'B001' }, generatedAt: new Date() }, { records, connections: [], cableMatrix: [] })
    expect(out.sheet.rows[0].slice(0, 3)).toEqual(['Hostname', 'Legacy hostname', 'Role'])
    expect(out.sheet.rows[1].slice(0, 2)).toEqual(['E-2', 'E-1'])
    expect(out.json.records.map((r) => r.legacyHostname)).toEqual(['E-1', null])
  })

  it('cable labels name each end as given ("old → new" for a renamed device); search reports a match on the old name', () => {
    const [a, b] = cableLabels([{ id: 'c', segments: [{ cableId: 'C-1', from: { name: 'E-1 → E-2', portId: 'Gi1/0/1' }, to: { name: 'A-1', portId: 'Eth0' } }] }])
    expect(a).toMatchObject({ here: 'E-1 → E-2 Gi1/0/1', far: 'A-1 Eth0' })
    expect(b).toMatchObject({ here: 'A-1 Eth0', far: 'E-1 → E-2 Gi1/0/1' })
    expect(MATCH_LABEL.legacyHostname).toBe('Old hostname')
  })
})
