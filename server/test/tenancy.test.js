import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import mongoose from 'mongoose'
import { startReplSet, stopReplSet, clearAll } from './helpers/memoryDb.js'
import { runWithScope } from '../src/tenancy/scopeContext.js'
import { TenantScopeError } from '../src/tenancy/tenantScope.js'
import { Membership } from '../src/models/membership.js'
import { Project } from '../src/models/project.js'
import { AuditEntry } from '../src/models/auditEntry.js'
import { recordAudit, systemActor } from '../src/audit/audit.js'

const { ObjectId } = mongoose.Types

// DATA-MODEL §1.5: isolation tests. Two organisations, each with a project.
let replSet
const orgA = new ObjectId()
const orgB = new ObjectId()
const userA = new ObjectId()
const userB = new ObjectId()
let projectA
let projectB

const inOrg = (organisationId, fn) => runWithScope({ organisationId }, fn)

beforeAll(async () => {
  replSet = await startReplSet()
  await Promise.all([Membership.createIndexes(), Project.createIndexes(), AuditEntry.createIndexes()])
})

afterAll(async () => {
  await stopReplSet(replSet)
})

beforeEach(async () => {
  await clearAll()
  projectA = await inOrg(orgA, () => Project.create({ name: 'A-proj', code: 'A1', createdBy: userA }))
  projectB = await inOrg(orgB, () => Project.create({ name: 'B-proj', code: 'B1', createdBy: userB }))
  await inOrg(orgA, () => Membership.create({ userId: userA, level: 'organisation', role: 'org_admin' }))
  await inOrg(orgB, () => Membership.create({ userId: userB, level: 'organisation', role: 'org_admin' }))
})

describe('tenantScope: reads', () => {
  it('a query without any scope throws', async () => {
    await expect(Project.find({})).rejects.toThrow(TenantScopeError)
  })

  it('a findOne without scope throws, even on a known id', async () => {
    await expect(Project.findById(projectA._id)).rejects.toThrow(TenantScopeError)
  })

  it('findById from another organisation returns nothing and does not reveal the id', async () => {
    const found = await inOrg(orgB, () => Project.findById(projectA._id))
    expect(found).toBeNull()
  })

  it('a project in the same organisation is visible', async () => {
    const found = await inOrg(orgA, () => Project.findById(projectA._id))
    expect(found?.name).toBe('A-proj')
  })

  it('a caller filter naming another organisation cannot widen the result', async () => {
    const rows = await inOrg(orgA, () => Project.find({ organisationId: orgB }))
    expect(rows).toEqual([])
  })

  it('an $or filter cannot step outside the scope', async () => {
    const rows = await inOrg(orgA, () => Project.find({ $or: [{ organisationId: orgB }, { name: 'B-proj' }] }))
    expect(rows.every((r) => String(r.organisationId) === String(orgA))).toBe(true)
  })

  it('countDocuments is scoped', async () => {
    const count = await inOrg(orgA, () => Project.countDocuments({}))
    expect(count).toBe(1)
  })

  it('estimatedDocumentCount is refused on tenant models', async () => {
    await expect(inOrg(orgA, () => Project.estimatedDocumentCount())).rejects.toThrow(TenantScopeError)
  })

  it('aggregate without scope throws and with scope sees only its own rows', async () => {
    await expect(Project.aggregate([{ $match: {} }])).rejects.toThrow(TenantScopeError)
    const rows = await inOrg(orgA, () => Project.aggregate([{ $match: {} }]))
    expect(rows.map((r) => r.name)).toEqual(['A-proj'])
  })

})

describe('tenantScope: writes', () => {
  it('creating a document stamps the request organisation', async () => {
    const created = await inOrg(orgA, () => Project.create({ name: 'Stamped', code: 'S1', createdBy: userA }))
    expect(String(created.organisationId)).toBe(String(orgA))
  })

  it('creating with another organisation id is rejected', async () => {
    await expect(
      inOrg(orgA, () => new Project({ organisationId: orgB, name: 'X', code: 'X1', createdBy: userA }).save())
    ).rejects.toThrow(/does not match the request scope/)
  })

  it('a save without any scope throws', async () => {
    await expect(new Project({ organisationId: orgA, name: 'NoScope', createdBy: userA }).save()).rejects.toThrow(TenantScopeError)
  })

  it('updating a document to another organisation is rejected', async () => {
    await expect(
      inOrg(orgA, () => Project.updateOne({ _id: projectA._id }, { $set: { organisationId: orgB } }))
    ).rejects.toThrow(TenantScopeError)
  })

  it('an update through a scope does not touch another organisation\'s row', async () => {
    const result = await inOrg(orgA, () => Project.updateOne({ _id: projectB._id }, { $set: { name: 'hijacked' } }))
    expect(result.matchedCount).toBe(0)
    const still = await inOrg(orgB, () => Project.findById(projectB._id))
    expect(still.name).toBe('B-proj')
  })

  it('a delete through a scope cannot remove another organisation\'s row', async () => {
    const result = await inOrg(orgA, () => Project.deleteOne({ _id: projectB._id }))
    expect(result.deletedCount).toBe(0)
  })

  it('a document loaded under one scope cannot be saved under another', async () => {
    const loaded = await inOrg(orgA, () => Project.findById(projectA._id))
    loaded.name = 'moved'
    await expect(inOrg(orgB, () => loaded.save())).rejects.toThrow(TenantScopeError)
  })

  it('bulkWrite is refused in M1', async () => {
    await expect(inOrg(orgA, () => Project.bulkWrite([]))).rejects.toThrow(TenantScopeError)
  })
})

describe('tenantScope: identity lookups and system scope', () => {
  it('a membership can be listed by user identity, across organisations', async () => {
    const rows = await runWithScope({ identityUserId: userA }, () => Membership.find({}))
    expect(rows.map((r) => String(r.organisationId))).toEqual([String(orgA)])
  })

  it('identity lookup on a model that does not allow it throws', async () => {
    await expect(runWithScope({ identityUserId: userA }, () => Project.find({}))).rejects.toThrow(/Identity lookups are not allowed/)
  })

  it('system scope cannot read tenant data', async () => {
    await expect(runWithScope({ system: true }, () => Project.find({}))).rejects.toThrow(TenantScopeError)
  })
})

describe('audit entries are append-only and organisation-scoped', () => {
  it('an audit entry is written and readable inside its organisation', async () => {
    await recordAudit({ organisationId: orgA, actor: { type: 'user', userId: userA, role: 'org_admin' }, action: 'test.action', objectType: 'Project', objectId: projectA._id, changeType: 'design_intent', source: 'ui' })
    const rows = await inOrg(orgA, () => AuditEntry.find({ action: 'test.action' }))
    expect(rows).toHaveLength(1)
  })

  it('an audit entry from one organisation is invisible to another', async () => {
    await recordAudit({ organisationId: orgA, actor: { type: 'user', userId: userA }, action: 'test.action', objectType: 'Project', changeType: 'design_intent', source: 'ui' })
    const rows = await inOrg(orgB, () => AuditEntry.find({}))
    expect(rows).toEqual([])
  })

  it('a system event with no organisation is written but not readable through a tenant query', async () => {
    await recordAudit({ actor: systemActor(), action: 'auth.login_failed', objectType: 'User', changeType: 'system', source: 'ui', comment: 'unknown account' })
    const everything = await mongoose.connection.db.collection('auditentries').countDocuments({ action: 'auth.login_failed' })
    expect(everything).toBe(1)
    await expect(inOrg(orgA, () => AuditEntry.find({}))).resolves.toEqual([])
    await expect(runWithScope({ system: true }, () => AuditEntry.find({}))).rejects.toThrow(TenantScopeError)
  })

  it('an audit entry cannot be updated', async () => {
    await recordAudit({ organisationId: orgA, actor: { type: 'user', userId: userA }, action: 'test.action', objectType: 'Project', changeType: 'design_intent', source: 'ui' })
    await expect(inOrg(orgA, () => AuditEntry.updateOne({}, { $set: { action: 'tampered' } }))).rejects.toThrow(/append-only/)
  })

  it('an audit entry cannot be deleted', async () => {
    await recordAudit({ organisationId: orgA, actor: { type: 'user', userId: userA }, action: 'test.action', objectType: 'Project', changeType: 'design_intent', source: 'ui' })
    await expect(inOrg(orgA, () => AuditEntry.deleteMany({}))).rejects.toThrow(/append-only/)
  })

  it('a batch over the cap splits into entries sharing a batchId', async () => {
    const changes = Array.from({ length: 205 }, (_, i) => ({ objectType: 'Project', objectId: String(projectA._id), field: `f${i}`, before: 0, after: 1 }))
    await recordAudit({ organisationId: orgA, actor: { type: 'user', userId: userA }, action: 'bulk', objectType: 'Project', changeType: 'design_intent', source: 'ui', changes })
    const rows = await inOrg(orgA, () => AuditEntry.find({ action: 'bulk' }))
    expect(rows).toHaveLength(2)
    expect(rows[0].batchId).toBeTruthy()
    expect(String(rows[0].batchId)).toBe(String(rows[1].batchId))
    expect(rows.reduce((n, r) => n + r.changes.length, 0)).toBe(205)
  })
})

// M3a models (DATA-MODEL §1.5 items 1 and 3, one test per model).
describe('tenantScope: M3a models', () => {
  const projectScoped = {
    Device: () => import('../src/models/device.js').then((m) => m.Device),
    SerialRegistry: () => import('../src/models/serialRegistry.js').then((m) => m.SerialRegistry),
    ImportBatch: () => import('../src/models/importBatch.js').then((m) => m.ImportBatch),
    Blocker: () => import('../src/models/blocker.js').then((m) => m.Blocker),
  }

  for (const [name, load] of Object.entries(projectScoped)) {
    it(`${name}: a query without scope throws, and an organisation-only scope is not enough`, async () => {
      const Model = await load()
      await expect(Model.find({})).rejects.toThrow(TenantScopeError)
      await expect(inOrg(orgA, () => Model.find({}))).rejects.toThrow(TenantScopeError)
    })
  }

  it('CatalogueItem: a query without scope throws; another organisation cannot read an item by id', async () => {
    const { CatalogueItem } = await import('../src/models/catalogueItem.js')
    await expect(CatalogueItem.find({})).rejects.toThrow(TenantScopeError)
    const item = await inOrg(orgA, () =>
      CatalogueItem.create({ layer: 'organisation', kind: 'device_model', key: 'X Y', category: 'switch', vendor: 'X', model: 'Y', heightU: 1 })
    )
    expect(await inOrg(orgB, () => CatalogueItem.findById(item._id))).toBeNull()
    expect((await inOrg(orgA, () => CatalogueItem.findById(item._id)))?.key).toBe('X Y')
  })

  it('Device: findById from another project in the same organisation returns nothing', async () => {
    const { Device } = await import('../src/models/device.js')
    const inProject = (projectId, fn) => runWithScope({ organisationId: orgA, projectId }, fn)
    const otherProject = new ObjectId()
    const device = await inProject(projectA._id, () => Device.create({ origin: 'existing', status: 'in_service', salId: new ObjectId() }))
    expect(await inProject(otherProject, () => Device.findById(device._id))).toBeNull()
    expect(await inProject(projectA._id, () => Device.findById(device._id))).not.toBeNull()
  })
})

// M3b models: every survey/file collection is tenant-scoped, so a missing
// scope throws and another organisation's rows are invisible.
describe('M3b models are tenant-scoped', async () => {
  const project = ['pathway', 'ruState', 'surveyTabRecord', 'designFlag', 'file', 'upload', 'processedOp']
  const organisation = ['surveyCustomField']
  const load = async (name) => Object.values(await import(`../src/models/${name}.js`)).find((v) => v?.modelName)
  for (const name of [...project, ...organisation]) {
    it(`${name}: unscoped queries throw; other organisations' rows are invisible`, async () => {
      const Model = await load(name)
      await expect(Model.find({})).rejects.toThrow(TenantScopeError)
      await Model.collection.insertOne({ organisationId: orgB, projectId: projectB._id, marker: true })
      const scope = project.includes(name) ? { organisationId: orgA, projectId: projectA._id } : { organisationId: orgA }
      expect(await runWithScope(scope, () => Model.countDocuments({}))).toBe(0)
      expect(await runWithScope(scope, () => Model.find({ organisationId: orgB }).lean())).toEqual([])
      const own = project.includes(name) ? { organisationId: orgB, projectId: projectB._id } : { organisationId: orgB }
      expect(await runWithScope(own, () => Model.countDocuments({}))).toBe(1)
    })
  }
})
