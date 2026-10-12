import { describe, it, expect, vi, afterEach } from 'vitest'
import { toTableLine, clientBomSheet, procurementSheet, toRegisterGroups, toAreaRows, toWarningRows, majorUnits, editList } from './deliveryApi.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, error) => ({ ok: false, status, json: async () => ({ error }) })
async function loadReal() {
  vi.stubEnv('VITE_API_MODE', 'real')
  vi.resetModules()
  return import('./deliveryApi.js')
}

describe('M5a delivery API module', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('mock mode never touches the network', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.resetModules()
    const { deliveryApi, publicApprovalApi } = await import('./deliveryApi.js')
    expect(await deliveryApi.bom('o', 'p', 'b')).toBeNull()
    expect(await deliveryApi.changeRequests('o', 'p', 'b')).toEqual({ changeRequests: [] })
    expect(await publicApprovalApi.status('t')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('request shapes: procurement line keys travel in the body; the public page sends the password every time', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    const { deliveryApi, publicApprovalApi } = await loadReal()
    await deliveryApi.updateLine('o', 'p', { buildingId: 'b', lineKey: 'cord:c13/c14', status: 'ordered', poNumber: 'PO-1', version: 2 })
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/orgs/o/projects/p/bom/lines')
    expect(fetch.mock.calls[0][1].method).toBe('PATCH')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ lineKey: 'cord:c13/c14', version: 2 })
    await deliveryApi.updateGroup('o', 'p', 'addressing', { buildingId: 'b', addressingEntries: [], baseRevision: 3 })
    expect(fetch.mock.calls[1][0]).toBe('/api/v1/orgs/o/projects/p/solution-package/groups/addressing')
    expect(fetch.mock.calls[1][1].method).toBe('PUT')
    await publicApprovalApi.view('tok-en_1', 'secret')
    expect(fetch.mock.calls[2][0]).toBe('/api/v1/public/share-links/tok-en_1/view')
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ password: 'secret' })
    await publicApprovalApi.decide('tok-en_1', { password: 'secret', decision: 'approved' })
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toMatchObject({ password: 'secret', decision: 'approved' })
  })

  it('surfaces a locked link and an expired link as codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(fail(429, { code: 'link_locked', message: 'Too many wrong passwords.' })).mockResolvedValueOnce(fail(410, { code: 'link_expired', message: 'Expired' })))
    const { publicApprovalApi } = await loadReal()
    await expect(publicApprovalApi.view('t', 'x')).rejects.toMatchObject({ code: 'link_locked', status: 429 })
    await expect(publicApprovalApi.decide('t', {})).rejects.toMatchObject({ code: 'link_expired', status: 410 })
  })
})

const lines = [
  { key: 'device:1', category: 'Network devices', item: 'C9300', spec: 'E-1', source: 'HLD', basis: 'Planned edge', qty: 1, unit: 'Each', unitPriceMinor: 420000, lineTotalMinor: 420000, procurement: { status: 'ordered', vendor: 'Cisco', poNumber: 'PO-1', expectedDelivery: '2026-11-01', actualDelivery: null, notes: null } },
  { key: 'cable:os2:50', category: 'Cables', item: 'OS2 fibre patch cord', spec: '50 m', source: 'LLD', basis: 'C-1', qty: 2, unit: 'Each', unitPriceMinor: 6000, lineTotalMinor: 12000, procurement: { status: 'not_ordered' } },
  { key: 'item:pp', category: 'Power & accessories', item: 'Patch panel', spec: '', source: 'LLD', basis: 'PP', qty: 1, unit: 'Each', unitPriceMinor: null, lineTotalMinor: null, procurement: { status: 'not_ordered' } },
]

describe('BOM helpers', () => {
  it('server lines as the prototype table: major units and procurement labels', () => {
    expect(toTableLine(lines[0])).toMatchObject({ unitPrice: 4200, lineTotal: 4200, procurementStatus: 'Ordered', vendor: 'Cisco' })
    expect(toTableLine(lines[2])).toMatchObject({ unitPrice: null, procurementStatus: 'Not ordered' })
    expect(majorUnits(12345)).toBe(123.45)
  })

  it('the client export shows sell prices (margin included, never shown) or no prices at all', () => {
    const sell = clientBomSheet(lines, { mode: 'sell', marginPercent: 15, currency: 'EUR' })
    expect(sell[0]).toEqual(['Category', 'Item', 'Specification', 'Qty', 'Unit', 'Unit price (EUR)', 'Line total (EUR)'])
    expect(sell[1].slice(5)).toEqual([4830, 4830])
    expect(sell[2].slice(5)).toEqual([69, 138])
    expect(sell[3].slice(5)).toEqual(['', ''])
    expect(sell.at(-1)).toEqual(['', '', 'Total', '', '', '', 4968])
    expect(JSON.stringify(sell)).not.toMatch(/margin|15%|4200/i)
    const none = clientBomSheet(lines, { mode: 'none', marginPercent: 15, currency: 'EUR' })
    expect(none[0]).toEqual(['Category', 'Item', 'Specification', 'Qty', 'Unit'])
    expect(none).toHaveLength(4)
  })

  it('the procurement export lists every line with its facts; prices only for those who may see them', () => {
    const withPrices = procurementSheet(lines, { showPrices: true })
    expect(withPrices[0]).toContain('Unit price')
    expect(withPrices[1]).toEqual(['Network devices', 'C9300', 'E-1', 'HLD', 'Planned edge', 1, 'Each', 4200, 4200, 'Ordered', 'Cisco', 'PO-1', '2026-11-01', '', ''])
    expect(withPrices[3][7]).toBe('Not priced')
    const without = procurementSheet(lines, { showPrices: false })
    expect(without[0]).not.toContain('Unit price')
    expect(without[1]).toHaveLength(13)
  })

  it('a list edit applies to the list as it is when the queued save runs (regression: a quick second blur wiped the first)', () => {
    const rendered = [{ id: 'a', label: 'Users', vlanId: '', cidr: '' }]
    // The VLAN save ran first; the CIDR edit was made against the rendered list.
    const afterVlan = editList(rendered, { type: 'update', id: 'a', patch: { vlanId: 10 } })
    expect(editList(afterVlan, { type: 'update', id: 'a', patch: { cidr: '10.10.0.0/24' } })).toEqual([{ id: 'a', label: 'Users', vlanId: 10, cidr: '10.10.0.0/24' }])
    expect(editList(afterVlan, { type: 'add', item: { id: 'b' } }).map((x) => x.id)).toEqual(['a', 'b'])
    expect(editList(afterVlan, { type: 'remove', id: 'a' })).toEqual([])
  })

  it('package shapes for the prototype components', () => {
    expect(toRegisterGroups([{ key: 'addressing', n: 1, name: 'A', status: 'complete', ownerName: 'Ada', dueDate: '2026-11-30' }])[0]).toMatchObject({ id: 'addressing', owner: 'Ada' })
    expect(toAreaRows([{ key: 'pricing', result: 'accepted' }])[0].id).toBe('pricing')
    expect(toWarningRows([{ areaKey: 'pricing', text: 'x', acceptedBy: 'Owner (PM)' }])[0].id).toBe('pricing')
  })
})
