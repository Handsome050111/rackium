import { describe, it, expect, vi, afterEach } from 'vitest'
import { procurementSheet } from './deliveryApi.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

// M7b-1 (addendum v2.3): the External Reviewer's BOM export, the DGUV override call.
describe('M7b-1 client pieces', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('the procurement export without procurement details (External Reviewer): no supplier, PO number or notes column', () => {
    const lines = [{ category: 'Network devices', item: 'C9300', spec: '24 port', source: 'LLD', basis: 'x', qty: 2, unit: 'Each', procurement: { status: 'ordered', expectedDelivery: '2026-11-01', actualDelivery: null } }]
    const [head, row] = procurementSheet(lines, { showPrices: false, procurementDetails: false })
    expect(head).toEqual(['Category', 'Item', 'Specification', 'Source', 'Reason', 'Qty', 'Unit', 'Status', 'Expected delivery', 'Actual delivery'])
    expect(row).toEqual(['Network devices', 'C9300', '24 port', 'LLD', 'x', 2, 'Each', 'Ordered', '2026-11-01', ''])
    // Internal roles keep them.
    expect(procurementSheet(lines, { showPrices: false })[0]).toEqual(expect.arrayContaining(['Vendor', 'PO number', 'Notes']))
  })

  it('DGUV override: PUT with the required flag and the reason', async () => {
    vi.stubEnv('VITE_API_MODE', 'real')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({})))
    vi.resetModules()
    const { deploymentApi } = await import('./deploymentApi.js')
    await deploymentApi.overrideDguv('o', 'p', 'd1', { required: false, reason: 'UPS-fed' })
    expect(fetch.mock.calls[0]).toEqual(['/api/v1/orgs/o/projects/p/deployment/devices/d1/dguv-override', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ required: false, reason: 'UPS-fed' }) })])
  })
})
