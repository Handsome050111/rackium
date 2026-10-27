import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'
import { REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'
import { fillTab, transition } from '../test/helpers/survey.js'

// Synthetic demo data for `npm run dev:local` (docs/BACKEND-SETUP.md): one
// organisation, a user for every role, one project whose buildings stand at
// each stage from survey to handover. Everything is made up — example.com
// addresses, invented names — and nothing comes from client files (the
// addendum's handling note). Built through the API, the same calls the
// screens make, so the data is what the app itself would produce.

export const DEMO_PASSWORD = 'rackium-demo-2026'
export const DEMO_ORGANISATION = 'Northwind Networks (demo)'
export const DEMO_PROJECT = { name: 'Campus Network Refresh', code: 'CNR', clientName: 'Example Retail GmbH (demo)' }
const PHASES = ['cmo', 'survey', 'hld', 'lld', 'solution-package', 'bom', 'deployment', 'cmdb', 'handover']

export const DEMO_USERS = [
  { key: 'admin', role: 'org_admin', name: 'Olivia Admin', email: 'org-admin@example.com', note: 'created the project, so also its PM' },
  { key: 'pm', role: 'pm', name: 'Paul Manager', email: 'pm@example.com' },
  { key: 'architect', role: 'architect', name: 'Ada Architect', email: 'architect@example.com' },
  { key: 'reviewer', role: 'reviewer', name: 'Rita Reviewer', email: 'reviewer@example.com' },
  { key: 'externalReviewer', role: 'external_reviewer', name: 'Clara Client', email: 'client-reviewer@example.com' },
  { key: 'fe', role: 'field_engineer', name: 'Fiona Field', email: 'field-engineer@example.com' },
  { key: 'viewer', role: 'viewer', name: 'Victor Viewer', email: 'viewer@example.com' },
]

export const STAGES = ['survey', 'hld', 'lld', 'bom', 'deployment', 'handover']
export const DEMO_BUILDINGS = [
  { code: 'B001', name: 'Office North', salCode: 'ERL', campusCode: 'C01', stage: 'survey', stageLabel: 'Survey in progress: building tabs submitted, rooms open' },
  { code: 'B002', name: 'Office South', salCode: 'ERL', campusCode: 'C01', stage: 'hld', stageLabel: 'HLD submitted, waiting for review' },
  { code: 'B003', name: 'Logistics Hall', salCode: 'ERL', campusCode: 'C01', stage: 'lld', stageLabel: 'LLD submitted, waiting for review' },
  { code: 'B004', name: 'Training Centre', salCode: 'MUC', campusCode: 'C02', stage: 'bom', stageLabel: 'Package approved by the client, BOM approved, half ordered' },
  { code: 'B005', name: 'Lab Building', salCode: 'MUC', campusCode: 'C02', stage: 'deployment', stageLabel: 'Deployment under way: some devices installed, one link patched' },
  { code: 'B006', name: 'Head Office', salCode: 'MUC', campusCode: 'C02', stage: 'handover', stageLabel: 'Handed over and accepted by the client (baseline v1.0)' },
]

const PANEL = 'Generic Cat6A Patch Panel 24-port'
const HANDOVER_PASSWORD = 'Handover-Demo-26'
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

async function call(agent, method, url, body, status) {
  const req = agent[method](url)
  const res = await (body === undefined ? req : req.send(body))
  if (res.status !== status) throw new Error(`${method.toUpperCase()} ${url}: expected ${status}, got ${res.status} ${JSON.stringify(res.body).slice(0, 400)}`)
  return res.body
}

// agent(): a new cookie-keeping supertest agent on the app; mailer: the app's
// memory sender (verification and invitation links); processDocuments(): runs
// the document queue once (the handover package).
export async function seedDemo({ agent, mailer, processDocuments, log = () => {} }) {
  const tokenFor = (email) => {
    const message = mailer.lastTo(email)
    if (!message) throw new Error(`no email to ${email}`)
    return new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')
  }
  const signIn = async (email) => {
    const a = agent()
    return { a, body: await call(a, 'post', '/api/v1/auth/login', { email, password: DEMO_PASSWORD }, 200) }
  }

  // The organisation, its Org Admin, the project and its team.
  const [owner, ...members] = DEMO_USERS
  await call(agent(), 'post', '/api/v1/auth/signup', { organisationName: DEMO_ORGANISATION, name: owner.name, email: owner.email, password: DEMO_PASSWORD }, 202)
  await call(agent(), 'post', '/api/v1/auth/verify-email', { token: tokenFor(owner.email) }, 200)
  const signedIn = await signIn(owner.email)
  const orgId = signedIn.body.memberships.find((m) => m.level === 'organisation').organisationId
  const admin = signedIn.a
  const { project } = await call(admin, 'post', `/api/v1/orgs/${orgId}/projects`, DEMO_PROJECT, 201)
  const base = `/api/v1/orgs/${orgId}/projects/${project.id}`
  await call(admin, 'patch', base, { activePhaseKeys: PHASES }, 200)
  const rows = DEMO_BUILDINGS.map((b) => ({ countryCode: 'DE', countryName: 'Germany', salCode: b.salCode, campusCode: b.campusCode, buildingCode: b.code, buildingName: b.name, wingCode: '', wingName: '' }))
  await call(admin, 'post', `${base}/hierarchy/import`, { rows }, 201)
  const people = { admin }
  for (const u of members) {
    await call(admin, 'post', `/api/v1/orgs/${orgId}/invitations`, { email: u.email, role: u.role, projectId: project.id, scopes: [] }, 201)
    await call(agent(), 'post', '/api/v1/auth/invitations/accept', { organisationId: orgId, token: tokenFor(u.email), name: u.name, password: DEMO_PASSWORD }, 201)
    people[u.key] = (await signIn(u.email)).a
  }
  log(`organisation, project and ${DEMO_USERS.length} users`)
  const { pm, architect, reviewer, fe } = people
  const send = (who, method, p, body, status) => call(who, method, `${base}${p}`, body, status)
  const ids = new Map((await send(admin, 'get', '/cmo', undefined, 200)).buildings.map((b) => [b.code, b.id]))

  const buildings = []
  for (const b of DEMO_BUILDINGS) {
    const id = ids.get(b.code)
    await advance({ ...b, id })
    buildings.push({ ...b, id })
    log(`${b.code} ${b.name}: ${b.stageLabel}`)
  }
  return { orgId, projectId: project.id, base, buildings }

  // Takes one building from an empty survey to its demo stage.
  async function advance({ id, code, stage }) {
    const reached = (s) => STAGES.indexOf(stage) > STAGES.indexOf(s)

    // Survey: a floor, two rooms with a rack each, a pathway between them.
    const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: id, token: 'EG', name: 'Ground floor', order: 0 }, 201)
    const rooms = [(await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)).room, (await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)).room]
    const racks = []
    for (const room of rooms) racks.push((await send(fe, 'post', '/survey/racks', { roomId: room.id }, 201)).rack)
    for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
    await send(architect, 'post', '/survey/pathways', { fromRoomId: rooms[0].id, toRoomId: rooms[1].id, routeStatus: 'surveyed', distanceM: 42 }, 201)
    const step = async (who, target, action) => {
      const res = await transition(who, base, target, action)
      if (res.status !== 200) throw new Error(`${code} ${target.tab} ${action}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`)
    }
    const buildingTabs = BUILDING_TABS.map((tab) => ({ buildingId: id, roomId: null, tab }))
    const roomTabs = rooms.flatMap((room) => ROOM_TABS.map((tab) => ({ buildingId: id, roomId: room.id, tab })))
    if (stage === 'survey') {
      for (const target of buildingTabs) {
        await fillTab(fe, base, target)
        await step(fe, target, 'submit')
      }
      await step(architect, buildingTabs[0], 'verify')
      await fillTab(fe, base, roomTabs[0])
      return
    }
    for (const target of [...buildingTabs, ...roomTabs]) {
      await fillTab(fe, base, target)
      await step(fe, target, 'submit')
      await step(architect, target, 'verify')
    }

    // HLD: generated from the survey (preset M), submitted, approved.
    const hld = await send(architect, 'get', `/hld/buildings/${id}`, undefined, 200)
    await send(architect, 'post', '/hld/generate', { buildingId: id, preset: 'M', baseRevision: hld.design.revision }, 201)
    await send(architect, 'post', '/hld/submit', { buildingId: id, baseRevision: (await send(architect, 'get', `/hld/buildings/${id}`, undefined, 200)).design.revision }, 201)
    if (!reached('hld')) return
    await send(reviewer, 'post', '/hld/decision', { buildingId: id, decision: 'approved' }, 200)

    // LLD: devices placed, a patch panel, every link with its ports and cable IDs.
    await send(architect, 'post', '/lld/start', { buildingId: id }, 201)
    let v
    const save = async (method, p, body, status = 200) => {
      v = await send(architect, 'get', `/lld/buildings/${id}`, undefined, 200)
      return send(architect, method, p, { ...body, baseRevision: v.design.revision }, status)
    }
    v = await send(architect, 'get', `/lld/buildings/${id}`, undefined, 200)
    const byRole = (role) => v.devices.find((d) => (d.inDesign ?? true) && d.role === role)
    const linkOf = (a, z) => {
      const pair = [byRole(a).id, byRole(z).id].sort().join()
      return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === pair)
    }
    await save('put', `/lld/devices/${byRole('border').id}/placement`, { rackId: racks[0].id, ru: 40, face: 'front' })
    await save('put', `/lld/devices/${byRole('fusion').id}/placement`, { rackId: racks[0].id, ru: 38, face: 'front' })
    await save('put', `/lld/devices/${byRole('edge').id}/placement`, { rackId: racks[1].id, ru: 40, face: 'front' })
    const panel = (await save('post', '/lld/devices', { buildingId: id, catalogueKey: PANEL, rackId: racks[1].id, ru: 42, face: 'front' }, 201)).device
    for (const [a, z, ports, cableId, hops] of [
      ['border', 'fusion', ['Te1/1/1', 'Te1/1/1'], `${code}-C-BF-1`],
      ['border', 'edge', ['Te1/1/2', 'Te1/1/1'], `${code}-C-BE-1`],
      ['edge', 'ap', ['Gi1/0/1', 'Eth0'], `${code}-C-EA-1`, [{ patchPanelId: panel.id, inPort: '01', outPort: '02', segmentCableId: `${code}-C-EA-1b` }]],
    ]) {
      v = await send(architect, 'get', `/lld/buildings/${id}`, undefined, 200)
      const c = linkOf(a, z)
      const first = c.source.deviceId === byRole(a).id
      await save('patch', `/lld/connections/${c.id}`, { source: { deviceId: c.source.deviceId, portId: first ? ports[0] : ports[1] }, dest: { deviceId: c.dest.deviceId, portId: first ? ports[1] : ports[0] }, cableId, ...(hops ? { hops } : {}) })
    }
    await save('post', '/lld/submit', { buildingId: id }, 201)
    if (!reached('lld')) return
    await send(reviewer, 'post', '/lld/decision', { buildingId: id, decision: 'approved' }, 200)

    // Solution Package to the client (approved through its link), BOM approved.
    for (const g of REQUIRED_INPUT_GROUPS) {
      const sp = await send(architect, 'get', `/solution-package/buildings/${id}`, undefined, 200)
      const body = g.key === 'addressing' ? { addressingEntries: [{ id: 'a1', label: 'Users', vlanId: 10, cidr: '10.10.0.0/24', gateway: '10.10.0.1' }] } : { kvPairs: [{ id: 'k1', key: `${g.name} owner`, value: 'Client IT' }] }
      await send(architect, 'put', `/solution-package/groups/${g.key}`, { buildingId: id, ...body, baseRevision: sp.revision }, 200)
    }
    let sp = await send(pm, 'get', `/solution-package/buildings/${id}`, undefined, 200)
    for (const area of sp.validationAreas.filter((x) => x.result === 'warning')) {
      await send(pm, 'post', '/solution-package/accept-warning', { buildingId: id, areaKey: area.key, baseRevision: sp.revision }, 200)
      sp = await send(pm, 'get', `/solution-package/buildings/${id}`, undefined, 200)
    }
    const { shareLink } = await send(pm, 'post', '/solution-package/submit', { buildingId: id }, 201)
    await call(agent(), 'post', `/api/v1/public/share-links/${shareLink.token}/decision`, { password: shareLink.password, decision: 'approved', name: 'Clara Client', role: 'IT Director', comments: '', termsAccepted: true }, 200)
    await send(pm, 'post', '/bom/approve', { buildingId: id }, 201)

    // Procurement: half the lines ordered (BOM stage), or everything delivered.
    const { lines } = await send(pm, 'get', `/bom/buildings/${id}`, undefined, 200)
    const order = { status: 'ordered', poNumber: `PO-${code}-001`, expectedDelivery: day(14) }
    const steps = reached('bom') ? [order, { status: 'shipped' }, { status: 'delivered', actualDelivery: day(-7) }] : [order]
    for (const line of reached('bom') ? lines : lines.slice(0, Math.ceil(lines.length / 2))) {
      let version = line.procurement.version
      for (const body of steps) {
        await send(pm, 'patch', '/bom/lines', { buildingId: id, lineKey: line.key, ...body, version }, 200)
        version += 1
      }
    }
    if (!reached('bom')) return

    // Deployment: installed where the design puts them, patched, tested.
    let dep = await send(fe, 'get', `/deployment/buildings/${id}`, undefined, 200)
    const devices = reached('deployment') ? dep.devices : dep.devices.slice(0, Math.ceil(dep.devices.length / 2))
    const connections = reached('deployment') ? dep.connections : dep.connections.slice(0, 1)
    for (const [i, d] of devices.entries()) {
      await send(fe, 'put', `/deployment/devices/${d.id}/installation`, { ...(d.serialised ? { serial: `SN-${code}-${d.role ?? 'dev'}-${i + 1}` } : {}), ...(d.rackId ? { rackId: d.rackId, ru: d.ru, face: d.face } : {}), markInstalled: true }, 200)
    }
    for (const c of connections) {
      const current = (await send(fe, 'get', `/deployment/buildings/${id}`, undefined, 200)).connections.find((x) => x.id === c.id)
      await send(fe, 'put', `/deployment/connections/${c.id}/installation`, { segments: current.segments.map((s) => ({ index: s.index, cableId: s.cableId, installedM: s.effectiveM ?? 3, confirmed: true })), confirm: true, version: current.version ?? 0 }, 200)
      await send(fe, 'post', `/deployment/connections/${c.id}/test`, { result: 'pass' }, 200)
    }
    if (!reached('deployment')) return

    // Accepted, then the handover: compiled, reviewed, delivered, accepted by the client.
    dep = await send(fe, 'get', `/deployment/buildings/${id}`, undefined, 200)
    for (const d of dep.devices) {
      for (const s of ['configured', 'tested']) await send(fe, 'post', `/deployment/devices/${d.id}/status`, { status: s }, 200)
      if (d.mainsPowered) await send(fe, 'put', `/deployment/devices/${d.id}/dguv`, { inspectionDate: day(-20), inspector: 'Elektro Muster GmbH' }, 200)
      await send(reviewer, 'post', `/deployment/devices/${d.id}/status`, { status: 'accepted' }, 200)
    }
    for (const c of dep.connections) await send(reviewer, 'post', `/deployment/connections/${c.id}/accept`, {}, 200)
    const H = `/handover/buildings/${id}`
    await send(pm, 'post', `${H}/compile`, undefined, 202)
    let view
    for (let round = 0; round < 20; round++) {
      await processDocuments()
      view = await send(pm, 'get', H, undefined, 200)
      if (view.state !== 'compiling') break
    }
    if (view.state !== 'compiled') throw new Error(`${code} handover: compiling ended as ${view.state}`)
    await send(reviewer, 'post', `${H}/review`, undefined, 200)
    const delivered = await send(pm, 'post', `${H}/deliver`, { password: HANDOVER_PASSWORD, expiryDays: 30 }, 201)
    await call(agent(), 'post', `/api/v1/public/share-links/${delivered.shareLink.token}/decision`, { password: HANDOVER_PASSWORD, decision: 'approved', name: 'Clara Client', role: 'IT Director', comments: 'Accepted as built', termsAccepted: true }, 200)
  }
}
