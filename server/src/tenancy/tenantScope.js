import mongoose from 'mongoose'
import { currentScope } from './scopeContext.js'

const { ObjectId } = mongoose.Types

export class TenantScopeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

// distinct included: it is a query too, and unhooked it read across tenants.
const READ_HOOKS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments', 'distinct']
const UPDATE_HOOKS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne']
const SCOPE_FIELDS = ['organisationId', 'projectId']

const idOf = (value) => (value instanceof ObjectId ? value : new ObjectId(String(value)))

// The condition every query on a tenant model must carry. It is added with
// query.and(), never merged into the caller's filter, so the caller's own keys
// cannot widen the result.
export function scopeCondition(schema, ctx) {
  if (!ctx) throw new TenantScopeError(`Query on ${schema.__modelName} without a tenant scope`)
  if (ctx.identityUserId) {
    if (!schema.__identityLookup) throw new TenantScopeError(`Identity lookups are not allowed on ${schema.__modelName}`)
    return { userId: idOf(ctx.identityUserId) }
  }
  if (ctx.system) throw new TenantScopeError(`System scope may not read ${schema.__modelName}`)
  if (!ctx.organisationId) throw new TenantScopeError('Tenant scope is missing organisationId')
  const cond = { organisationId: idOf(ctx.organisationId) }
  if (schema.__scope === 'project') {
    if (!ctx.projectId) throw new TenantScopeError(`${schema.__modelName} is project-scoped; projectId is required`)
    cond.projectId = idOf(ctx.projectId)
  }
  return cond
}

function assertNoScopeChange(update) {
  if (!update) return
  const touched = []
  for (const field of SCOPE_FIELDS) {
    if (Object.hasOwn(update, field)) touched.push(field)
    for (const op of ['$set', '$setOnInsert', '$unset']) {
      if (update[op] && Object.hasOwn(update[op], field)) touched.push(field)
    }
  }
  if (touched.length) throw new TenantScopeError(`Tenant scope fields cannot be changed: ${touched.join(', ')}`)
}

// Adds tenant scope to a model. Reads, updates and deletes are filtered;
// inserts and saves are stamped and checked; aggregate gets a leading $match;
// bulkWrite is refused until M2 needs it.
export function tenantScope(schema, { scope = 'project', identityLookup = false, nullableOrganisation = false } = {}) {
  schema.__scope = scope
  schema.__identityLookup = identityLookup

  schema.add({
    organisationId: { type: ObjectId, required: !nullableOrganisation, index: true },
    projectId: scope === 'project' ? { type: ObjectId, required: true, index: true } : { type: ObjectId, default: null, index: true },
  })

  for (const hook of READ_HOOKS) {
    schema.pre(hook, function tenantReadHook() {
      this.and([scopeCondition(schema, currentScope())])
      if (UPDATE_HOOKS.includes(hook)) assertNoScopeChange(this.getUpdate())
    })
  }

  schema.pre('estimatedDocumentCount', function refuseEstimate() {
    throw new TenantScopeError(`estimatedDocumentCount is not allowed on ${schema.__modelName}; use countDocuments with a scope`)
  })

  schema.pre('aggregate', function tenantAggregateHook() {
    this.pipeline().unshift({ $match: scopeCondition(schema, currentScope()) })
  })

  schema.pre('bulkWrite', function refuseBulk() {
    throw new TenantScopeError(`bulkWrite is not supported on ${schema.__modelName} in M1`)
  })

  schema.pre('validate', function tenantSaveHook() {
    const ctx = currentScope()
    if (!ctx) throw new TenantScopeError(`Save on ${schema.__modelName} without a tenant scope`)
    if (this.isNew) {
      if (ctx.system && nullableOrganisation && !this.organisationId) return
      if (!this.organisationId) this.organisationId = idOf(ctx.organisationId)
      else if (String(this.organisationId) !== String(ctx.organisationId)) throw new TenantScopeError('Document organisationId does not match the request scope')
      if (scope === 'project') {
        if (!this.projectId) this.projectId = idOf(ctx.projectId)
        else if (String(this.projectId) !== String(ctx.projectId)) throw new TenantScopeError('Document projectId does not match the request scope')
      }
    } else {
      if (this.isModified('organisationId') || this.isModified('projectId')) throw new TenantScopeError('Tenant scope fields cannot be changed')
      if (String(this.organisationId) !== String(ctx.organisationId)) throw new TenantScopeError('Document belongs to another organisation')
    }
  })

  // Mongoose 9 passes the array as the first argument and no callback; a throw aborts.
  schema.pre('insertMany', function tenantInsertManyHook(docs) {
    const ctx = currentScope()
    if (!ctx) throw new TenantScopeError(`insertMany on ${schema.__modelName} without a tenant scope`)
    for (const doc of docs ?? []) {
      if (String(doc.organisationId) !== String(ctx.organisationId)) throw new TenantScopeError('insertMany organisationId does not match the request scope')
      if (scope === 'project' && String(doc.projectId) !== String(ctx.projectId)) throw new TenantScopeError('insertMany projectId does not match the request scope')
    }
  })

  schema.pre('deleteOne', { document: true, query: false }, function tenantDocDeleteHook() {
    const ctx = currentScope()
    if (!ctx || String(this.organisationId) !== String(ctx.organisationId)) throw new TenantScopeError("Delete outside the document's tenant scope")
  })
}
