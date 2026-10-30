import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, projectMember, signedInOrgAdmin } from './helpers/app.js'
import { hldProject, hldView } from './helpers/hld.js'
import { lldProject, lldView } from './helpers/lld.js'
import { seedPlatformCatalogue } from '../src/catalogue/seed.js'

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
const col = (name) => mongoose.connection.db.collection(name)
function expectStatus(res, status) {
  expect(res.status, JSON.stringify(res.body)).toBe(status)
  return res
}
const audit = (action) => col('auditentries').find({ action }).toArray()
const org = (p) => `/api/v1/orgs/${p.admin.orgId}/validation-rules`
const project = (p) => `${p.base}/validation-rules`
const singleUplink = { name: 'Edge has one uplink', object: 'device', subjectRole: 'edge', field: 'uplinkCount', operator: 'eq', value: 2, severity: 'warning', message: 'Edge switch {hostname} has {value} uplinks' }

async function generated(ctx = t()) {
  const p = await hldProject(ctx)
  const v0 = await hldView(p.architect, p)
  await p.architect.post(`${p.hld}/generate`).send({ buildingId: p.b001, preset: 'M', baseRevision: v0.design.revision }).expect(201)
  return p
}
const validation = async (p) => (await p.architect.get(`${p.hld}/buildings/${p.b001}/validation`).expect(200)).body
const custom = (v) => v.findings.filter((f) => f.custom)

describe('Who writes custom rules (D11; DATA-MODEL §3.11)', () => {
  it('the Org Admin writes the organisation’s, an Architect covering the whole project writes its own; every member reads what applies; audited', async () => {
    const ctx = t()
    const p = await hldProject(ctx)
    // Organisation rules: the Org Admin only.
    const made = expectStatus(await p.admin.agent.post(org(p)).send({ ...singleUplink, name: 'Org rule' }), 201).body.rule
    expect(made).toMatchObject({ scope: 'organisation', name: 'Org rule', object: 'device', subjectRole: 'edge', field: 'uplinkCount', operator: 'eq', value: 2, severity: 'warning', enabled: true })
    for (const who of [p.architect, p.fe, p.viewer]) expectStatus(await who.post(org(p)).send({ ...singleUplink, name: 'No' }), 403)
    // Project rules: the Architect — not the Org Admin, a Field Engineer or a Viewer.
    const own = expectStatus(await p.architect.post(project(p)).send({ ...singleUplink, name: 'Project rule' }), 201).body.rule
    expect(own).toMatchObject({ scope: 'project', name: 'Project rule' })
    for (const who of [p.admin.agent, p.fe, p.viewer]) expectStatus(await who.post(project(p)).send({ ...singleUplink, name: 'No' }), 403)
    // An Architect scoped to one building does not write rules for all of them.
    const scoped = await projectMember(ctx, p.admin, { email: 'arch-b001@example.com', role: 'architect', projectId: p.projectId, scopes: [{ type: 'building', refId: p.b001 }] })
    expectStatus(await scoped.post(project(p)).send({ ...singleUplink, name: 'Scoped' }), 403)
    expect((await scoped.get(project(p)).expect(200)).body.canEdit).toBe(false)
    // Every member reads both lists.
    const list = (await p.viewer.get(project(p)).expect(200)).body
    expect(list.organisation.map((r) => r.name)).toEqual(['Org rule'])
    expect(list.project.map((r) => r.name)).toEqual(['Project rule'])
    expect(list.canEdit).toBe(false)
    expect((await p.architect.get(project(p)).expect(200)).body.canEdit).toBe(true)
    // A rule is changed only at its own level.
    expectStatus(await p.architect.put(`${project(p)}/${made.id}`).send({ ...singleUplink, name: 'Taken over' }), 404)
    expectStatus(await p.admin.agent.put(`${org(p)}/${own.id}`).send({ ...singleUplink, name: 'Taken over' }), 404)
    expectStatus(await p.architect.delete(`${project(p)}/${made.id}`), 404)
    // One name per level, any case.
    expect(expectStatus(await p.architect.post(project(p)).send({ ...singleUplink, name: 'project RULE' }), 409).body.error.code).toBe('duplicate_name')
    // Update, disable, delete: audited.
    expect(expectStatus(await p.architect.put(`${project(p)}/${own.id}`).send({ ...singleUplink, name: 'Project rule', operator: 'lte', value: 1 }), 200).body.rule).toMatchObject({ operator: 'lte', value: 1 })
    expect(expectStatus(await p.architect.patch(`${project(p)}/${own.id}/enabled`).send({ enabled: false }), 200).body.rule.enabled).toBe(false)
    expectStatus(await p.architect.delete(`${project(p)}/${own.id}`), 200)
    expect((await audit('validation_rule.created')).map((a) => a.comment)).toEqual(['Org rule — warning: Device (edge) Uplink count is 2', 'Project rule — warning: Device (edge) Uplink count is 2'])
    const updated = (await audit('validation_rule.updated'))[0]
    expect(updated.changes[0]).toMatchObject({ before: 'warning: Device (edge) Uplink count is 2', after: 'warning: Device (edge) Uplink count is at most 1' })
    expect((await audit('validation_rule.disabled')).length).toBe(1)
    expect((await audit('validation_rule.deleted')).length).toBe(1)
  }, 120000)

  it('one organisation’s rules neither show in nor apply to another’s', async () => {
    const ctx = t()
    const p = await generated(ctx)
    const other = await signedInOrgAdmin(ctx, { email: 'other@example.com', organisationName: 'Other Org' })
    expectStatus(await other.agent.post(`/api/v1/orgs/${other.orgId}/validation-rules`).send({ name: 'Theirs', object: 'rack', field: 'heightU', operator: 'gt', value: 1, severity: 'critical' }), 201)
    expect((await p.admin.agent.get(org(p)).expect(200)).body.rules).toEqual([])
    expect(custom(await validation(p))).toEqual([])
    expectStatus(await other.agent.get(org(p)), 404)
  }, 120000)
})

describe('Saving a rule is checked against the allowlist (no expression language)', () => {
  it('refuses unknown objects and fields, operators that do not suit the field, values of the wrong type, unknown placeholders', async () => {
    const p = await hldProject(t())
    const refused = async (body, path) => {
      const res = expectStatus(await p.architect.post(project(p)).send({ name: 'R', severity: 'info', ...body }), 400)
      expect(JSON.stringify(res.body), JSON.stringify(body)).toContain(path)
    }
    await refused({ object: 'surveyTabRecord', field: 'status', operator: 'eq', value: 'x' }, 'object')
    // JavaScript's own property names are not on the allowlist (a 500 before it used own keys).
    await refused({ object: 'constructor', field: 'name', operator: 'eq', value: 'x' }, 'object')
    await refused({ object: 'device', field: 'constructor', operator: 'eq', value: 'x' }, 'field')
    await refused({ object: 'device', field: '__proto__', operator: 'eq', value: 'x' }, 'field')
    await refused({ object: 'device', field: 'hostname', operator: 'gt', value: 1 }, 'operator')
    await refused({ object: 'device', field: 'placed', operator: 'empty' }, 'operator')
    await refused({ object: 'device', field: 'uplinkCount', operator: 'eq', value: 'two' }, 'value')
    await refused({ object: 'device', field: 'uplinkCount', operator: 'eq' }, 'value')
    await refused({ object: 'device', field: 'role', operator: 'eq', value: 'mainframe' }, 'value')
    await refused({ object: 'device', field: 'role', operator: 'in', value: [] }, 'value')
    await refused({ object: 'device', field: 'hostname', operator: 'empty', value: 'x' }, 'value')
    await refused({ object: 'rack', subjectRole: 'edge', field: 'heightU', operator: 'gt', value: 1 }, 'subjectRole')
    await refused({ object: 'device', field: 'hostname', operator: 'empty', message: 'Bad {process.env.SECRET}' }, 'message')
    await refused({ object: 'device', field: 'hostname', operator: 'empty', severity: 'blocking' }, 'severity')
    await refused({ object: 'device', field: 'hostname', operator: 'empty', script: 'x' }, 'script')
    expect((await p.architect.get(project(p)).expect(200)).body.project).toEqual([])
  }, 120000)
})

describe('Custom rules run alongside the built-in ones, from the next validation', () => {
  it('in the HLD: a Warning shows with the Custom badge data and its filled message; a Critical blocks submit; disabled is ignored; an approved design is not reopened', async () => {
    const ctx = t()
    const p = await generated(ctx)
    const before = await validation(p)
    expect(custom(before)).toEqual([])
    // A device rule, on one role, with a message filled as plain text.
    expectStatus(await p.architect.post(project(p)).send(singleUplink), 201)
    let v = await validation(p)
    const edge = (await hldView(p.architect, p)).devices.find((d) => d.role === 'edge')
    expect(custom(v)).toEqual([expect.objectContaining({ rule: 'Custom', custom: true, title: 'Edge has one uplink', severity: 'warning', objectType: 'device', objectId: edge.id, message: `Edge switch ${edge.hostname} has 2 uplinks` })])
    expect(v.summary.warning).toBe(before.summary.warning + 1)
    expect(v.summary.blocksSubmit).toBe(false)
    // An organisation Critical on a rack blocks submit, with the rest.
    const blocker = expectStatus(await p.admin.agent.post(org(p)).send({ name: 'Racks must be 48U', object: 'rack', field: 'heightU', operator: 'neq', value: 48, severity: 'critical', message: 'Rack {rack_label} is {value}U' }), 201).body.rule
    v = await validation(p)
    expect(custom(v).filter((f) => f.severity === 'critical').map((f) => f.message).sort()).toEqual(p.racks.map((r) => `Rack ${r.code} is 42U`).sort())
    expect(v.summary.blocksSubmit).toBe(true)
    const rev = async () => (await hldView(p.architect, p)).design.revision
    const baseRevision = await rev()
    const refused = expectStatus(await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision }), 409).body.error
    expect(refused.code).toBe('validation_blocked')
    // Disabled: no longer counted.
    expectStatus(await p.admin.agent.patch(`${org(p)}/${blocker.id}/enabled`).send({ enabled: false }), 200)
    expect((await validation(p)).summary.blocksSubmit).toBe(false)
    const rev2 = await rev()
    expectStatus(await p.architect.post(`${p.hld}/submit`).send({ buildingId: p.b001, baseRevision: rev2 }), 201)
    await p.admin.agent.post(`${p.hld}/decision`).send({ buildingId: p.b001, decision: 'approved' }).expect(200)
    // Enabled again after the approval: it shows, and the approval stands.
    expectStatus(await p.admin.agent.patch(`${org(p)}/${blocker.id}/enabled`).send({ enabled: true }), 200)
    expect((await validation(p)).summary.blocksSubmit).toBe(true)
    const view = await hldView(p.architect, p)
    expect(view.status).toBe('approved')
    expect(view.design.state).toBe('approved')
  }, 180000)

  it('in the LLD too: connection, room and pathway rules; only this project’s rules; the preview flags without storing anything', async () => {
    const ctx = t()
    const p = await lldProject(ctx)
    await p.admin.agent.patch(p.base).send({ activePhaseKeys: ['cmo', 'survey', 'hld', 'lld'] }).expect(200)
    await p.architect.post(`${p.lld}/start`).send({ buildingId: p.b001 }).expect(201)
    const validate = async () => (await p.architect.get(`${p.lld}/buildings/${p.b001}/validation`).expect(200)).body
    const add = async (body) => expectStatus(await p.architect.post(project(p)).send(body), 201).body.rule
    // A draft on the LLD: the preview says what it would flag, nothing is saved or changed.
    const draft = { name: 'Long fibre', object: 'connection', field: 'lengthM', operator: 'gt', value: 10, severity: 'critical', message: '{link_id} is {length} m' }
    const preview = expectStatus(await p.architect.post(`${project(p)}/preview`).send({ buildingId: p.b001, rule: draft }), 200).body
    expect(preview.stage).toBe('lld')
    expect(preview.count).toBeGreaterThan(0)
    expect(preview.samples[0]).toMatch(/→ .* is \d+(\.\d)? m$/)
    expect(await col('validationrules').countDocuments()).toBe(0)
    expect(custom(await validate())).toEqual([])
    // Who previews; a building outside the project; a bad draft.
    expectStatus(await p.fe.post(`${project(p)}/preview`).send({ buildingId: p.b001, rule: draft }), 403)
    expectStatus(await p.admin.agent.post(`${project(p)}/preview`).send({ buildingId: p.b001, rule: draft }), 200)
    expectStatus(await p.architect.post(`${project(p)}/preview`).send({ buildingId: new mongoose.Types.ObjectId().toString(), rule: draft }), 404)
    expectStatus(await p.architect.post(`${project(p)}/preview`).send({ buildingId: p.b001, rule: { ...draft, value: 'long' } }), 400)
    // Saved rules run in the LLD's validation and block its submit.
    await add(draft)
    await add({ name: 'Room with one rack', object: 'room', field: 'rackCount', operator: 'eq', value: 1, severity: 'info', message: 'Room {room_code} has {value} rack' })
    await add({ name: 'Short pathway', object: 'pathway', field: 'distanceM', operator: 'lt', value: 100, severity: 'warning', message: '{from} to {to}: {value} m' })
    const v = await validate()
    const by = (title) => custom(v).filter((f) => f.title === title)
    expect(by('Long fibre').length).toBe(preview.count)
    expect(by('Long fibre').every((f) => f.objectType === 'connection')).toBe(true)
    expect(by('Room with one rack').map((f) => f.message).sort()).toEqual([p.rooms.main.code, p.rooms.second.code].map((c) => `Room ${c} has 1 rack`).sort())
    expect(by('Short pathway').map((f) => f.message)).toEqual([`${p.rooms.main.code} to ${p.rooms.second.code}: 42 m`])
    expect(v.summary.blocksSubmit).toBe(true)
    expect((await lldView(p.architect, p)).status).not.toBe('approved')
    const baseRevision = (await lldView(p.architect, p)).design.revision
    expect(expectStatus(await p.architect.post(`${p.lld}/submit`).send({ buildingId: p.b001, baseRevision }), 409).body.error.code).toBe('validation_blocked')
  }, 240000)
})
