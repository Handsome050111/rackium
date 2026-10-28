import mongoose from 'mongoose'
import { isCmdbRecord, lifecycleSummary, matchLifecycleRows, cableMatrix, reconcile, LIFECYCLE_FIELDS, PROVENANCE_LABEL } from '@rackium/shared/cmdb.js'
import { STATUS_LABELS } from '@rackium/shared/deployment.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { AuditEntry } from '../models/auditEntry.js'
import { User } from '../models/user.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { withTransaction } from '../db/transaction.js'
import { modeOf } from '@rackium/shared/modeState.js'
import { modeLabelsOf } from '../hld/cmoDecisions.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const EDITORS = ['pm', 'architect']
const CHANGE_LOG_LIMIT = 300

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

// The CMDB (brief v2.3 §5.8; client audit 9.1, 9.2; M6a): the as-built
// record, built only from devices accepted in deployment and the accepted
// connections between them — never from design data. Each field says where
// its value came from (design, deployment, manual edit, import). An
// Architect or PM makes operational edits (audited as operational changes);
// everyone else in scope reads.
export function createCmdbService({ deployment }) {
  const audit = (req, building, actor, action, extra) => recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'cmdb', actor: userActor(actor.userId, actor.role), action, source: 'ui', changeType: 'operational_change', ...extra })

  // The as-built records of one building, from the deployment calculation.
  async function build(req, building) {
    const ctx = await deployment.load(req, building)
    if (!ctx.started) return { ctx, records: [], connections: [] }
    const designFrozenAt = ctx.data.lld.frozenAt ?? null
    const records = ctx.devices.filter((d) => isCmdbRecord(d))
    const recordIds = new Set(records.map((d) => d.id))
    // A connection belongs to the as-built record once accepted; both ends
    // must be CMDB records or surveyed gear (which is outside the CMDB).
    const connections = ctx.connections.filter((c) => c.status === 'accepted' && [c.view.source.deviceId, c.view.dest.deviceId].every((x) => recordIds.has(x) || !ctx.deviceById.has(x)))
    return { ctx, records, connections, designFrozenAt }
  }

  function recordView(ctx, d, designFrozenAt, names, today, labels) {
    const rec = d.rec
    const inst = rec.installation ?? {}
    const rack = inst.rackId ? ctx.rackOf.get(String(inst.rackId)) : null
    const prov = rec.provenance instanceof Map ? Object.fromEntries(rec.provenance) : rec.provenance ?? {}
    const design = { source: 'design', label: PROVENANCE_LABEL.design, setBy: null, setAt: designFrozenAt }
    const p = (field) => {
      const e = prov[field]
      return e ? { source: e.source, label: PROVENANCE_LABEL[e.source], setBy: e.setByName ?? null, setAt: e.setAt, importBatchId: id(e.importBatchId) } : null
    }
    const lifecycle = rec.lifecycle ?? {}
    const item = d.item
    return {
      id: d.id,
      hostname: d.hostname,
      label: d.label,
      name: d.name,
      // The name before a change request renamed it (DATA-MODEL §5.19).
      legacyHostname: d.legacyHostname ?? null,
      // Mode state (DATA-MODEL §5.22): Rackium's value, and the project's word for it.
      modeState: modeOf(d.view),
      modeLabel: labels[modeOf(d.view)],
      role: d.role,
      roleLabel: d.roleLabel,
      category: d.category,
      model: d.model,
      vendor: item?.vendor ?? null,
      isPanel: d.isPanel,
      passive: d.passive,
      serial: inst.serial ?? null,
      mac: inst.mac ?? null,
      assetTag: rec.assetTag ?? null,
      notes: rec.notes ?? null,
      status: d.status,
      statusLabel: STATUS_LABELS[d.status],
      roomId: id(rack?.roomId) ?? d.roomId,
      roomCode: ctx.roomOf.get(String(rack?.roomId ?? d.roomId))?.code ?? d.roomCode,
      rackId: id(inst.rackId) ?? d.rackId,
      rackCode: rack?.code ?? d.rackCode,
      ru: inst.ru ?? d.ru,
      face: inst.face ?? d.face,
      heightU: d.heightU,
      pduOutlet: inst.pduOutlet ?? null,
      technician: inst.technicianName ?? null,
      installedAt: inst.installedAt ?? null,
      acceptedAt: rec.acceptedAt ?? null,
      acceptedBy: names.get(String(rec.acceptedBy)) ?? null,
      lifecycle: {
        warrantyStart: lifecycle.warrantyStart ?? null,
        warrantyEnd: lifecycle.warrantyEnd ?? null,
        refreshDate: lifecycle.refreshDate ?? null,
        eosDate: item?.eosDate ?? null,
        eolDate: item?.eolDate ?? null,
        ...{ state: lifecycleSummary({ warrantyEnd: lifecycle.warrantyEnd, refreshDate: lifecycle.refreshDate, eosDate: item?.eosDate, eolDate: item?.eolDate }, today) },
      },
      dguv: d.obligation?.exempt ? { status: 'exempt', label: 'Exempt', exemptReason: rec.dguvOverride?.reason ?? null } : d.dguv ? { ...d.dguv, lastInspectionDate: rec.dguv?.lastInspectionDate ?? null, inspector: rec.dguv?.inspector ?? null } : null,
      ports: (d.view.ports ?? []).map((pt) => ({ id: pt.id, type: pt.type, role: pt.role })),
      provenance: {
        hostname: design,
        model: design,
        role: design,
        serial: p('installation_serial'),
        mac: p('installation_mac'),
        location: p('installation_rackId') ?? p('installation_ru') ?? p('installation_face') ?? design,
        pduOutlet: p('installation_pduOutlet'),
        dguv: p('dguv_lastInspectionDate'),
        assetTag: p('assetTag'),
        notes: p('notes'),
        status: p('status') ?? { source: 'deployment', label: PROVENANCE_LABEL.deployment, setBy: names.get(String(rec.acceptedBy)) ?? null, setAt: rec.acceptedAt },
        warrantyStart: p('lifecycle_warrantyStart'),
        warrantyEnd: p('lifecycle_warrantyEnd'),
        refreshDate: p('lifecycle_refreshDate'),
        eosDate: item?.eosDate ? { source: 'design', label: 'Catalogue', setBy: null, setAt: null } : null,
        eolDate: item?.eolDate ? { source: 'design', label: 'Catalogue', setBy: null, setAt: null } : null,
      },
      version: rec.version,
    }
  }

  // An accepted connection as built: installed ports and cables, the hops in between.
  function connectionView(ctx, c) {
    const v = c.view
    const inst = c.rec?.installed ?? {}
    const seg = (s) => (inst.segments ?? []).find((x) => x.index === s.index)
    return {
      id: c.id,
      media: v.media,
      speed: v.speed,
      status: c.status,
      testResult: c.rec?.test?.result ?? null,
      testedAt: c.rec?.test?.at ?? null,
      source: { deviceId: v.source.deviceId, portId: inst.sourcePort ?? v.source.portId, name: ctx.nameOf(v.source.deviceId) },
      dest: { deviceId: v.dest.deviceId, portId: inst.destPort ?? v.dest.portId, name: ctx.nameOf(v.dest.deviceId) },
      hops: v.hops.map((h) => ({ patchPanelId: h.patchPanelId, name: ctx.nameOf(h.patchPanelId), inPort: h.inPort, outPort: h.outPort, inSide: h.inSide, outSide: h.outSide, rackId: h.rackId, ru: h.ru })),
      segments: v.segments.map((s) => ({ index: s.index, kind: s.kind, from: s.from, to: s.to, cableId: seg(s)?.cableId ?? s.cableId, installedM: seg(s)?.installedM ?? null, effectiveM: s.effectiveM })),
    }
  }

  async function requireEditor(req) {
    const { roles } = await callerAccess(req)
    if (!EDITORS.some((r) => roles.includes(r))) throw forbidden('Only an Architect or PM edits the CMDB')
  }

  async function changeLog(req, building, records, connections, retiredIds = []) {
    const ids = [...records.map((r) => r.id), ...connections.map((c) => c.id), ...retiredIds]
    if (!ids.length) return []
    const entries = await AuditEntry.find({ buildingId: oid(building.id), phaseKey: { $in: ['deployment', 'cmdb'] }, $or: [{ objectId: { $in: ids } }, { 'changes.objectId': { $in: ids } }] }).sort({ occurredAt: -1 }).limit(CHANGE_LOG_LIMIT).lean()
    const names = await namesOf(entries.map((e) => e.actor?.userId))
    return entries.map((e) => ({
      id: String(e._id),
      occurredAt: e.occurredAt,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      changeType: e.changeType,
      actor: names.get(String(e.actor?.userId)) ?? (e.actor?.type === 'system' ? 'System' : null),
      role: e.actor?.role ?? null,
      comment: e.comment ?? null,
      changes: (e.changes ?? []).map((ch) => ({ field: ch.field, before: ch.before ?? null, after: ch.after ?? null })),
    }))
  }

  return {
    async view(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const { roles } = await callerAccess(req)
      const { ctx, records, connections, designFrozenAt } = await build(req, building)
      const base = { building: { id: building.id, code: building.code, name: building.name }, canEdit: EDITORS.some((r) => roles.includes(r)) }
      if (!ctx.started) return { ...base, started: false, records: [], connections: [], cableMatrix: [], racks: [], reconciliation: null, changeLog: [] }
      const names = await namesOf(records.map((d) => d.rec?.acceptedBy))
      const [retired, retiredConns] = await Promise.all([DeploymentRecord.find({ buildingId: building.id, status: 'retired' }).sort({ 'retired.at': -1 }).lean(), ConnectionRecord.find({ buildingId: building.id, status: 'retired' }, { connectionId: 1 }).lean()])
      const labels = await modeLabelsOf()
      const rows = records.map((d) => recordView(ctx, d, designFrozenAt, names, ctx.today, labels))
      const conns = connections.map((c) => connectionView(ctx, c))
      const nameOf = (devId) => ctx.nameOf(devId)
      const asBuiltSegments = ctx.connections.map((c) => ({ id: c.id, segments: (c.rec?.installed?.segments ?? []).map((s) => ({ cableId: s.cableId })) }))
      const rackIds = new Set(rows.map((r) => r.rackId).filter(Boolean))
      return {
        ...base,
        started: true,
        today: ctx.today,
        modeLabels: labels,
        records: rows,
        connections: conns,
        cableMatrix: cableMatrix(conns, nameOf),
        floors: ctx.data.floors.map((f) => ({ id: String(f._id), name: f.name ?? f.token, order: f.order ?? 0 })),
        rooms: ctx.data.rooms.map((r) => ({ id: String(r._id), code: r.code, floorId: id(r.floorId) })),
        // Surveyed gear an as-built link ends on (outside the CMDB, shown for context).
        existingDevices: ctx.data.views.filter((v) => v.origin === 'existing' && conns.some((c) => c.source.deviceId === v.id || c.dest.deviceId === v.id)).map((v) => ({ id: v.id, label: v.label, hostname: v.hostname, model: v.model, role: v.role, roomId: v.roomId, rackId: v.rackId, ru: v.ru, heightU: v.heightU, modeState: modeOf(v), modeLabel: labels[modeOf(v)] })),
        // Patch panels on the as-built routes, placed in their racks (port trace).
        panels: ctx.devices.filter((d) => d.isPanel && conns.some((c) => c.hops.some((h) => h.patchPanelId === d.id))).map((d) => ({ id: d.id, label: d.label, rackId: id(d.rec?.installation?.rackId) ?? d.rackId, ru: d.rec?.installation?.ru ?? d.ru, heightU: d.heightU ?? 1 })),
        racks: ctx.data.racks.filter((r) => rackIds.has(String(r._id)) || conns.some((c) => c.hops.some((h) => h.rackId === String(r._id)))).map((r) => ({ id: String(r._id), code: r.code, roomId: String(r.roomId), roomCode: ctx.roomOf.get(String(r.roomId))?.code ?? null, heightU: r.heightU ?? 42 })),
        // Kit removed after cutover (DATA-MODEL §5.22) is not counted against the design.
        reconciliation: reconcile({
          designDevices: ctx.devices.filter((d) => d.status !== 'retired'),
          devices: ctx.devices.filter((d) => d.status !== 'retired').map((d) => ({ id: d.id, hostname: d.hostname ?? d.label, status: d.status, serial: d.serialised ? d.rec?.installation?.serial ?? null : 'n/a' })),
          connections: asBuiltSegments,
          openExceptions: ctx.exceptions.filter((e) => e.status === 'open').length,
        }),
        // Records a change request retired (their device left the design): listed, and in the change log.
        retiredRecords: retired.map((r) => ({ id: String(r.deviceId), label: r.retired?.label ?? null, at: r.retired?.at ?? null, reason: r.retired?.reason ?? null, previousStatus: r.retired?.previousStatus ?? null, serial: r.retired?.serial ?? null, mac: r.retired?.mac ?? null, cutover: Boolean(r.retired?.cutover), by: r.retired?.byName ?? null })),
        changeLog: await changeLog(req, building, rows, conns, [...retired.map((r) => String(r.deviceId)), ...retiredConns.map((r) => String(r.connectionId))]),
      }
    },

    // An operational edit by an Architect or PM: asset tag, notes, status
    // (in service / maintenance) and lifecycle dates. Optimistic `version`.
    async operationalEdit(req, deviceId, body, actor) {
      await requireEditor(req)
      const rec = mongoose.isValidObjectId(deviceId) ? await DeploymentRecord.findOne({ deviceId: oid(deviceId) }).lean() : null
      if (!rec) throw notFound('CMDB record not found')
      const building = await requireBuilding(req, rec.buildingId)
      if (!isCmdbRecord(rec)) throw conflict('not_in_cmdb', 'Only accepted devices are in the CMDB')
      const set = {}
      const changes = []
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const now = new Date()
      const put = (path, value, provKey) => {
        const before = path.split('.').reduce((o, k) => o?.[k], rec) ?? null
        if (String(before ?? '') === String(value ?? '')) return
        set[path] = value
        set[`provenance.${provKey}`] = { source: 'manual', setBy: actor.userId, setByName: actorName, setAt: now, importBatchId: null }
        changes.push({ objectType: 'Device', objectId: String(rec.deviceId), field: path, before, after: value })
      }
      if (body.assetTag !== undefined) put('assetTag', body.assetTag || null, 'assetTag')
      if (body.notes !== undefined) put('notes', body.notes || null, 'notes')
      if (body.status !== undefined) put('status', body.status, 'status')
      for (const f of LIFECYCLE_FIELDS) if (body[f] !== undefined) put(`lifecycle.${f}`, body[f], `lifecycle_${f}`)
      const ws = set['lifecycle.warrantyStart'] !== undefined ? set['lifecycle.warrantyStart'] : rec.lifecycle?.warrantyStart
      const we = set['lifecycle.warrantyEnd'] !== undefined ? set['lifecycle.warrantyEnd'] : rec.lifecycle?.warrantyEnd
      if (ws && we && we < ws) throw badRequest('Warranty end is before warranty start')
      if (!changes.length) return { changed: 0, version: rec.version }
      return withTransaction(async (session) => {
        const saved = await DeploymentRecord.findOneAndUpdate({ _id: rec._id, version: body.version }, { $set: { ...set, updatedAt: now }, ...(body.status && body.status !== rec.status ? { $push: { history: { status: body.status, by: actor.userId, byName: actorName, at: now, note: 'Operational change' } } } : {}), $inc: { version: 1 } }, { session, returnDocument: 'after' }).lean()
        if (!saved) throw new AppError(409, 'stale_record', 'This record was changed since you loaded it. Reload, then make your change again.')
        await audit(req, building, actor, 'cmdb.record.updated', { objectType: 'Device', objectId: String(rec.deviceId), comment: 'Operational change', changes, session })
        return { changed: changes.length, version: saved.version }
      })
    },

    // Warranty and refresh dates from a sheet: rows matched by serial, then
    // hostname. `apply: false` previews; applying writes the matched rows
    // (provenance "import", one batch id) and reports the rest.
    async importLifecycle(req, body, actor) {
      await requireEditor(req)
      const building = await requireBuilding(req, body.buildingId)
      const { records } = await build(req, building)
      const devices = records.map((d) => ({ id: d.id, serial: d.rec?.installation?.serial ?? null, hostname: d.hostname }))
      const rows = matchLifecycleRows(body.rows, devices)
      const ok = rows.filter((r) => !r.problems.length)
      // One device on several rows: fine unless two rows give one field different dates.
      const seen = new Map()
      for (const r of ok) {
        const prev = seen.get(r.deviceId) ?? {}
        for (const [f, v] of Object.entries(r.values)) {
          if (prev[f] && prev[f].value !== v) r.problems.push(`Row ${prev[f].row} gives this device another ${f}`)
          else prev[f] = { value: v, row: r.row }
        }
        seen.set(r.deviceId, prev)
      }
      const valid = rows.filter((r) => !r.problems.length)
      const nameOf = new Map(records.map((d) => [d.id, d.hostname ?? d.label]))
      const preview = rows.map((r) => ({ ...r, device: r.deviceId ? nameOf.get(r.deviceId) : null }))
      if (!body.apply) return { rows: preview, matched: valid.length, problems: rows.length - valid.length, applied: 0 }
      if (!valid.length) throw badRequest('No row can be imported — fix the problems listed and try again')
      const batchId = new mongoose.Types.ObjectId()
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const now = new Date()
      await withTransaction(async (session) => {
        const changes = []
        for (const r of valid) {
          const set = { updatedAt: now }
          for (const [f, v] of Object.entries(r.values)) {
            set[`lifecycle.${f}`] = v
            set[`provenance.lifecycle_${f}`] = { source: 'import', setBy: actor.userId, setByName: actorName, setAt: now, importBatchId: batchId }
            changes.push({ objectType: 'Device', objectId: r.deviceId, field: `lifecycle.${f}`, before: null, after: v })
          }
          await DeploymentRecord.updateOne({ deviceId: oid(r.deviceId) }, { $set: set, $inc: { version: 1 } }, { session })
        }
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'cmdb', actor: userActor(actor.userId, actor.role), action: 'cmdb.lifecycle.imported', objectType: 'ImportBatch', objectId: String(batchId), changeType: 'import', source: 'import', comment: `${body.fileName}: ${valid.length} device(s) updated`, changes, session })
      })
      return { rows: preview, matched: valid.length, problems: rows.length - valid.length, applied: valid.length, batchId: String(batchId) }
    },
  }
}
