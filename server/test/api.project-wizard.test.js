import mongoose from 'mongoose'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { createTestApp, signedInOrgAdmin, projectMember } from './helpers/app.js'

let replSet
beforeAll(async () => {
  replSet = await startReplSet()
})
afterAll(async () => {
  await stopReplSet(replSet)
})
beforeEach(async () => {
  await clearAll()
})

const t = () => createTestApp()

const HIERARCHY = {
  countries: [{ code: 'DE', name: 'Germany' }],
  sals: [{ countryCode: 'DE', code: 'ERL' }],
  campuses: [{ countryCode: 'DE', salCode: 'ERL', code: 'C01' }],
  buildings: [{ countryCode: 'DE', salCode: 'ERL', campusCode: 'C01', code: 'B001', name: 'Building B001' }],
  wings: [],
}

describe('project creation wizard', () => {
  it('creates the project, its hierarchy, and sends team invitation emails only after the transaction commits', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)

    const res = await admin.agent
      .post(`/api/v1/orgs/${admin.orgId}/projects`)
      .send({
        name: 'LANspire',
        code: 'LAN',
        clientName: 'Acme Retail',
        description: 'Store network refresh',
        workTypes: [{ key: 'wired_site_survey', name: 'Wired Network Site Survey', isPredefined: true }],
        activePhaseKeys: ['cmo', 'survey', 'hld'],
        hierarchy: HIERARCHY,
        team: [{ email: 'eng@example.com', role: 'field_engineer', scopes: [] }],
      })
      .expect(201)
    const projectId = res.body.project.id

    const project = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).expect(200)
    expect(project.body.project.activePhases.map((p) => p.phaseKey)).toEqual(['cmo', 'survey', 'hld'])
    expect(project.body.project.clientName).toBe('Acme Retail')
    expect(project.body.project.workTypes).toHaveLength(1)
    expect(project.body.project.buildings).toHaveLength(1)

    const tree = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/projects/${projectId}/hierarchy`).expect(200)
    expect(tree.body.tree.buildings[0].code).toBe('B001')

    const sent = ctx.mailer.lastTo('eng@example.com')
    expect(sent).toBeTruthy()
  })

  it('defaults to all nine phases when none are given', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', code: 'LAN' }).expect(201)
    const project = await admin.agent.get(`/api/v1/orgs/${admin.orgId}/projects/${res.body.project.id}`).expect(200)
    expect(project.body.project.activePhases).toHaveLength(9)
  })

  it('the creator becomes PM even with hierarchy and team in the same submission', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', hierarchy: HIERARCHY, team: [{ email: 'x@example.com', role: 'viewer', scopes: [] }] }).expect(201)
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects/${res.body.project.id}/blockers`).send({ buildingId: '65f0c0ffee0000000000b001', phaseKey: 'survey', description: 'PM can raise' }).expect(201)
  })

  it('a hierarchy reference that does not resolve rolls back the whole transaction and sends no email', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const before = await mongoose.connection.db.collection('projects').countDocuments({})

    await admin.agent
      .post(`/api/v1/orgs/${admin.orgId}/projects`)
      .send({
        name: 'LANspire',
        hierarchy: { ...HIERARCHY, wings: [{ countryCode: 'DE', salCode: 'ERL', campusCode: 'C01', buildingCode: 'B999', code: 'W1', name: 'West wing' }] },
        team: [{ email: 'eng@example.com', role: 'field_engineer', scopes: [] }],
      })
      .expect(400)

    const after = await mongoose.connection.db.collection('projects').countDocuments({})
    expect(after).toBe(before)
    expect(ctx.mailer.lastTo('eng@example.com')).toBeFalsy()
  })
})

describe('project settings: general, work types, phase gating, danger zone', () => {
  async function newProject(admin, activePhaseKeys) {
    const res = await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects`).send({ name: 'LANspire', activePhaseKeys }).expect(201)
    return res.body.project.id
  }

  it('only Org Admin or PM may update project settings; an Architect cannot', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const architect = await projectMember(ctx, admin, { email: 'arch@example.com', role: 'architect', projectId })
    await architect.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ name: 'New name' }).expect(403)
    await admin.agent.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ name: 'New name' }).expect(200)
  })

  it('a phase with no data can be removed from activePhases', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin, ['cmo', 'survey', 'hld'])
    const res = await admin.agent.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ activePhaseKeys: ['cmo', 'survey'] }).expect(200)
    expect(res.body.project.activePhases.map((p) => p.phaseKey)).toEqual(['cmo', 'survey'])
  })

  it('a phase that already has an open blocker cannot be removed', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin, ['cmo', 'survey', 'hld'])
    await admin.agent.post(`/api/v1/orgs/${admin.orgId}/projects/${projectId}/blockers`).send({ buildingId: '65f0c0ffee0000000000b001', phaseKey: 'hld', description: 'Blocked' }).expect(201)

    await admin.agent.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ activePhaseKeys: ['cmo', 'survey'] }).expect(400)
  })

  it('a PM may add a phase that has not started', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin, ['cmo'])
    const res = await admin.agent.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ activePhaseKeys: ['cmo', 'survey', 'hld'] }).expect(200)
    expect(res.body.project.activePhases.map((p) => p.phaseKey)).toEqual(['cmo', 'survey', 'hld'])
  })

  it('Danger zone: archiving sets status to archived', async () => {
    const ctx = t()
    const admin = await signedInOrgAdmin(ctx)
    const projectId = await newProject(admin)
    const res = await admin.agent.patch(`/api/v1/orgs/${admin.orgId}/projects/${projectId}`).send({ status: 'archived' }).expect(200)
    expect(res.body.project.status).toBe('archived')
  })
})
