import { approvedLld } from './lld.js'
import { readyPackage, submitPackage, clientDecides, bomView } from './m5a.js'

function expectStatus(res, status) {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`)
  return res
}

export const depView = async (agent, p, buildingId = p.b001) => (await agent.get(`${p.dep}/buildings/${buildingId}`).expect(200)).body
export const cmdbView = async (agent, p, buildingId = p.b001) => (await agent.get(`${p.cmdb}/buildings/${buildingId}`).expect(200)).body

// The client approves the package (HLD and LLD frozen) and the PM approves
// the procurement BOM: what deployment starts from.
export async function freeze(ctx, d) {
  const { p } = d
  await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb'] }).expect(200)
  await readyPackage(p)
  const link = await submitPackage(p)
  expectStatus(await clientDecides(ctx, link), 200)
  expectStatus(await p.admin.agent.post(`${p.base}/bom/approve`).send({ buildingId: p.b001 }), 201)
}

// B001's approved LLD, frozen, procurement unlocked (M6a).
export async function deployable(ctx, { frozen = true } = {}) {
  const d = await approvedLld(ctx)
  const { p } = d
  p.dep = `${p.base}/deployment`
  p.cmdb = `${p.base}/cmdb`
  if (frozen) await freeze(ctx, d)
  return d
}

// Walks a procurement line to Delivered (PM).
export async function deliver(p, lineKey) {
  const line = (await bomView(p.admin.agent, p)).lines.find((l) => l.key === lineKey)
  let version = line?.procurement.version ?? 0
  const steps = [{ status: 'ordered', poNumber: 'PO-1' }, { status: 'shipped' }, { status: 'delivered', actualDelivery: '2026-10-01' }]
  const current = line?.procurement.status ?? 'not_ordered'
  for (const body of steps.slice(['not_ordered', 'ordered', 'shipped', 'delivered'].indexOf(current))) {
    expectStatus(await p.admin.agent.patch(`${p.base}/bom/lines`).send({ buildingId: p.b001, lineKey, ...body, version }), 200)
    version += 1
  }
}

// Every device's line delivered.
export async function deliverAll(p) {
  const v = await depView(p.admin.agent, p)
  for (const key of new Set(v.devices.map((x) => x.delivery.lineKey))) await deliver(p, key)
  return depView(p.admin.agent, p)
}

let serialSeq = 0
// Installs a device where the design puts it (Field Engineer), with a serial when it has one.
export async function install(p, device, overrides = {}) {
  serialSeq += 1
  const body = { ...(device.serialised ? { serial: `SN-${device.role ?? 'x'}-${serialSeq}` } : {}), ...(device.rackId ? { rackId: device.rackId, ru: device.ru, face: device.face } : {}), markInstalled: true, ...overrides }
  return expectStatus(await p.fe.put(`${p.dep}/devices/${device.id}/installation`).send(body), 200).body
}

// Patches a connection as designed: every cable with its designed ID and length.
export async function patch(p, conn, { lengths = {}, cableIds = {} } = {}) {
  const segments = conn.segments.map((s) => ({ index: s.index, cableId: cableIds[s.index] ?? s.cableId ?? `CAB-${conn.id.slice(-4)}-${s.index}`, installedM: lengths[s.index] ?? s.effectiveM ?? 3, confirmed: true }))
  // The link's current version (it may have been saved since `conn` was read).
  const version = (await depView(p.fe, p)).connections.find((c) => c.id === conn.id)?.version ?? 0
  return expectStatus(await p.fe.put(`${p.dep}/connections/${conn.id}/installation`).send({ segments, confirm: true, version }), 200).body
}

export const step = (agent, p, device, status) => agent.post(`${p.dep}/devices/${device.id}/status`).send({ status })

// Everything deployed and accepted (M6b handover): every device installed,
// every link patched as designed and tested, DGUV recorded, all accepted.
export async function acceptEverything(p) {
  await deliverWholeBom(p)
  let v = await depView(p.admin.agent, p)
  for (const d of v.devices) await install(p, d)
  v = await depView(p.fe, p)
  for (const c of v.connections) {
    await patch(p, c)
    expectStatus(await p.fe.post(`${p.dep}/connections/${c.id}/test`).send({ result: 'pass' }), 200)
  }
  v = await depView(p.fe, p)
  for (const d of v.devices) {
    for (const s of ['configured', 'tested']) expectStatus(await step(p.fe, p, d, s), 200)
    if (d.mainsPowered) expectStatus(await p.fe.put(`${p.dep}/devices/${d.id}/dguv`).send({ inspectionDate: '2026-10-01', inspector: 'Elektro Meyer' }), 200)
    expectStatus(await step(p.reviewer, p, d, 'accepted'), 200)
  }
  for (const c of v.connections) expectStatus(await p.reviewer.post(`${p.dep}/connections/${c.id}/accept`), 200)
  return depView(p.fe, p)
}

// Every BOM line delivered (devices, cables, optics, cords) — the handover checklist.
export async function deliverWholeBom(p) {
  const { bomView } = await import('./m5a.js')
  for (const line of (await bomView(p.admin.agent, p)).lines) await deliver(p, line.key)
}
