import mongoose from 'mongoose'
import { AuditEntry } from '../models/auditEntry.js'
import { runWithScope } from '../tenancy/scopeContext.js'

// Every user action writes one audit entry through this module (DATA-MODEL §8.1).
// Entries carry field-level changes; a batch over the cap splits into several
// entries sharing a batchId, so no single document grows without bound.
export const MAX_CHANGES_PER_ENTRY = 200

// Field-level differences between two snapshots of the same object. Only the
// listed fields are compared, so callers decide what is auditable.
export function diffChanges({ objectType, objectId, before = {}, after = {}, fields }) {
  const changes = []
  for (const field of fields) {
    const from = before[field] ?? null
    const to = after[field] ?? null
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes.push({ objectType, objectId: String(objectId), field, before: from, after: to })
    }
  }
  return changes
}

function chunk(items, size) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Records one action. organisationId null is a system event (for example a
// failed sign-in for an unknown email), written under the system scope.
// Pass a session to write the entry inside the caller's transaction.
export async function recordAudit({
  organisationId = null,
  projectId = null,
  actor,
  action,
  objectType,
  objectId = null,
  changeType = 'system',
  source = 'system',
  changes = [],
  comment = null,
  buildingId = null,
  phaseKey = null,
  viewAsSessionId = null,
  session = null,
}) {
  if (!actor?.type) throw new Error('recordAudit requires an actor')
  const batchId = changes.length > MAX_CHANGES_PER_ENTRY ? new mongoose.Types.ObjectId() : null
  const groups = changes.length ? chunk(changes, MAX_CHANGES_PER_ENTRY) : [[]]
  const scope = organisationId ? { organisationId, projectId } : { system: true }

  return runWithScope(scope, async () => {
    const saved = []
    for (const group of groups) {
      const entry = new AuditEntry({
        organisationId,
        projectId,
        actor,
        action,
        objectType,
        objectId: objectId ? String(objectId) : null,
        changeType,
        source,
        changes: group,
        comment,
        buildingId,
        phaseKey,
        viewAsSessionId,
        batchId,
      })
      saved.push(await entry.save({ session }))
    }
    return saved
  })
}

export const userActor = (userId, role = null) => ({ type: 'user', userId, role })
export const systemActor = () => ({ type: 'system' })
