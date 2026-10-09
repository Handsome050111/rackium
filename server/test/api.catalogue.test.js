import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { SEEDED_CATALOGUE } from '@rackium/shared/catalogueSeed.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()
const cat = (orgId) => `/api/v1/orgs/${orgId}/catalogue`

async function newProject(admin, code = 'LAN') {
  const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: `Project ${code}`, code }).expect(201)
  return res.body.project.id
}

const orgSwitch = {
  kind: 'device_model',
  category: 'switch',
  vendor: 'Cisco',
  model: 'C9200-24P',
  heightU: 1,
  rackMounted: true,
  mounting: 'front',
  portMap: { groups: [{ role: 'access', type: 'RJ45', speed: '1G', poe: true, count: 24, start: 1, pattern: 'Gi1/0/{n}' }] },
  unitPriceMinor: 99900,
  currency: 'EUR',
}

const csvRow = (fields = {}) => ({
  kind: 'device_model',
  category: 'firewall',
  vendor: 'Fortinet',
  model: 'FG-60F',
  heightU: '1',
  rackMounted: 'yes',
  mounting: 'front',
  accessPortCount: '10',
  accessPortType: 'RJ45',
  accessPortPattern: 'port{n}',
  price: '540',
  ...fields,
})

describe('seed', () => {
  it('is idempotent and never overwrites an existing row', async () => {
    expect((await seedPlatformCatalogue()).inserted).toBe(0)
  })
})

describe('browsing', () => {
  it('any member of the organisation sees the seeded catalogue, marked as placeholder data, with exact ports on the detail', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const viewer = await projectMember(ctx, admin, { email: 'viewer@example.com', role: 'viewer', projectId })

    const list = (await viewer.get(`${cat(admin.orgId)}?projectId=${projectId}`).expect(200)).body
    expect(list.total).toBe(SEEDED_CATALOGUE.length)
    expect(list.items.every((i) => i.placeholder && i.layer === 'seeded')).toBe(true)
    expect(list.vendors).toEqual(['Cisco', 'Generic'])

    const edge = list.items.find((i) => i.key === 'Cisco C9300-48UX')
    const detail = (await viewer.get(`${cat(admin.orgId)}/${edge.id}?projectId=${projectId}`).expect(200)).body
    expect(detail.ports).toHaveLength(56)
    expect(detail.ports[0].id).toBe('Gi1/0/1')
    expect(detail.ports.at(-1).id).toBe('Te1/1/8')
  })

  it('filters by text, group, category, vendor, ports, PoE and speed', async () => {
    const admin = await signedInOrgAdmin(t())
    const q = async (query) => (await admin.agent.get(`${cat(admin.orgId)}?${query}`).expect(200)).body.items.map((i) => i.model).sort()
    expect(await q('q=9300')).toEqual(['C9300-48UX', 'C9300-NM-8X'])
    expect(await q('group=infrastructure')).toEqual(['Environment Sensor', 'PDU 0U', 'UPS 3U'])
    expect(await q('category=patch_panel&minPorts=48')).toEqual(['Cat6A Patch Panel 48-port'])
    expect(await q('poe=true')).toEqual(['C9300-48UX'])
    expect(await q('speed=40G')).toEqual(['SFP-40G-SR4'])
    expect(await q('vendor=Generic&group=passive')).toHaveLength(4)
    await admin.agent.get(`${cat(admin.orgId)}?group=toasters`).expect(400)
  })
})

describe('price visibility (brief v2.3 §4.3: Org Admin, PM, Reviewer)', () => {
  it('is decided server-side from the organisation and project role; hidden prices are not sent at all', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const priced = (body) => body.items.find((i) => i.key === 'Cisco C9500')

    const asAdmin = (await admin.agent.get(cat(admin.orgId)).expect(200)).body
    expect(asAdmin.pricesVisible).toBe(true)
    expect(priced(asAdmin)).toMatchObject({ unitPriceMinor: 850000, currency: 'EUR', priceHidden: false })

    for (const [role, sees] of [['pm', true], ['reviewer', true], ['architect', false], ['field_engineer', false], ['viewer', false]]) {
      const member = await projectMember(ctx, admin, { email: `${role}@example.com`, role, projectId })
      const body = (await member.get(`${cat(admin.orgId)}?projectId=${projectId}`).expect(200)).body
      expect(body.pricesVisible, role).toBe(sees)
      expect(priced(body).unitPriceMinor, role).toBe(sees ? 850000 : null)
      expect(priced(body).currency, role).toBe(sees ? 'EUR' : null)
      const detail = (await member.get(`${cat(admin.orgId)}/${priced(body).id}?projectId=${projectId}`).expect(200)).body
      expect(detail.item.unitPriceMinor, role).toBe(sees ? 850000 : null)
      // Without a project context only the organisation role counts.
      expect((await member.get(cat(admin.orgId)).expect(200)).body.pricesVisible, role).toBe(false)
    }
  })

  it('a project the caller cannot open is not found', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const mine = await newProject(admin, 'ONE')
    const other = await newProject(admin, 'TWO')
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId: mine })
    await architect.get(`${cat(admin.orgId)}?projectId=${other}`).expect(404)
    await architect.get(`${cat(admin.orgId)}?projectId=65f0c0ffee0000000000dead`).expect(404)
  })
})

describe('organisation items (Org Admin)', () => {
  it('Org Admin adds and edits; nobody else may', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const created = (await admin.agent.post(cat(admin.orgId)).send(orgSwitch).expect(201)).body.item
    expect(created).toMatchObject({ layer: 'organisation', key: 'Cisco C9200-24P', placeholder: false })

    const edited = (await admin.agent.patch(`${cat(admin.orgId)}/${created.id}`).send({ ...orgSwitch, unitPriceMinor: 88800, eosDate: '2031-01-31' }).expect(200)).body.item
    expect(edited).toMatchObject({ unitPriceMinor: 88800, eosDate: '2031-01-31' })

    for (const role of ['pm', 'architect', 'reviewer', 'field_engineer', 'viewer']) {
      const member = await projectMember(ctx, admin, { email: `${role}@example.com`, role, projectId })
      await member.post(cat(admin.orgId)).send({ ...orgSwitch, model: `M-${role}` }).expect(403)
      await member.patch(`${cat(admin.orgId)}/${created.id}`).send(orgSwitch).expect(403)
      await member.post(`${cat(admin.orgId)}/import`).send({ rows: [csvRow()] }).expect(403)
    }
  })

  it('the shared rules are enforced on the server (exact port numbering, mounting)', async () => {
    const admin = await signedInOrgAdmin(t())
    const overlapping = { ...orgSwitch, portMap: { groups: [...orgSwitch.portMap.groups, { role: 'uplink', type: 'SFP', count: 2, start: 24, pattern: 'Gi1/0/{n}' }] } }
    const res = await admin.agent.post(cat(admin.orgId)).send(overlapping).expect(400)
    expect(JSON.stringify(res.body.error.details)).toMatch(/unique: Gi1\/0\/24/)
    await admin.agent.post(cat(admin.orgId)).send({ ...orgSwitch, mounting: '0U' }).expect(400)
  })

  it('a duplicate vendor + model in the organisation layer is a conflict, case-insensitively', async () => {
    const admin = await signedInOrgAdmin(t())
    await admin.agent.post(cat(admin.orgId)).send(orgSwitch).expect(201)
    const res = await admin.agent.post(cat(admin.orgId)).send({ ...orgSwitch, model: 'c9200-24p' }).expect(409)
    expect(res.body.error.code).toBe('duplicate_item')
  })

  it('seeded items are read-only; an organisation item with the same key overrides the seeded one', async () => {
    const admin = await signedInOrgAdmin(t())
    const seeded = (await admin.agent.get(cat(admin.orgId))).body.items.find((i) => i.key === 'Cisco C9500')
    const denied = await admin.agent.patch(`${cat(admin.orgId)}/${seeded.id}`).send({ ...orgSwitch, model: 'C9500' }).expect(403)
    expect(denied.body.error.message).toMatch(/read-only/)

    const override = { ...orgSwitch, model: 'C9500', unitPriceMinor: 700000 }
    const created = (await admin.agent.post(cat(admin.orgId)).send(override).expect(201)).body.item
    const list = (await admin.agent.get(cat(admin.orgId))).body
    const effective = list.items.find((i) => i.key === 'Cisco C9500')
    expect(effective).toMatchObject({ id: created.id, layer: 'organisation', unitPriceMinor: 700000 })
    expect(effective.overrides).toEqual([{ id: seeded.id, layer: 'seeded' }])
    expect(list.total).toBe(SEEDED_CATALOGUE.length)

    const detail = (await admin.agent.get(`${cat(admin.orgId)}/${seeded.id}`)).body
    expect(detail.effectiveId).toBe(created.id)
    expect(detail.layers.map((l) => l.layer).sort()).toEqual(['organisation', 'seeded'])
  })
})

describe('CSV import', () => {
  it('re-validates every row on the server and writes nothing unless all pass', async () => {
    const admin = await signedInOrgAdmin(t())
    const res = await admin.agent
      .post(`${cat(admin.orgId)}/import`)
      .send({ rows: [csvRow(), csvRow({ model: 'FG-100F', heightU: 'one' }), csvRow({ model: 'FG-200F', category: 'toaster' })] })
      .expect(400)
    expect(res.body.error.details.rowErrors).toEqual([
      { index: 1, errors: [{ field: 'heightU', message: 'Use a whole number' }] },
      { index: 2, errors: [expect.objectContaining({ field: 'category' })] },
    ])
    expect((await admin.agent.get(`${cat(admin.orgId)}?q=FG-60F`)).body.items).toHaveLength(0)
  })

  it('creates new items and updates matching organisation items in one go', async () => {
    const admin = await signedInOrgAdmin(t())
    const first = (await admin.agent.post(`${cat(admin.orgId)}/import`).send({ rows: [csvRow(), csvRow({ model: 'FG-100F' })] }).expect(201)).body
    expect(first.imported).toEqual({ created: 2, updated: 0 })
    const second = (await admin.agent.post(`${cat(admin.orgId)}/import`).send({ rows: [csvRow({ model: 'fg-60f', price: '600' }), csvRow({ model: 'FG-200F' })] }).expect(201)).body
    expect(second.imported).toEqual({ created: 1, updated: 1 })
    const item = (await admin.agent.get(`${cat(admin.orgId)}?q=FG-60F`)).body.items[0]
    expect(item).toMatchObject({ unitPriceMinor: 60000, group: 'active_networking' })
  })

  it('rejects the same key twice in one file', async () => {
    const admin = await signedInOrgAdmin(t())
    await admin.agent.post(`${cat(admin.orgId)}/import`).send({ rows: [csvRow(), csvRow({ model: 'fg-60F' })] }).expect(400)
  })
})

describe('isolation', () => {
  it("one organisation never sees or edits another's items", async () => {
    const ctx = t()
    const a = await signedInOrgAdmin(ctx)
    const b = await signedInOrgAdmin(ctx, { email: 'b@example.com', organisationName: 'Org B' })
    const item = (await a.agent.post(cat(a.orgId)).send(orgSwitch).expect(201)).body.item

    expect((await b.agent.get(cat(b.orgId))).body.items.map((i) => i.key)).not.toContain('Cisco C9200-24P')
    await b.agent.get(`${cat(b.orgId)}/${item.id}`).expect(404)
    await b.agent.patch(`${cat(b.orgId)}/${item.id}`).send(orgSwitch).expect(404)
    await b.agent.get(cat(a.orgId)).expect(404)
    // Org B can add the same vendor + model in its own layer.
    await b.agent.post(cat(b.orgId)).send(orgSwitch).expect(201)
  })
})
