import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp } from './helpers/app.js'
import { deployable, deliverAll, install, depView, cmdbView, acceptEverything } from './helpers/m6a.js'
import { clientDecides } from './helpers/m5a.js'
import { lldProject, withDesign } from './helpers/lld.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'
import { closePdfBrowser, pdfPages } from '../src/documents/render/pdf.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { Device } from '../src/models/device.js'
import { ChangeRequest } from '../src/models/changeRequest.js'
import { createReprintTask } from '../src/deployment/reprint.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await closePdfBrowser()
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
  await seedPlatformCatalogue()
})

const t = () => createTestApp()
const col = (name) => mongoose.connection.db.collection(name)
const oid = (id) => new mongoose.Types.ObjectId(String(id))
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const me = async (agent) => (await agent.get('/api/v1/me').expect(200)).body.user.id
const binary = (req) =>
  req.buffer(true).parse((res, cb) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => cb(null, Buffer.concat(chunks)))
  })
// PDF text without line breaks (a label's end line wraps to two lines).
const flat = (pages) => pages.join(' ').replace(/\s+/g, '')
async function generate(ctx, p, agent, body) {
  const res = await agent.post(`${p.base}/documents`).send({ buildingId: p.b001, ...body })
  expect([200, 202], JSON.stringify(res.body)).toContain(res.status)
  await ctx.app.__documents.process()
  const doc = (await agent.get(`${p.base}/documents/${res.body.document.id}`).expect(200)).body.document
  if (doc.status !== 'ready') throw new Error(`${doc.fileName} is ${doc.status}: ${doc.error ?? 'no error recorded'}`)
  return (await binary(agent.get(`${p.base}/documents/${doc.id}/download`)).expect(200)).body
}

// A change request renaming devices of the frozen LLD, approved by the client.
// renames: [{ from: <current name>, hostname?: <new>, label?: <new panel label> }]
async function renameThroughChangeRequest(ctx, d, renames, { decision = 'approved' } = {}) {
  const { p } = d
  const cr = expectStatus(await p.architect.post(`${p.base}/change-requests`).send({ buildingId: p.b001, title: 'Rename to the new naming', reason: 'Client naming convention' }), 201).body.changeRequest
  const branch = await d.view(cr.branchId)
  const onBranch = (name) => branch.devices.find((x) => x.inDesign && (x.name ?? x.label) === name)
  const hostnames = renames.filter((r) => r.hostname).map((r) => ({ deviceId: onBranch(r.from).id, hostname: r.hostname }))
  if (hostnames.length) expectStatus(await d.save('post', `${p.lld}/rename`, { buildingId: p.b001, branchId: cr.branchId, renames: hostnames }, { branchId: cr.branchId }), 200)
  for (const r of renames.filter((x) => x.label)) expectStatus(await d.save('put', `${p.lld}/devices/${onBranch(r.from).id}/label`, { label: r.label }, { branchId: cr.branchId }), 200)
  expectStatus(await p.architect.post(`${p.base}/change-requests/${cr.id}/submit`), 200)
  const link = expectStatus(await p.admin.agent.post(`${p.base}/change-requests/${cr.id}/send`).send({}), 201).body.shareLink
  expectStatus(await clientDecides(ctx, link, { decision, comments: decision === 'approved' ? 'Approved' : 'No' }), 200)
  return cr
}
const reprintTasks = () => col('tasks').find({ kind: 'reprint_labels' }).sort({ createdAt: 1 }).toArray()

describe('Rename through a change request: the old name is kept and shown (addendum v2.3 Q5; DATA-MODEL §5.19)', () => {
  it('the client approves renaming an installed switch, an installed panel and an AP not yet installed: all keep their old name, shown "old → new" in the LLD, deployment and search; one reprint task for the installed two, to the PM who sent the change (no primary Field Engineer), with their connections', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p, panel } = d
    let dep = await deliverAll(p)
    const role = (v, r) => v.devices.find((x) => x.role === r)
    const edge = role(dep, 'edge')
    const ap = role(dep, 'ap')
    await install(p, edge)
    await install(p, dep.devices.find((x) => x.id === panel.id))
    const [oldEdge, oldAp, oldPanel] = [edge.hostname, ap.hostname, panel.label]
    const [newEdge, newAp, newPanel] = ['E-DE-ERL-C01-B001-EG-009', 'A-DE-ERL-C01-B001-EG-009', 'VT-A1']
    const cr = await renameThroughChangeRequest(ctx, d, [
      { from: oldEdge, hostname: newEdge },
      { from: oldAp, hostname: newAp },
      { from: oldPanel, label: newPanel },
    ])

    // The frozen LLD: new names, the old ones kept and shown first.
    const lld = await d.view()
    const byId = (id) => lld.devices.find((x) => x.id === id)
    expect(byId(edge.id)).toMatchObject({ hostname: newEdge, name: newEdge, legacyHostname: oldEdge, label: `${oldEdge} → ${newEdge}` })
    expect(byId(ap.id)).toMatchObject({ hostname: newAp, legacyHostname: oldAp, label: `${oldAp} → ${newAp}` })
    expect(byId(panel.id)).toMatchObject({ name: newPanel, legacyHostname: oldPanel, label: `${oldPanel} → ${newPanel}`, isPanel: true })
    const border = lld.devices.find((x) => x.inDesign && x.role === 'border')
    expect(border).toMatchObject({ legacyHostname: null, label: border.hostname })
    // One audit entry for the kept names (the rename itself was audited on the branch).
    const kept = await col('auditentries').findOne({ action: 'device.legacy_hostname.set' })
    expect(kept.changes.map((c) => [c.objectId, c.before, c.after]).sort()).toEqual([[ap.id, null, oldAp], [edge.id, null, oldEdge], [panel.id, null, oldPanel]].sort())

    // Deployment: the tree, the device and every link end read "old → new".
    dep = await depView(p.fe, p)
    expect(dep.devices.find((x) => x.id === edge.id)).toMatchObject({ label: `${oldEdge} → ${newEdge}`, name: newEdge, legacyHostname: oldEdge })
    const treeNames = JSON.stringify(dep.tree)
    expect(treeNames).toContain(`${oldEdge} → ${newEdge}`)
    expect(treeNames).toContain(`${oldPanel} → ${newPanel}`)
    const ends = dep.connections.flatMap((c) => c.segments.flatMap((s) => [s.from.name, s.to.name]))
    expect(ends).toContain(`${oldEdge} → ${newEdge}`)
    expect(ends).toContain(`${oldPanel} → ${newPanel}`)

    // Search finds the switch by its old name, shown old → new.
    const found = (await p.fe.get(`/api/v1/orgs/${p.admin.orgId}/search`).query({ q: oldEdge, projectId: p.projectId }).expect(200)).body.results
    expect(found.find((r) => r.type === 'device' && r.title === `${oldEdge} → ${newEdge}`)).toMatchObject({ match: { field: 'legacyHostname', value: oldEdge } })

    // The reprint task: the installed switch and panel only, their two links, to the PM who sent it.
    const [task] = await reprintTasks()
    expect(await reprintTasks()).toHaveLength(1)
    const adminId = p.admin.userId
    const links = dep.connections.filter((c) => [c.source.deviceId, c.dest.deviceId, ...c.hops.map((h) => h.patchPanelId)].some((x) => [edge.id, panel.id].includes(x))).map((c) => c.id)
    expect(links).toHaveLength(2)
    expect(task).toMatchObject({ relatedObjectType: 'change_request', relatedObjectId: cr.id, phaseKey: 'deployment', title: expect.stringMatching(/^Reprint labels — CR-1: 2 renamed device\(s\)$/) })
    expect(String(task.assignedTo)).toBe(adminId)
    expect(task.renames.map((r) => [r.from, r.to]).sort()).toEqual([[oldEdge, newEdge], [oldPanel, newPanel]].sort())
    expect([...task.connectionIds].sort()).toEqual([...links].sort())
    expect(task.notes).toContain(`${oldEdge} → ${newEdge}`)
    expect(task.notes).toContain('C-EA-1')
    // As the task list shows it; the assignee is told.
    const listed = (await p.admin.agent.get(`${p.base}/tasks`).expect(200)).body.tasks.find((x) => x.id === String(task._id))
    expect(listed).toMatchObject({ kind: 'reprint_labels', connectionIds: task.connectionIds, renames: expect.arrayContaining([{ deviceId: edge.id, from: oldEdge, to: newEdge }]) })
    expect(await col('notifications').countDocuments({ type: 'task_assigned', recipientId: oid(adminId), relatedObjectId: String(task._id) })).toBe(1)
    expect(await col('auditentries').countDocuments({ action: 'task.created', objectId: String(task._id) })).toBe(1)
    // Once per change request, however often it runs.
    const crDoc = await ChangeRequest.collection.findOne({ _id: oid(cr.id) })
    const again = await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, () => createReprintTask({ organisationId: p.admin.orgId, projectId: p.projectId, building: { id: p.b001 }, changeRequest: crDoc, renamed: task.renames, sentBy: adminId, session: null }))
    expect(again).toBeNull()
    expect(await reprintTasks()).toHaveLength(1)
  }, 600000)

  it('with a primary Field Engineer: the task is theirs; the CMDB, its extract and the audit export carry the old name; the label sheet for the task prints "old → new"; the Field Engineer completes it', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    await acceptEverything(p)
    const feId = await me(p.fe)
    expectStatus(await p.admin.agent.patch(`${p.base}/schedule/buildings/${p.b001}/assignees`).send({ primaryFieldEngineerId: feId }), 200)
    const edge = (await depView(p.fe, p)).devices.find((x) => x.role === 'edge')
    const [oldEdge, newEdge] = [edge.hostname, 'E-DE-ERL-C01-B001-EG-009']
    await renameThroughChangeRequest(ctx, d, [{ from: oldEdge, hostname: newEdge }])

    const [task] = await reprintTasks()
    expect(String(task.assignedTo)).toBe(feId)
    expect(String(task.assignedBy)).toBe(p.admin.userId)
    // The CMDB record and its extract.
    expect((await cmdbView(p.architect, p)).records.find((r) => r.id === edge.id)).toMatchObject({ hostname: newEdge, legacyHostname: oldEdge, label: `${oldEdge} → ${newEdge}` })
    const csv = (await generate(ctx, p, p.architect, { typeKey: 'cmdb-extract', format: 'csv' })).toString()
    const [header, ...rows] = csv.trim().split(/\r?\n/)
    expect(header.startsWith('Hostname,Legacy hostname,Mode,Role')).toBe(true)
    expect(rows.find((r) => r.startsWith(`${newEdge},`))).toContain(`,${oldEdge},`)
    const json = JSON.parse((await generate(ctx, p, p.architect, { typeKey: 'cmdb-extract', format: 'json' })).toString())
    expect(json.records.find((r) => r.id === edge.id)).toMatchObject({ hostname: newEdge, legacyHostname: oldEdge })
    // The labels for the task's cables: both names on the switch's ends.
    const labels = flat(await pdfPages(await generate(ctx, p, p.fe, { typeKey: 'cable-labels', format: 'pdf', options: { labelSize: 'avery-l7160', connectionIds: task.connectionIds } })))
    expect(labels).toContain(`${oldEdge}→${newEdge}`)
    // Whole, with its port: a long name used to end in "…" and lose the port (M7b-2).
    expect(labels).toContain(`${oldEdge}→${newEdge}Te1/1/1`)
    expect(labels).toContain(`${oldEdge}→${newEdge}Gi1/0/1`)
    // The audit export: the rename on the branch and the kept name.
    const audit = (await p.admin.agent.get(`/api/v1/orgs/${p.admin.orgId}/audit/export.csv`).query({ projectId: p.projectId }).expect(200)).text
    expect(audit).toContain('device.hostname.renamed')
    expect(audit).toContain('device.legacy_hostname.set')
    expect(audit).toContain(oldEdge)
    expect(audit).toContain(newEdge)
    // Done: the Field Engineer completes it.
    expectStatus(await p.fe.patch(`${p.base}/tasks/${task._id}`).send({ status: 'in_progress' }), 200)
    expect(expectStatus(await p.fe.patch(`${p.base}/tasks/${task._id}`).send({ status: 'complete' }), 200).body.task.status).toBe('complete')
  }, 600000)

  it('the old name never changes: a second rename keeps the first, renaming back shows the plain name, a rejected change touches nothing, the model refuses an overwrite; a rename before the LLD is approved keeps no old name', async () => {
    const ctx = t()
    const d = await deployable(ctx)
    const { p } = d
    const dep = await deliverAll(p)
    const edge = dep.devices.find((x) => x.role === 'edge')
    await install(p, edge)
    const original = edge.hostname
    const [n1, n2] = ['E-DE-ERL-C01-B001-EG-008', 'E-DE-ERL-C01-B001-EG-009']
    const label = async () => (await d.view()).devices.find((x) => x.id === edge.id)
    await renameThroughChangeRequest(ctx, d, [{ from: original, hostname: n1 }])
    await renameThroughChangeRequest(ctx, d, [{ from: n1, hostname: n2 }])
    expect(await label()).toMatchObject({ hostname: n2, legacyHostname: original, label: `${original} → ${n2}` })
    // Each approved rename of an installed device asks for new labels.
    expect((await reprintTasks()).map((x) => x.renames.map((r) => `${r.from} → ${r.to}`))).toEqual([[`${original} → ${n1}`], [`${n1} → ${n2}`]])
    // Rejected: nothing applied, no task.
    await renameThroughChangeRequest(ctx, d, [{ from: n2, hostname: 'E-DE-ERL-C01-B001-EG-007' }], { decision: 'rejected' })
    expect(await label()).toMatchObject({ hostname: n2, legacyHostname: original })
    expect(await reprintTasks()).toHaveLength(2)
    // Back to the original name: shown plain, the old name still kept.
    await renameThroughChangeRequest(ctx, d, [{ from: n2, hostname: original }])
    expect(await label()).toMatchObject({ hostname: original, legacyHostname: original, label: original })
    // The model refuses changing or clearing it; only a write filtered on null may set it.
    await runWithScope({ organisationId: p.admin.orgId, projectId: p.projectId }, async () => {
      await expect(Device.updateOne({ _id: edge.id }, { $set: { legacyHostname: 'X' } })).rejects.toThrow(/immutable/)
      await expect(Device.updateOne({ _id: edge.id }, { $unset: { legacyHostname: 1 } })).rejects.toThrow(/immutable/)
      const doc = await Device.findById(edge.id)
      doc.legacyHostname = 'X'
      await expect(doc.save()).rejects.toThrow(/immutable/)
      expect((await Device.updateOne({ _id: edge.id, legacyHostname: null }, { $set: { legacyHostname: 'X' } })).modifiedCount).toBe(0)
    })
    expect((await label()).legacyHostname).toBe(original)

    // Before approval a rename is a design change: no old name kept.
    await clearAll()
    await seedPlatformCatalogue()
    const draft = withDesign(await lldProject(t()))
    await draft.p.architect.post(`${draft.p.lld}/start`).send({ buildingId: draft.p.b001 }).expect(201)
    const e = await draft.device('edge')
    expectStatus(await draft.save('post', `${draft.p.lld}/rename`, { buildingId: draft.p.b001, renames: [{ deviceId: e.id, hostname: n1 }] }), 200)
    expect((await draft.view()).devices.find((x) => x.id === e.id)).toMatchObject({ hostname: n1, legacyHostname: null, label: n1 })
  }, 600000)
})
