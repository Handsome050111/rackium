import mongoose from 'mongoose'
import { Task } from '../models/task.js'
import { Building } from '../models/building.js'
import { Connection } from '../models/connection.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { recordAudit, systemActor } from '../audit/audit.js'
import { notifyQuietly, paths, projectMembers } from '../notifications/notify.js'
import { buildingWithScopeIds } from '../access/scope.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))
// Installed or later: its labels are on site (DATA-MODEL §5.19).
const ON_SITE = ['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance']
const NOTES_MAX = 2000

// The reprint-label task, the closing step of a rename (addendum v2.3 Q5;
// DATA-MODEL §5.19): created in the client approval's transaction when the
// change request renamed devices that are already installed — one per change
// request. `renamed`: [{ deviceId, from, to }] from applyChangeRequest;
// `sentBy`: the PM who sent the change request to the client.
export async function createReprintTask({ organisationId, projectId, building, changeRequest, renamed, sentBy, session }) {
  if (!renamed?.length) return null
  const onSite = new Set((await DeploymentRecord.find({ deviceId: { $in: renamed.map((r) => oid(r.deviceId)) }, status: { $in: ON_SITE } }, { deviceId: 1 }).session(session).lean()).map((r) => String(r.deviceId)))
  const due = renamed.filter((r) => onSite.has(r.deviceId))
  if (!due.length) return null
  if (await Task.exists({ kind: 'reprint_labels', relatedObjectId: String(changeRequest._id) }).session(session)) return null

  // Every link of the frozen LLD with an end or a patch-panel hop on a renamed device.
  const ids = new Set(due.map((r) => r.deviceId))
  const touches = (c) => ids.has(String(c.source.deviceId)) || ids.has(String(c.dest.deviceId)) || (c.hops ?? []).some((h) => ids.has(String(h.patchPanelId)))
  const connections = (await Connection.find({ buildingId: oid(building.id), layer: 'lld' }).session(session).lean()).filter(touches)
  // The cable IDs on site: as recorded at patching, else as designed.
  const records = new Map((await ConnectionRecord.find({ connectionId: { $in: connections.map((c) => c._id) } }).session(session).lean()).map((r) => [String(r.connectionId), r]))
  const cableIds = connections.flatMap((c) => {
    const installed = (records.get(String(c._id))?.installed?.segments ?? []).map((s) => s.cableId).filter(Boolean)
    return installed.length ? installed : [c.cableId, ...(c.hops ?? []).map((h) => h.segmentCableId)].filter(Boolean)
  })

  const assignedTo = await assigneeFor({ projectId, buildingId: building.id, sentBy, session })
  const notes = [
    `Renamed: ${due.map((r) => `${r.from} → ${r.to}`).join('; ')}.`,
    connections.length ? `Reprint and fix the labels of ${connections.length} connection(s): ${[...new Set(cableIds)].join(', ') || 'no cable IDs yet'}.` : 'No connections run through these devices; reprint the device labels.',
  ].join(' ')
  const [task] = await Task.create(
    [
      {
        title: `Reprint labels — CR-${changeRequest.number}: ${due.length} renamed device(s)`.slice(0, 200),
        kind: 'reprint_labels',
        relatedObjectType: 'change_request',
        relatedObjectId: String(changeRequest._id),
        relatedLabel: `CR-${changeRequest.number} ${changeRequest.title}`,
        buildingId: building.id,
        phaseKey: 'deployment',
        assignedTo,
        assignedBy: sentBy,
        notes: notes.length > NOTES_MAX ? `${notes.slice(0, NOTES_MAX - 1)}…` : notes,
        renames: due,
        connectionIds: connections.map((c) => String(c._id)),
      },
    ],
    { session }
  )
  await recordAudit({ organisationId, projectId, buildingId: building.id, phaseKey: 'deployment', actor: systemActor(), action: 'task.created', objectType: 'Task', objectId: task._id, changeType: 'system', source: 'system', comment: `${task.title} (on the client's approval of CR-${changeRequest.number})`, session })
  return task
}

// The building's primary Field Engineer while an active member whose scope
// covers the building; else the PM who sent the change request.
async function assigneeFor({ projectId, buildingId, sentBy, session }) {
  const building = await Building.findById(buildingId, { primaryFieldEngineerId: 1 }).session(session).lean()
  const scoped = await buildingWithScopeIds(buildingId, session)
  if (building?.primaryFieldEngineerId) {
    const [fe] = await projectMembers({ projectId, roles: ['field_engineer'], userIds: [building.primaryFieldEngineerId], building: scoped, session })
    if (fe) return fe
  }
  return sentBy
}

// After the approval commits: the assignee hears of it like any assigned task.
export async function notifyReprintTask({ organisationId, projectId, task }) {
  if (!task) return
  await notifyQuietly({
    type: 'task_assigned',
    projectId,
    buildingId: task.buildingId,
    title: `Task assigned: ${task.title}`,
    body: task.relatedLabel ?? null,
    relatedObjectType: 'task',
    relatedObjectId: task._id,
    link: paths.tasks(organisationId, projectId, task._id),
    groupLink: paths.tasks(organisationId, projectId),
    // Created by the system on the client's approval: the PM who sent the
    // change request is told too when the task falls to them.
    actorId: null,
    to: { userIds: [task.assignedTo] },
  })
}
