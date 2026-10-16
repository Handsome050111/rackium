import { expect } from '@playwright/test'
import { fixture, signUpAndSignIn, createProjectWithHierarchy } from './helpers.js'
import { inviteAndAccept, fillTabViaApi, transitionViaApi } from './surveyHelpers.js'
import { BUILDING_TABS, ROOM_TABS } from '@rackium/shared/surveyForm.js'
import { REQUIRED_INPUT_GROUPS } from '@rackium/shared/solutionPackage.js'

// B001 taken to the end of deployment through the API (the same calls the
// screens make): survey verified, HLD and LLD approved, the Solution Package
// approved by the client (design frozen), the whole BOM delivered, every
// device installed, every link patched and tested, all accepted.
export async function deployedProject({ owner, browser, runId, prefix }) {
  const orgId = await signUpAndSignIn(owner, { email: `${prefix}-${runId}@example.com`, organisationName: `${prefix.toUpperCase()} Org` })
  const projectId = await createProjectWithHierarchy(owner, orgId, { name: `${prefix.toUpperCase()} Project`, hierarchyCsv: fixture('hierarchy-two-buildings.csv') })
  const api = `/api/v1/orgs/${orgId}/projects/${projectId}`
  const b001 = (await (await owner.request.get(`${api}/cmo`)).json()).buildings.find((b) => b.code === 'B001').id
  const fe = await inviteAndAccept(owner, browser, { orgId, projectId, email: `${prefix}-fe-${runId}@example.com`, role: 'field_engineer', name: 'Fiona Field' })
  const architect = await inviteAndAccept(owner, browser, { orgId, projectId, email: `${prefix}-arch-${runId}@example.com`, role: 'architect', name: 'Ada Architect' })
  const reviewer = await inviteAndAccept(owner, browser, { orgId, projectId, email: `${prefix}-rev-${runId}@example.com`, role: 'reviewer', name: 'Rita Reviewer' })
  const send = async (page, method, p, data, status) => {
    const res = await page.request[method](`${api}${p}`, data === undefined ? undefined : { data })
    expect(res.status(), `${method} ${p}: ${await res.text()}`).toBe(status)
    return res.json()
  }
  const lld = () => send(architect, 'get', `/lld/buildings/${b001}`, undefined, 200)
  const byRole = (v, role) => v.devices.find((d) => (d.inDesign ?? true) && d.role === role)
  const linkOf = (v, a, b) => {
    const ids = [byRole(v, a).id, byRole(v, b).id].sort().join()
    return v.connections.find((c) => [c.source.deviceId, c.dest.deviceId].sort().join() === ids)
  }
  const { floor } = await send(fe, 'post', '/survey/floors', { buildingId: b001, token: 'EG', name: 'Ground floor', order: 0 }, 201)
  const { room: main } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const { room: second } = await send(fe, 'post', '/survey/rooms', { floorId: floor.id }, 201)
  const racks = [(await send(fe, 'post', '/survey/racks', { roomId: main.id }, 201)).rack, (await send(fe, 'post', '/survey/racks', { roomId: second.id }, 201)).rack]
  for (const rack of racks) await send(fe, 'patch', `/survey/racks/${rack.id}/placements`, { placements: [{ ru: 0, heightU: 0, face: 'rear', mounting: '0U', railSide: 'left', label: 'PDU-A', category: 'Power' }] }, 200)
  await send(architect, 'post', '/survey/pathways', { fromRoomId: main.id, toRoomId: second.id, routeStatus: 'surveyed', distanceM: 42 }, 201)
  for (const t of [...BUILDING_TABS.map((tab) => ({ tab, roomId: null })), ...[main.id, second.id].flatMap((roomId) => ROOM_TABS.map((tab) => ({ tab, roomId })))]) {
    const target = { orgId, projectId, buildingId: b001, ...t }
    await fillTabViaApi(fe, target)
    await transitionViaApi(fe, target, 'submit')
    await transitionViaApi(architect, target, 'verify')
  }
  const hld = await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)
  await send(architect, 'post', '/hld/generate', { buildingId: b001, preset: 'M', baseRevision: hld.design.revision }, 201)
  await send(architect, 'post', '/hld/submit', { buildingId: b001, baseRevision: (await send(architect, 'get', `/hld/buildings/${b001}`, undefined, 200)).design.revision }, 201)
  await send(owner, 'post', '/hld/decision', { buildingId: b001, decision: 'approved' }, 200)
  await send(architect, 'post', '/lld/start', { buildingId: b001 }, 201)
  let v = await lld()
  const save = async (method, p, body, status = 200) => {
    v = await lld()
    return send(architect, method, p, { ...body, baseRevision: v.design.revision }, status)
  }
  await save('put', `/lld/devices/${byRole(v, 'border').id}/placement`, { rackId: racks[0].id, ru: 40, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'fusion').id}/placement`, { rackId: racks[0].id, ru: 38, face: 'front' })
  await save('put', `/lld/devices/${byRole(v, 'edge').id}/placement`, { rackId: racks[1].id, ru: 40, face: 'front' })
  const pp = (await save('post', '/lld/devices', { buildingId: b001, catalogueKey: 'Generic Cat6A Patch Panel 24-port', rackId: racks[1].id, ru: 42, face: 'front' }, 201)).device
  for (const [a, b, ports, cableId, hops] of [
    ['border', 'fusion', ['Te1/1/1', 'Te1/1/1'], 'C-BF-1'],
    ['border', 'edge', ['Te1/1/2', 'Te1/1/1'], 'C-BE-1'],
    ['edge', 'ap', ['Gi1/0/1', 'Eth0'], 'C-EA-1', [{ patchPanelId: pp.id, inPort: '01', outPort: '02', segmentCableId: 'C-EA-1b' }]],
  ]) {
    v = await lld()
    const c = linkOf(v, a, b)
    const first = c.source.deviceId === byRole(v, a).id
    await save('patch', `/lld/connections/${c.id}`, { source: { deviceId: c.source.deviceId, portId: first ? ports[0] : ports[1] }, dest: { deviceId: c.dest.deviceId, portId: first ? ports[1] : ports[0] }, cableId, ...(hops ? { hops } : {}) })
  }
  await save('post', '/lld/submit', { buildingId: b001 }, 201)
  await send(owner, 'post', '/lld/decision', { buildingId: b001, decision: 'approved' }, 200)
  for (const g of REQUIRED_INPUT_GROUPS) {
    const sp = await send(architect, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
    const body = g.key === 'addressing' ? { addressingEntries: [{ id: 'a1', label: 'Users', vlanId: 10, cidr: '10.10.0.0/24', gateway: '10.10.0.1' }] } : { kvPairs: [{ id: 'k1', key: 'Owner', value: 'Client IT' }] }
    await send(architect, 'put', `/solution-package/groups/${g.key}`, { buildingId: b001, ...body, baseRevision: sp.revision }, 200)
  }
  let sp = await send(owner, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
  for (const area of sp.validationAreas.filter((a) => a.result === 'warning')) {
    await send(owner, 'post', '/solution-package/accept-warning', { buildingId: b001, areaKey: area.key, baseRevision: sp.revision }, 200)
    sp = await send(owner, 'get', `/solution-package/buildings/${b001}`, undefined, 200)
  }
  const { shareLink } = await send(owner, 'post', '/solution-package/submit', { buildingId: b001 }, 201)
  const decided = await owner.request.post(`/api/v1/public/share-links/${shareLink.token}/decision`, { data: { password: shareLink.password, decision: 'approved', name: 'Clara Client', role: 'IT Director', comments: '', termsAccepted: true } })
  expect(decided.status(), await decided.text()).toBe(200)
  await send(owner, 'post', '/bom/approve', { buildingId: b001 }, 201)
  // The whole BOM delivered.
  const bom = await send(owner, 'get', `/bom/buildings/${b001}`, undefined, 200)
  for (const line of bom.lines) {
    let version = line.procurement.version
    for (const body of [{ status: 'ordered', poNumber: 'PO-1' }, { status: 'shipped' }, { status: 'delivered', actualDelivery: '2026-10-01' }]) {
      await send(owner, 'patch', '/bom/lines', { buildingId: b001, lineKey: line.key, ...body, version }, 200)
      version += 1
    }
  }
  // Everything installed, patched, tested and accepted.
  let dep = await send(fe, 'get', `/deployment/buildings/${b001}`, undefined, 200)
  for (const d of dep.devices) await send(fe, 'put', `/deployment/devices/${d.id}/installation`, { ...(d.serialised ? { serial: `SN-${d.role}-${runId}` } : {}), ...(d.rackId ? { rackId: d.rackId, ru: d.ru, face: d.face } : {}), markInstalled: true }, 200)
  for (const c of dep.connections) {
    await send(fe, 'put', `/deployment/connections/${c.id}/installation`, { segments: c.segments.map((s) => ({ index: s.index, cableId: s.cableId, installedM: s.effectiveM ?? 3, confirmed: true })), confirm: true }, 200)
    await send(fe, 'post', `/deployment/connections/${c.id}/test`, { result: 'pass' }, 200)
  }
  dep = await send(fe, 'get', `/deployment/buildings/${b001}`, undefined, 200)
  for (const d of dep.devices) {
    for (const s of ['configured', 'tested']) await send(fe, 'post', `/deployment/devices/${d.id}/status`, { status: s }, 200)
    if (d.mainsPowered) await send(fe, 'put', `/deployment/devices/${d.id}/dguv`, { inspectionDate: '2026-10-01', inspector: 'Elektro Meyer' }, 200)
    await send(reviewer, 'post', `/deployment/devices/${d.id}/status`, { status: 'accepted' }, 200)
  }
  for (const c of dep.connections) await send(reviewer, 'post', `/deployment/connections/${c.id}/accept`, {}, 200)
  return { orgId, projectId, api, b001, fe, architect, reviewer, send, deployment: await send(fe, 'get', `/deployment/buildings/${b001}`, undefined, 200) }
}
