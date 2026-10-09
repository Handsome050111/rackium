import mongoose from 'mongoose'
import {
  getTabDefinition,
  toComponentSections,
  recordCompleteness,
  validateSurveyOp,
  applySurveyOp,
  statusAfterEdit,
  checkTransition,
  expectedSurveyTabs,
  computeSurveyPhaseStatus,
  isFileField,
  SURVEY_TEMPLATE_VERSION,
} from '@rackium/shared/surveyForm.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { SurveyCustomField } from '../models/surveyCustomField.js'
import { DesignFlag } from '../models/designFlag.js'
import { ProcessedOp } from '../models/processedOp.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Device } from '../models/device.js'
import { File } from '../models/file.js'
import { User } from '../models/user.js'
import { SerialRegistry } from '../models/serialRegistry.js'
import { registerDeleteGuard } from '../hierarchy/service.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { buildingsWithSal } from '../hierarchy/lookup.js'

// A room with survey records cannot be deleted.
registerDeleteGuard('room', { model: SurveyTabRecord, field: 'roomId' })

const oid = (v) => new mongoose.Types.ObjectId(String(v))

// --- Where a tab lives, and its calculated context ---------------------------

async function resolveTarget(req, { buildingId, roomId, tab }, session = null) {
  const tabDef = getTabDefinition(tab)
  if (!tabDef) throw notFound('No such survey tab')
  const building = await requireBuilding(req, buildingId, session)
  let room = null
  if (tabDef.scope === 'room') {
    if (!roomId) throw badRequest(`${tab} is filled per room — choose a room`)
    room = mongoose.isValidObjectId(roomId) ? await Room.findOne({ _id: roomId, buildingId: building.id }).session(session).lean() : null
    if (!room) throw notFound('Room not found in this building')
  } else if (roomId) {
    throw badRequest(`${tab} is filled once per building, not per room`)
  }
  return { tabDef, building, room }
}

// Calculated values (shared/surveyForm.js): building and room identity, the
// room's racks (Rack Layout), and rack stats (Comms Rooms Summary).
async function calculationContext(building, room, session = null) {
  const ctx = { buildingName: building.name, buildingCode: building.code }
  if (!room) return { ctx, rackList: [], rackStatsByCode: {} }
  const floor = await Floor.findById(room.floorId).session(session).lean()
  Object.assign(ctx, { floorName: floor?.name ?? null, roomCode: room.code })
  const racks = await Rack.find({ roomId: room._id }).sort({ code: 1 }).session(session).lean()
  const devices = await Device.find({ rackId: { $in: racks.map((r) => r._id) }, mounting: 'rack' }).session(session).lean()
  const rackStatsByCode = {}
  for (const r of racks) {
    const used = devices.filter((d) => String(d.rackId) === String(r._id)).reduce((sum, d) => sum + (d.heightU ?? 0), 0)
    rackStatsByCode[r.code.toUpperCase()] = {
      totalRU: r.heightU,
      usedRU: used,
      freeRU: Math.max(0, r.heightU - used),
      pduAFree: r.mountingPower?.pduA?.freeSockets ?? null,
      pduBFree: r.mountingPower?.pduB?.freeSockets ?? null,
    }
  }
  return { ctx, rackList: racks.map((r, i) => ({ id: String(r._id), code: r.code, heightU: r.heightU, rackPosition: i + 1 })), rackStatsByCode }
}

async function customFieldsFor(tab) {
  const rows = await SurveyCustomField.find({ tab }).sort({ createdAt: 1 }).lean()
  return rows.map((f) => ({ key: f.key, label: f.label, type: f.type, requirement: 'unspecified', custom: true }))
}

function referencedFileIds(record) {
  const ids = []
  const collect = (fvs) => fvs?.forEach((fv) => fv.value?.fileIds && ids.push(...fv.value.fileIds))
  for (const s of record?.sections ?? []) {
    collect(s.fieldValues)
    s.rows?.forEach((r) => collect(r.fieldValues))
  }
  return ids
}

// Records are created on first touch (outside the edit transaction, so two
// first edits racing each other just both find it).
async function ensureRecord(building, room, tab) {
  const filter = { buildingId: building.id, roomId: room?._id ?? null, tab }
  const existing = await SurveyTabRecord.findOne(filter)
  if (existing) return existing
  try {
    return await SurveyTabRecord.create({ ...filter, templateVersion: SURVEY_TEMPLATE_VERSION, lastModifiedAt: new Date(0) })
  } catch (err) {
    if (err.code === 11000) return SurveyTabRecord.findOne(filter)
    throw err
  }
}

const stampOut = (s) => (s?.at ? { at: s.at, by: s.by ? String(s.by) : null, reason: s.reason ?? null } : null)

async function recordView(req, target, record) {
  const { tabDef, building, room } = target
  const [calc, customFields] = await Promise.all([calculationContext(building, room), customFieldsFor(tabDef.tab)])
  const files = await File.find({ _id: { $in: referencedFileIds(record) }, deletedAt: null }).lean()
  const fileNames = new Map(files.map((f) => [String(f._id), f.fileName]))
  const sections = toComponentSections(tabDef, record, { ...calc, fileNames, customFields })
  const openFlag = record ? await DesignFlag.exists({ surveyTabRecordId: record._id, resolvedAt: null }) : null
  return {
    recordId: record ? String(record._id) : null,
    buildingId: building.id,
    roomId: room ? String(room._id) : null,
    tab: tabDef.tab,
    scope: tabDef.scope,
    status: record?.status ?? 'draft',
    submitted: stampOut(record?.submitted),
    verified: stampOut(record?.verified),
    rejected: stampOut(record?.rejected),
    imported: stampOut(record?.imported),
    sections,
    completeness: recordCompleteness(tabDef, sections),
    customFields,
    ...calc,
    lastModifiedAt: record && record.lastModifiedAt > new Date(0) ? record.lastModifiedAt : null,
    version: record?.version ?? 0,
    changedAfterImport: Boolean(openFlag),
  }
}

async function namesOf(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const users = await User.find({ _id: { $in: ids } }, { name: 1, email: 1 }).lean()
  return new Map(users.map((u) => [String(u._id), u.name || u.email]))
}

const roleError = (message) => (/^Only (the|a)/.test(message) || /Architects and PMs may only/.test(message) ? forbidden(message) : badRequest(message))

export function createSurveyFormService() {
  // One edit, in its own transaction (DATA-MODEL §5.7). Last save wins: an
  // edit whose base is older than the record's last change is still applied,
  // and the conflict is written to the audit entry and returned so the user
  // sees what they overwrote and who had changed it.
  async function applyEdit(req, input, actor, { source = 'ui', opId = null, queuedAt = null } = {}) {
    const target = await resolveTarget(req, input)
    const { tabDef, building, room } = target
    const { roles } = await callerAccess(req)
    const customFields = await customFieldsFor(tabDef.tab)
    const invalid = validateSurveyOp(tabDef, input.op, { roles, customFields })
    if (invalid) throw roleError(invalid)
    const created = await ensureRecord(building, room, tabDef.tab)
    const { organisationId, projectId } = currentScope()

    return withTransaction(async (session) => {
      const record = await SurveyTabRecord.findById(created._id).session(session)
      const after = statusAfterEdit(record.status)
      if (!after.allowed) throw conflict('tab_submitted', after.message)
      if (!roles.includes('field_engineer') && !['draft', 'rejected'].includes(record.status)) {
        throw conflict('prefill_closed', 'Prefill fields can only be changed before the tab is submitted')
      }
      // Photos and files must already be uploaded to this record.
      const fileIds = input.op.value?.fileIds ?? []
      if (fileIds.length) {
        const found = await File.countDocuments({ _id: { $in: fileIds.map(oid) }, 'attachedTo.type': 'surveyTabRecord', 'attachedTo.id': record._id, deletedAt: null }).session(session)
        if (found !== new Set(fileIds).size) throw badRequest('A photo or file referenced here has not finished uploading')
      }

      const base = input.baseLastModifiedAt ? new Date(input.baseLastModifiedAt) : null

      const at = new Date()
      const applied = applySurveyOp(tabDef, record.sections.map((s) => s.toObject()), input.op, { by: oid(actor.userId), at })
      if (applied.missing) {
        if (source === 'offline_sync') return { outcome: 'skipped', reason: 'The row was removed elsewhere before this edit synced' }
        throw conflict('row_missing', 'That row no longer exists — reload the tab')
      }
      record.sections = applied.sections
      record.status = after.next
      record.hasData = true
      record.lastModifiedAt = at
      record.lastModifiedBy = actor.userId
      record.version += 1
      await record.save({ session })

      // A conflict is a field (or row) this edit touches that someone else
      // changed after the editor's base — the editor's own earlier edits
      // (e.g. the rest of an offline queue) never count. Without a base there
      // is nothing to compare against, so no conflict is reported.
      const overwritten = base ? applied.changes.filter((c) => c.previousAt && new Date(c.previousAt) > base && String(c.previousBy) !== String(actor.userId)) : []
      const names = await namesOf(overwritten.map((c) => c.previousBy))
      const latest = overwritten.reduce((acc, c) => (!acc || new Date(c.previousAt) > new Date(acc.previousAt) ? c : acc), null)
      const conflictReport = latest
        ? {
            changedAt: latest.previousAt,
            changedBy: names.get(String(latest.previousBy)) ?? null,
            fields: overwritten.map((c) => ({ field: c.field, theirValue: c.before, yourValue: c.after, changedBy: names.get(String(c.previousBy)) ?? null, changedAt: c.previousAt })),
          }
        : null
      const auditBase = { organisationId, projectId, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), objectType: 'SurveyTabRecord', objectId: record._id, changeType: 'design_intent', source, session }
      await recordAudit({
        ...auditBase,
        action: 'survey.tab.edited',
        comment: `${tabDef.tab}${room ? ` · ${room.code}` : ''}${conflictReport ? ` · conflict: overwrote a change by ${conflictReport.changedBy ?? 'another user'}` : ''}`,
        changes: applied.changes.map((c) => ({ objectType: 'SurveyTabRecord', objectId: String(record._id), field: c.field, before: c.before, after: c.after })),
        ...(queuedAt ? { offlineQueuedAt: new Date(queuedAt) } : {}),
        ...(conflictReport ? { conflict: true } : {}),
      })
      if (after.reverted) {
        await recordAudit({ ...auditBase, action: 'survey.tab.reverted', comment: `${tabDef.tab}: edited after ${after.flag ? 'import' : 'verification'} — back to Draft` })
        if (after.flag && !(await DesignFlag.exists({ surveyTabRecordId: record._id, resolvedAt: null }).session(session))) {
          await DesignFlag.create([{ buildingId: building.id, kind: 'survey_changed_after_import', surveyTabRecordId: record._id, raisedBy: actor.userId }], { session })
        }
      }
      const outcome = { outcome: conflictReport ? 'conflict' : 'applied', status: record.status, lastModifiedAt: record.lastModifiedAt, version: record.version, reverted: after.reverted, conflict: conflictReport }
      if (opId) await ProcessedOp.create([{ opId, userId: actor.userId, outcome }], { session })
      return outcome
    })
  }

  return {
    applyEdit,

    async get(req, input) {
      const target = await resolveTarget(req, input)
      const record = await SurveyTabRecord.findOne({ buildingId: target.building.id, roomId: target.room?._id ?? null, tab: target.tabDef.tab }).lean()
      return recordView(req, target, record)
    },

    async transition(req, input, actor) {
      const target = await resolveTarget(req, input)
      const { tabDef, building, room } = target
      const { roles } = await callerAccess(req)
      const record = await ensureRecord(building, room, tabDef.tab)
      const view = await recordView(req, target, record.toObject())
      const error = checkTransition(input.action, record.status, { roles, complete: view.completeness.complete, reason: input.reason })
      if (error) throw /^Only the/.test(error) ? forbidden(error) : new AppError(409, 'invalid_transition', error)

      const at = new Date()
      const next = { submit: 'submitted', verify: 'verified', reject: 'rejected' }[input.action]
      const stamp = { at, by: actor.userId, ...(input.action === 'reject' ? { reason: input.reason.trim() } : {}) }
      // Conditional on the version read above: two transitions cannot both win.
      const updated = await SurveyTabRecord.findOneAndUpdate(
        { _id: record._id, version: record.version },
        { $set: { status: next, [next]: stamp, lastModifiedAt: at, lastModifiedBy: actor.userId, hasData: true }, $inc: { version: 1 } },
        { returnDocument: 'after' }
      ).lean()
      if (!updated) throw conflict('changed', 'This tab changed meanwhile — reload and try again')
      await recordAudit({
        organisationId: req.org.id,
        projectId: req.project.id,
        buildingId: building.id,
        phaseKey: 'survey',
        actor: userActor(actor.userId, actor.role),
        action: `survey.tab.${next}`,
        objectType: 'SurveyTabRecord',
        objectId: record._id,
        changeType: 'design_intent',
        source: 'ui',
        comment: `${tabDef.tab}${room ? ` · ${room.code}` : ''}${input.action === 'reject' ? ` — ${input.reason.trim()}` : ''}`,
        changes: [{ objectType: 'SurveyTabRecord', objectId: String(record._id), field: 'status', before: record.status, after: next }],
      })
      return recordView(req, target, updated)
    },

    // The building's tabs into HLD (Architect or PM; every tab Verified or
    // already Imported). M4's HLD import calls this; it also clears the
    // "survey changed after import" flags of the tabs it re-imports.
    async importBuilding(req, buildingId, actor) {
      const building = await requireBuilding(req, buildingId)
      const rooms = await Room.find({ buildingId: building.id }).lean()
      const records = await SurveyTabRecord.find({ buildingId: building.id }).lean()
      const byKey = new Map(records.map((r) => [`${r.tab}|${r.roomId ?? ''}`, r]))
      const missing = expectedSurveyTabs(rooms.map((r) => String(r._id))).filter((e) => !['verified', 'imported'].includes(byKey.get(`${e.tab}|${e.roomId ?? ''}`)?.status))
      if (rooms.length === 0 || missing.length) throw conflict('not_verified', `Every tab must be Verified first (${missing.length} still to verify)`)
      const at = new Date()
      await withTransaction(async (session) => {
        await SurveyTabRecord.updateMany({ buildingId: building.id, status: 'verified' }, { $set: { status: 'imported', imported: { at, by: actor.userId } }, $inc: { version: 1 } }, { session })
        await DesignFlag.updateMany({ buildingId: building.id, resolvedAt: null }, { $set: { resolvedAt: at, resolvedBy: actor.userId } }, { session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.building.imported', objectType: 'Building', objectId: building.id, changeType: 'design_intent', source: 'ui', session })
      })
      return this.progress(req, buildingId)
    },

    async progress(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const rooms = await Room.find({ buildingId: building.id }).sort({ code: 1 }).lean()
      const records = await SurveyTabRecord.find({ buildingId: building.id }).lean()
      const byKey = new Map(records.map((r) => [`${r.tab}|${r.roomId ? String(r.roomId) : ''}`, r]))
      const tabs = expectedSurveyTabs(rooms.map((r) => String(r._id))).map((e) => {
        const r = byKey.get(`${e.tab}|${e.roomId ?? ''}`)
        return { tab: e.tab, roomId: e.roomId, status: r?.status ?? 'draft', hasData: Boolean(r?.hasData), rejectReason: r?.status === 'rejected' ? r.rejected?.reason ?? null : null }
      })
      const verifiedCount = tabs.filter((t) => t.status === 'verified' || t.status === 'imported').length
      const flags = await DesignFlag.countDocuments({ buildingId: building.id, resolvedAt: null })
      return {
        building: { id: building.id, code: building.code, name: building.name },
        rooms: rooms.map((r) => ({ id: String(r._id), code: r.code, floorId: String(r.floorId) })),
        tabs,
        totalCount: tabs.length,
        verifiedCount,
        allVerified: rooms.length > 0 && verifiedCount === tabs.length,
        phaseStatus: computeSurveyPhaseStatus({ roomIds: rooms.map((r) => String(r._id)), records: records.map((r) => ({ tab: r.tab, roomId: r.roomId ? String(r.roomId) : null, status: r.status, hasData: r.hasData })) }),
        openDesignFlags: flags,
      }
    },

    // A serial typed into a survey form, checked against the building's CMO
    // devices and the project's serial registry (as the prototype does).
    async checkSerial(req, buildingId, serial) {
      const building = await requireBuilding(req, buildingId)
      const owner = await SerialRegistry.findOne({ serial: serial.trim() }).collation({ locale: 'en', strength: 2 }).lean()
      if (!owner) return { status: 'not-in-cmo' }
      const device = owner.ownerType === 'device' ? await Device.findById(owner.ownerId, { importBatchId: 1, buildingId: 1 }).lean() : null
      return { status: device?.importBatchId && String(device.buildingId) === building.id ? 'validated' : 'duplicate' }
    },

    async customFields(tab) {
      if (!getTabDefinition(tab)) throw notFound('No such survey tab')
      return customFieldsFor(tab)
    },

    async addCustomField(req, body, actor) {
      if (!getTabDefinition(body.tab)) throw notFound('No such survey tab')
      const key = `custom_${new mongoose.Types.ObjectId().toString()}`
      const field = await SurveyCustomField.create({ tab: body.tab, key, label: body.label, type: body.type, createdBy: actor.userId })
      await recordAudit({ organisationId: req.org.id, actor: userActor(actor.userId, actor.role), action: 'survey.custom_field.created', objectType: 'SurveyCustomField', objectId: field._id, changeType: 'design_intent', source: 'ui', comment: `${body.tab}: ${body.label}` })
      return { key, label: field.label, type: field.type, requirement: 'unspecified', custom: true }
    },

    // Offline replay (DATA-MODEL §5.7): queued edits in queuedAt order, each
    // in its own transaction; already-processed opIds return their original
    // outcome (a retried sync never applies an edit twice).
    async sync(req, edits, actor) {
      const ordered = [...edits].sort((a, b) => new Date(a.queuedAt) - new Date(b.queuedAt))
      const results = []
      for (const edit of ordered) {
        const done = await ProcessedOp.findOne({ opId: edit.opId }).lean()
        if (done) {
          results.push({ opId: edit.opId, ...done.outcome, duplicate: true })
          continue
        }
        try {
          results.push({ opId: edit.opId, ...(await applyEdit(req, edit, actor, { source: 'offline_sync', opId: edit.opId, queuedAt: edit.queuedAt })) })
        } catch (err) {
          const outcome = { outcome: 'rejected', reason: err.message }
          if (err instanceof AppError) await ProcessedOp.create({ opId: edit.opId, userId: actor.userId, outcome }).catch(() => {})
          else throw err
          results.push({ opId: edit.opId, ...outcome })
        }
      }
      return { results }
    },
  }
}

// Survey phase status per building (brief §5.2, M3b), computed, never stored.
export async function surveyStatusByBuilding() {
  const { buildings } = await buildingsWithSal()
  const rooms = await Room.find({}, { buildingId: 1 }).lean()
  const records = await SurveyTabRecord.find({}, { buildingId: 1, roomId: 1, tab: 1, status: 1, hasData: 1 }).lean()
  return new Map(
    buildings.map((b) => [
      b.id,
      computeSurveyPhaseStatus({
        roomIds: rooms.filter((r) => String(r.buildingId) === b.id).map((r) => String(r._id)),
        records: records.filter((r) => String(r.buildingId) === b.id).map((r) => ({ tab: r.tab, roomId: r.roomId ? String(r.roomId) : null, status: r.status, hasData: r.hasData })),
      }),
    ])
  )
}

