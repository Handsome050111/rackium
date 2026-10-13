import mongoose from 'mongoose'
import { taskTransitionProblem, isOverdue, isDueSoon, TASK_STATUS_LABELS, PHASE_LABELS } from '@rackium/shared/notifications.js'
import { RESOURCE_TASKS } from '@rackium/shared/billOfResources.js'
import { scopeCoversBuilding } from '@rackium/shared/scope.js'
import { Task } from '../models/task.js'
import { Membership } from '../models/membership.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Device } from '../models/device.js'
import { Blocker } from '../models/blocker.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { Project } from '../models/project.js'
import { User } from '../models/user.js'
import { recordAudit, userActor, diffChanges } from '../audit/audit.js'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { buildingWithScopeIds, callerAccess, projectScope, requireBuilding } from '../access/scope.js'
import { membershipsForUser } from '../auth/service.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { notify, projectMembers, paths } from '../notifications/notify.js'
import { projectSettings, resourceEstimateOf } from '../delivery/common.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const phaseLabel = (key) => PHASE_LABELS[key] ?? key

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

function toTask(t, names, now = new Date()) {
  return {
    id: String(t._id),
    projectId: id(t.projectId),
    title: t.title,
    relatedObjectType: t.relatedObjectType ?? null,
    relatedObjectId: t.relatedObjectId ?? null,
    relatedLabel: t.relatedLabel ?? null,
    buildingId: id(t.buildingId),
    phaseKey: t.phaseKey ?? null,
    assignedTo: id(t.assignedTo),
    assignedToName: names.get(String(t.assignedTo)) ?? null,
    assignedBy: id(t.assignedBy),
    assignedByName: names.get(String(t.assignedBy)) ?? null,
    deadline: t.deadline ? t.deadline.toISOString().slice(0, 10) : null,
    notes: t.notes ?? null,
    status: t.status,
    statusLabel: TASK_STATUS_LABELS[t.status],
    overdue: isOverdue(t, now),
    dueSoon: isDueSoon(t, now),
    resourceTask: t.resourceTask ?? null,
    completedAt: t.completedAt ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

// Tasks (brief v2.2 §8; DATA-MODEL §5.11; M5b). A PM or an Architect (within
// their scope) creates and assigns; the assignee must be an active project
// member whose scope covers the task's building. Every project member reads
// the tasks of the buildings they may see.
export function createTaskService({ lld }) {
  // The task's object, checked against the caller's scope: its building and a label.
  async function resolveRelated(req, { relatedObjectType = null, relatedObjectId = null, buildingId = null, phaseKey = null }) {
    const bad = (what) => notFound(`${what} not found`)
    const valid = (v) => mongoose.isValidObjectId(v)
    switch (relatedObjectType) {
      case null:
      case undefined: {
        if (!buildingId) {
          const { scopes } = await callerAccess(req)
          if (scopes.length) throw forbidden('Your membership covers part of the project — name the building the task is about')
          return { buildingId: null, label: null, relatedObjectId: null }
        }
        const b = await requireBuilding(req, buildingId)
        return { buildingId: b.id, label: null, relatedObjectId: null }
      }
      case 'building': {
        const b = await requireBuilding(req, relatedObjectId)
        return { buildingId: b.id, label: `Building ${b.code}`, relatedObjectId: b.id }
      }
      case 'room': {
        const room = valid(relatedObjectId) ? await Room.findById(relatedObjectId).lean() : null
        if (!room) throw bad('Room')
        const b = await requireBuilding(req, room.buildingId)
        return { buildingId: b.id, label: `Room ${room.code}`, relatedObjectId: String(room._id) }
      }
      case 'rack': {
        const rack = valid(relatedObjectId) ? await Rack.findById(relatedObjectId).lean() : null
        if (!rack) throw bad('Rack')
        const b = await requireBuilding(req, rack.buildingId)
        return { buildingId: b.id, label: `Rack ${rack.code}`, relatedObjectId: String(rack._id) }
      }
      case 'device': {
        const d = valid(relatedObjectId) ? await Device.findById(relatedObjectId).lean() : null
        if (!d || !d.buildingId) throw bad('Device')
        const b = await requireBuilding(req, d.buildingId)
        return { buildingId: b.id, label: d.hostname ?? d.label ?? 'Device', relatedObjectId: String(d._id) }
      }
      case 'phase': {
        if (!buildingId) throw badRequest('A phase task names its building')
        const b = await requireBuilding(req, buildingId)
        return { buildingId: b.id, label: `${phaseLabel(relatedObjectId)} — ${b.code}`, relatedObjectId: String(relatedObjectId), phaseKey: String(relatedObjectId) }
      }
      case 'blocker': {
        const blk = valid(relatedObjectId) ? await Blocker.findById(relatedObjectId).lean() : null
        const scope = await projectScope(req)
        if (!blk || !scope.coversItem(blk)) throw bad('Blocker')
        return { buildingId: id(blk.buildingId), label: `Blocker: ${blk.description.slice(0, 60)}`, relatedObjectId: String(blk._id), phaseKey: blk.phaseKey }
      }
      case 'change_request': {
        const cr = valid(relatedObjectId) ? await ChangeRequest.findById(relatedObjectId).lean() : null
        if (!cr) throw bad('Change request')
        const b = await requireBuilding(req, cr.buildingId)
        return { buildingId: b.id, label: `CR-${cr.number} ${cr.title}`, relatedObjectId: String(cr._id) }
      }
      default:
        throw badRequest(`Unknown related object type ${relatedObjectType}`)
    }
  }

  async function assertAssignee(projectId, assignedTo, buildingId) {
    const building = buildingId ? await buildingWithScopeIds(buildingId) : null
    const ok = await projectMembers({ projectId, userIds: [assignedTo], building })
    if (!ok.length) throw badRequest(buildingId ? 'The assignee must be a member of this project whose scope covers the building' : 'The assignee must be a member of this project')
  }

  async function load(req, taskId) {
    const task = mongoose.isValidObjectId(taskId) ? await Task.findById(taskId) : null
    if (!task) throw notFound('Task not found')
    if (task.buildingId) {
      const scope = await projectScope(req)
      if (!scope.coversBuilding(task.buildingId)) throw notFound('Task not found')
    }
    return task
  }

  const audit = (req, actor, action, task, extra = {}) =>
    recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: task.buildingId ?? null, phaseKey: task.phaseKey ?? 'tasks', actor: userActor(actor.userId, actor.role), action, objectType: 'Task', objectId: task._id, changeType: 'design_intent', source: 'ui', ...extra })

  async function notifyAssigned(req, task, actor) {
    await notify({
      type: 'task_assigned',
      buildingId: task.buildingId,
      title: `Task assigned: ${task.title}`,
      body: [task.relatedLabel, task.deadline ? `Due ${task.deadline.toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · ') || null,
      relatedObjectType: 'task',
      relatedObjectId: task._id,
      link: paths.tasks(req.org.id, req.project.id, task._id),
      actorId: actor.userId,
      to: { userIds: [task.assignedTo] },
    })
  }

  async function create(req, body, actor) {
    const related = await resolveRelated(req, body)
    await assertAssignee(req.project.id, body.assignedTo, related.buildingId)
    const task = await Task.create({
      title: body.title,
      relatedObjectType: body.relatedObjectType ?? null,
      relatedObjectId: related.relatedObjectId,
      relatedLabel: related.label,
      buildingId: related.buildingId,
      phaseKey: related.phaseKey ?? body.phaseKey ?? null,
      assignedTo: body.assignedTo,
      assignedBy: actor.userId,
      deadline: body.deadline ? new Date(`${body.deadline}T00:00:00.000Z`) : null,
      notes: body.notes ?? null,
      resourceTask: body.resourceTask ?? null,
    })
    await audit(req, actor, 'task.created', task, { comment: task.title })
    await notifyAssigned(req, task, actor)
    return task
  }

  return {
    // Who a task can be assigned to: active project members whose scope
    // covers the building (or every member, for a project-wide task).
    async assignees(req, { buildingId = null } = {}) {
      const building = buildingId ? await requireBuilding(req, buildingId) : null
      const rows = await Membership.find({ level: 'project', projectId: oid(req.project.id), active: true }).lean()
      const users = new Map((await User.find({ _id: { $in: rows.map((m) => m.userId) } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u]))
      const out = new Map()
      for (const m of rows) {
        if (building && !scopeCoversBuilding(m.scopes ?? [], building)) continue
        const u = users.get(String(m.userId))
        if (!u) continue
        const entry = out.get(String(m.userId)) ?? { userId: String(m.userId), name: u.name || u.email, email: u.email, roles: [] }
        entry.roles.push(m.role)
        out.set(String(m.userId), entry)
      }
      return { assignees: [...out.values()].sort((a, b) => a.name.localeCompare(b.name)) }
    },

    async list(req, query) {
      const { roles } = await callerAccess(req)
      const filter = {}
      if (query.status) filter.status = query.status
      if (query.assignedTo) filter.assignedTo = oid(query.assignedTo === 'me' ? req.user._id : query.assignedTo)
      if (query.buildingId) filter.buildingId = oid((await requireBuilding(req, query.buildingId)).id)
      if (query.relatedObjectType) filter.relatedObjectType = query.relatedObjectType
      if (query.relatedObjectId) filter.relatedObjectId = String(query.relatedObjectId)
      const scope = await projectScope(req)
      const now = new Date()
      let rows = (await Task.find(filter).sort({ deadline: 1, createdAt: -1 }).lean()).filter((t) => !t.buildingId || scope.coversBuilding(t.buildingId))
      if (query.overdue) rows = rows.filter((t) => isOverdue(t, now))
      const names = await namesOf(rows.flatMap((t) => [t.assignedTo, t.assignedBy]))
      return { tasks: rows.map((t) => toTask(t, names, now)), canAssign: roles.some((r) => ['pm', 'architect'].includes(r)) }
    },

    async create(req, body, actor) {
      const task = await create(req, body, actor)
      return { task: toTask(task.toObject(), await namesOf([task.assignedTo, task.assignedBy])) }
    },

    // Bill of Resources → tasks (brief §5.5): one task per room and task kind,
    // assigned to one person. A kind already turned into a task for that room
    // (and not complete) is skipped.
    async fromResources(req, body, actor) {
      const building = await requireBuilding(req, body.buildingId)
      const design = await lld.designData(req, building.id)
      const settings = await projectSettings()
      const estimate = resourceEstimateOf(design, settings.resourceMinutes)
      const rooms = await Room.find({ buildingId: building.id }).lean()
      const created = []
      const skipped = []
      for (const [roomCode, tasks] of Object.entries(estimate.byRoom)) {
        if (body.roomCodes?.length && !body.roomCodes.includes(roomCode)) continue
        const room = rooms.find((r) => r.code === roomCode)
        for (const [taskId, count] of Object.entries(tasks)) {
          if (!count || (body.taskIds?.length && !body.taskIds.includes(taskId))) continue
          const def = RESOURCE_TASKS.find((t) => t.id === taskId)
          const minutes = settings.resourceMinutes[taskId] ?? def?.defaultMinutes ?? 0
          const exists = await Task.exists({ resourceTask: taskId, buildingId: oid(building.id), ...(room ? { relatedObjectType: 'room', relatedObjectId: String(room._id) } : { relatedObjectType: 'building' }), status: { $ne: 'complete' } })
          if (exists) {
            skipped.push(`${def?.label ?? taskId} — ${roomCode}`)
            continue
          }
          const task = await create(
            req,
            {
              title: `${def?.label ?? taskId} × ${count} — ${roomCode}`,
              relatedObjectType: room ? 'room' : 'building',
              relatedObjectId: room ? String(room._id) : building.id,
              assignedTo: body.assignedTo,
              deadline: body.deadline ?? null,
              notes: `Bill of Resources: ${count} × ${minutes} min = ${Math.round((count * minutes) / 6) / 10} h`,
              resourceTask: taskId,
            },
            actor
          )
          created.push(task)
        }
      }
      if (!created.length && !skipped.length) throw conflict('nothing_to_create', 'The Bill of Resources has no tasks for that selection')
      const names = await namesOf(created.flatMap((t) => [t.assignedTo, t.assignedBy]))
      return { tasks: created.map((t) => toTask(t.toObject(), names)), skipped }
    },

    async update(req, taskId, body, actor) {
      const task = await load(req, taskId)
      const { roles } = await callerAccess(req)
      const isPm = roles.includes('pm')
      const isAssigner = String(task.assignedBy) === String(actor.userId)
      const before = { title: task.title, notes: task.notes, deadline: task.deadline ? task.deadline.toISOString().slice(0, 10) : null, assignedTo: id(task.assignedTo), status: task.status }
      const editsDetails = ['title', 'notes', 'deadline', 'assignedTo'].some((f) => body[f] !== undefined)
      if (editsDetails && !isPm && !isAssigner) throw forbidden('Only whoever assigned the task or a PM changes it')
      if (body.assignedTo !== undefined && String(body.assignedTo) !== String(task.assignedTo)) {
        await assertAssignee(req.project.id, body.assignedTo, task.buildingId)
        task.assignedTo = body.assignedTo
        task.dueSoonNotifiedAt = null
        task.overdueNotifiedAt = null
      }
      if (body.title !== undefined) task.title = body.title
      if (body.notes !== undefined) task.notes = body.notes
      if (body.deadline !== undefined) {
        task.deadline = body.deadline ? new Date(`${body.deadline}T00:00:00.000Z`) : null
        task.dueSoonNotifiedAt = null
        task.overdueNotifiedAt = null
      }
      if (body.status !== undefined) {
        const problem = taskTransitionProblem({ from: task.status, to: body.status, actorId: actor.userId, assignedTo: task.assignedTo, assignedBy: task.assignedBy, isPm })
        if (problem) throw /^Only/.test(problem) ? forbidden(problem) : badRequest(problem)
        task.status = body.status
        task.completedAt = body.status === 'complete' ? new Date() : null
      }
      task.updatedAt = new Date()
      await task.save()
      const after = { title: task.title, notes: task.notes, deadline: task.deadline ? task.deadline.toISOString().slice(0, 10) : null, assignedTo: id(task.assignedTo), status: task.status }
      const changes = diffChanges({ objectType: 'Task', objectId: task._id, before, after, fields: ['title', 'notes', 'deadline', 'assignedTo', 'status'] })
      if (changes.length) await audit(req, actor, body.status === 'complete' && before.status !== 'complete' ? 'task.completed' : 'task.updated', task, { changes })
      if (before.assignedTo !== after.assignedTo) await notifyAssigned(req, task, actor)
      return { task: toTask(task.toObject(), await namesOf([task.assignedTo, task.assignedBy])) }
    },

    async remove(req, taskId, actor) {
      const task = await load(req, taskId)
      const { roles } = await callerAccess(req)
      if (!roles.includes('pm') && String(task.assignedBy) !== String(actor.userId)) throw forbidden('Only whoever assigned the task or a PM deletes it')
      await Task.deleteOne({ _id: task._id })
      await audit(req, actor, 'task.deleted', task, { comment: task.title })
      return { deleted: String(task._id) }
    },

    // "My tasks": the caller's tasks in every project of the organisation
    // they are a member of (each read in that project's scope).
    async mine(req, query = {}) {
      const memberships = (await membershipsForUser(req.user._id)).filter((m) => m.active !== false && m.level === 'project' && String(m.organisationId) === String(req.org.id))
      const projectIds = [...new Set(memberships.map((m) => String(m.projectId)))]
      const now = new Date()
      const out = []
      for (const projectId of projectIds) {
        await runWithScope({ organisationId: req.org.id, projectId }, async () => {
          const project = await Project.findById(projectId, { name: 1, code: 1 }).lean()
          if (!project) return
          const filter = { assignedTo: oid(req.user._id) }
          if (query.status) filter.status = query.status
          else if (!query.includeComplete) filter.status = { $ne: 'complete' }
          const rows = await Task.find(filter).lean()
          const names = await namesOf(rows.flatMap((t) => [t.assignedTo, t.assignedBy]))
          for (const t of rows) out.push({ ...toTask(t, names, now), projectName: project.name, projectCode: project.code ?? null })
        })
      }
      out.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || String(b.createdAt).localeCompare(String(a.createdAt)))
      return { tasks: out }
    },
  }
}
