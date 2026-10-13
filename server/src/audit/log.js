import mongoose from 'mongoose'
import { scopeCoversBuilding } from '@rackium/shared/scope.js'
import { AuditEntry } from '../models/auditEntry.js'
import { User } from '../models/user.js'
import { Building } from '../models/building.js'
import { Project } from '../models/project.js'
import { membershipsForUser } from '../auth/service.js'
import { buildingWithScopeIds } from '../access/scope.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { notFound } from '../http/errors.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))
// View As and Rackium Team access (DATA-MODEL §1.4, §1.6, §8.3): Org Admin only.
const ADMIN_ONLY_CHANGE_TYPES = ['view_as_access', 'platform_access']
export const AUDIT_EXPORT_LIMIT = 10000

// The audit log screen (client audit item 16; DATA-MODEL §8; M5b). The Org
// Admin reads the whole organisation; a PM or Architect reads one project
// (the route checks the role), limited to the buildings their membership
// scope covers and without the View-As / platform-access entries. Filters:
// date range, user, action type, module (phase), object type, building.
export function createAuditLogService() {
  // Who sees what: { admin, projectId, coversBuilding }.
  async function visibility({ userId, organisationId, roles, projectId }) {
    const admin = roles.includes('org_admin')
    if (admin) return { admin, projectId: projectId ?? null, coversBuilding: () => true }
    const membership = (await membershipsForUser(userId)).find((m) => m.level === 'project' && String(m.projectId) === String(projectId) && String(m.organisationId) === String(organisationId) && m.active !== false)
    const scopes = membership?.scopes ?? []
    if (!scopes.length) return { admin, projectId, coversBuilding: () => true }
    const cache = new Map()
    return {
      admin,
      projectId,
      scoped: true,
      coversBuilding: async (buildingId) => {
        if (!buildingId) return true
        const key = String(buildingId)
        if (!cache.has(key)) cache.set(key, scopeCoversBuilding(scopes, await runWithScope({ organisationId, projectId }, () => buildingWithScopeIds(key))))
        return cache.get(key)
      },
    }
  }

  function filterOf(v, q) {
    const f = {}
    if (v.projectId) f.projectId = oid(v.projectId)
    if (!v.admin) f.changeType = { $nin: ADMIN_ONLY_CHANGE_TYPES }
    if (q.from || q.to) f.occurredAt = { ...(q.from ? { $gte: new Date(`${q.from}T00:00:00.000Z`) } : {}), ...(q.to ? { $lt: new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86400000) } : {}) }
    if (q.userId) f['actor.userId'] = oid(q.userId)
    if (q.action) f.action = q.action.endsWith('.') || !q.action.includes('.') ? { $regex: `^${q.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${q.action.endsWith('.') ? '' : '(\\.|$)'}` } : q.action
    if (q.module) f.phaseKey = q.module
    if (q.objectType) f.objectType = q.objectType
    if (q.buildingId) f.buildingId = oid(q.buildingId)
    if (q.changeType) f.changeType = v.admin || !ADMIN_ONLY_CHANGE_TYPES.includes(q.changeType) ? q.changeType : '__none__'
    return f
  }

  async function names(entries) {
    const userIds = [...new Set(entries.map((e) => e.actor?.userId).filter(Boolean).map(String))]
    const buildingIds = [...new Set(entries.map((e) => e.buildingId).filter(Boolean).map(String))]
    const projectIds = [...new Set(entries.map((e) => e.projectId).filter(Boolean).map(String))]
    const users = new Map((await User.find({ _id: { $in: userIds } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
    const buildings = new Map()
    const projects = new Map()
    for (const pid of projectIds) {
      await runWithScope({ organisationId: entries[0].organisationId, projectId: pid }, async () => {
        const p = await Project.findById(pid, { name: 1 }).lean()
        if (p) projects.set(pid, p.name)
        for (const b of await Building.find({ _id: { $in: buildingIds } }, { code: 1 }).lean()) buildings.set(String(b._id), b.code)
      })
    }
    return { users, buildings, projects }
  }

  const actorLabel = (e, n) => (e.actor?.type === 'client_link' ? `${e.actor.clientName ?? 'Client'} (client)` : e.actor?.type === 'system' ? 'System' : e.actor?.type === 'rackium_team' ? 'Rackium Team' : n.users.get(String(e.actor?.userId)) ?? 'Unknown user')

  function toEntry(e, n, { withChanges = true } = {}) {
    return {
      id: String(e._id),
      occurredAt: e.occurredAt,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      projectId: e.projectId ? String(e.projectId) : null,
      projectName: e.projectId ? n.projects.get(String(e.projectId)) ?? null : null,
      buildingId: e.buildingId ? String(e.buildingId) : null,
      buildingCode: e.buildingId ? n.buildings.get(String(e.buildingId)) ?? null : null,
      module: e.phaseKey ?? null,
      actor: { type: e.actor.type, userId: e.actor.userId ? String(e.actor.userId) : null, role: e.actor.role ?? null, name: actorLabel(e, n), shareLinkId: e.actor.shareLinkId ? String(e.actor.shareLinkId) : null },
      changeType: e.changeType,
      source: e.source,
      offlineQueuedAt: e.offlineQueuedAt ?? null,
      conflict: Boolean(e.conflict),
      comment: e.comment ?? null,
      changeCount: e.changes?.length ?? 0,
      ...(withChanges ? { changes: (e.changes ?? []).map((c) => ({ objectType: c.objectType, objectId: c.objectId, field: c.field, before: c.before ?? null, after: c.after ?? null })) } : {}),
    }
  }

  // Reads matching entries newest first, dropping out-of-scope buildings, until `limit`.
  async function read(v, q, limit) {
    const filter = filterOf(v, q)
    if (q.before) {
      const [at, id] = String(q.before).split('_')
      filter.$or = [{ occurredAt: { $lt: new Date(at) } }, { occurredAt: new Date(at), _id: { $lt: oid(id) } }]
    }
    const out = []
    let last = null
    for (let page = 0; out.length < limit && page < 50; page++) {
      const batch = await AuditEntry.find({ ...filter, ...(last ? { $and: [{ $or: [{ occurredAt: { $lt: last.occurredAt } }, { occurredAt: last.occurredAt, _id: { $lt: last._id } }] }] } : {}) })
        .sort({ occurredAt: -1, _id: -1 })
        .limit(Math.min(500, limit + 1))
        .lean()
      if (!batch.length) break
      for (const e of batch) {
        last = e
        if (await v.coversBuilding(e.buildingId)) out.push(e)
        if (out.length > limit) break
      }
      if (batch.length < Math.min(500, limit + 1)) break
    }
    return out
  }

  return {
    visibility,

    async list({ user, organisationId, roles, query }) {
      const v = await visibility({ userId: user._id, organisationId, roles, projectId: query.projectId })
      const rows = await read(v, query, query.limit)
      const page = rows.slice(0, query.limit)
      const n = page.length ? await names(page) : { users: new Map(), buildings: new Map(), projects: new Map() }
      const tail = page[page.length - 1]
      return { entries: page.map((e) => toEntry(e, n)), nextBefore: rows.length > query.limit ? `${tail.occurredAt.toISOString()}_${tail._id}` : null }
    },

    async get({ user, organisationId, roles, id, projectId }) {
      const v = await visibility({ userId: user._id, organisationId, roles, projectId })
      const e = mongoose.isValidObjectId(id) ? await AuditEntry.findOne({ _id: id, ...filterOf(v, {}) }).lean() : null
      if (!e || !(await v.coversBuilding(e.buildingId))) throw notFound('Audit entry not found')
      return { entry: toEntry(e, await names([e])) }
    },

    // CSV (one row per entry; field changes joined), at most AUDIT_EXPORT_LIMIT rows.
    async exportCsv({ user, organisationId, roles, query }) {
      const v = await visibility({ userId: user._id, organisationId, roles, projectId: query.projectId })
      const rows = (await read(v, query, AUDIT_EXPORT_LIMIT)).slice(0, AUDIT_EXPORT_LIMIT)
      const n = rows.length ? await names(rows) : { users: new Map(), buildings: new Map(), projects: new Map() }
      const show = (x) => (x == null ? '—' : typeof x === 'object' ? JSON.stringify(x) : String(x))
      const header = ['Occurred at (UTC)', 'User', 'Role', 'Action', 'Object type', 'Object id', 'Project', 'Building', 'Module', 'Change type', 'Source', 'Comment', 'Changes']
      const lines = rows.map((raw) => {
        const e = toEntry(raw, n)
        return [e.occurredAt.toISOString(), e.actor.name, e.actor.role ?? '', e.action, e.objectType ?? '', e.objectId ?? '', e.projectName ?? '', e.buildingCode ?? '', e.module ?? '', e.changeType, e.source, e.comment ?? '', e.changes.map((c) => `${c.field}: ${show(c.before)} → ${show(c.after)}`).join('; ')]
      })
      return { csv: [header, ...lines].map((cols) => cols.map(csvCell).join(',')).join('\r\n'), count: lines.length, truncated: rows.length >= AUDIT_EXPORT_LIMIT }
    },
  }
}

// RFC 4180 quoting; a leading = + - @ is prefixed so a spreadsheet never runs it as a formula.
export function csvCell(value) {
  let s = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
