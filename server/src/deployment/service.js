import mongoose from 'mongoose'
import {
  STATUS_LABELS,
  deploymentLabel,
  deviceStepProblem,
  acceptanceBlockers,
  connectionStepProblem,
  installMac,
  macProblem,
  serialProblem,
  deviceDeviations,
  connectionDeviations,
  unhandledDeviations,
  exceptionOutcome,
  LIVE_EXCEPTION,
  dguvStatus,
  isMainsPowered,
  pipelineStats,
  roomChecklists,
  isDelivered,
  cmdbPhaseStatus,
} from '@rackium/shared/deployment.js'
import { procurementLineKeyOf, SERIALISED_CATEGORIES } from '@rackium/shared/bomCalc.js'
import { buildLocationTree } from '@rackium/shared/locationTree.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { Device } from '../models/device.js'
import { Connection } from '../models/connection.js'
import { File } from '../models/file.js'
import { SerialRegistry } from '../models/serialRegistry.js'
import { ProcurementLine } from '../models/procurementLine.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { DeploymentException } from '../models/deploymentException.js'
import { User } from '../models/user.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'
import { withTransaction } from '../db/transaction.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { assertNotHandedOver } from '../handover/guard.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const PASSIVE = ['patch_panel', 'cable_management', 'accessory']
const INSTALLED_PLUS = new Set(['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance'])
const PATCHED = new Set(['installed', 'tested', 'faulty', 'accepted'])

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

// Deployment & Installation (brief v2.3 §5.7, §4.4, §6.9; DATA-MODEL §4.1a–c,
// §4.11, §5.2, §5.3; M6a). The Field Engineer records each designed device's
// installation against the frozen LLD; differences are corrected or logged as
// exceptions a Reviewer or PM accepts; a PM or Reviewer accepts the device.
// As-built facts live in deploymentRecords / connectionRecords (keyed by the
// main LLD's ids, which survive a change request), never on the design.
export function createDeploymentService({ lld }) {
  const audit = (req, building, actor, action, extra) =>
    recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'deployment', actor: userActor(actor.userId, actor.role), action, changeType: 'as_built', source: 'ui', ...extra })
  const link = (req, building) => paths.building(req.org.id, req.project.id, building.id, 'deployment')

  // Everything the deployment of one building is calculated from.
  async function load(req, building, session = null) {
    const data = await lld.deploymentData(req, building.id, { session })
    if (!data.lld) return { started: false, frozen: false }
    const [records, connRecords, exceptions, lines, time] = await Promise.all([
      DeploymentRecord.find({ buildingId: building.id }).session(session).lean(),
      ConnectionRecord.find({ buildingId: building.id }).session(session).lean(),
      DeploymentException.find({ buildingId: building.id }).sort({ loggedAt: -1 }).session(session).lean(),
      ProcurementLine.find({ buildingId: building.id }).session(session).lean(),
      orgTimeSettings(req.org.id, session),
    ])
    const recordOf = new Map(records.map((r) => [String(r.deviceId), r]))
    const connRecordOf = new Map(connRecords.map((r) => [String(r.connectionId), r]))
    const lineOf = new Map(lines.map((l) => [l.lineKey, l]))
    const rackOf = new Map(data.racks.map((r) => [String(r._id), r]))
    const roomOf = new Map(data.rooms.map((r) => [String(r._id), r]))
    const viewOf = new Map(data.views.map((v) => [v.id, v]))
    const today = localDate(new Date(), time.timeZone)
    const frozen = Boolean(data.lld.frozen)

    // The designed devices deployment covers: the main LLD's planned devices
    // that are procured (carrier circuits and remote sites are not installed).
    const devices = []
    for (const v of data.views) {
      if (v.origin !== 'planned') continue
      const item = data.itemOf(v.catalogueKey)
      const lineKey = procurementLineKeyOf(v, item)
      if (!lineKey) continue
      const rec = recordOf.get(v.id) ?? null
      const lineStatus = lineOf.get(lineKey)?.status ?? 'not_ordered'
      const delivered = isDelivered(lineStatus)
      const status = rec && rec.status !== 'draft' ? rec.status : delivered ? 'delivered' : ['ordered', 'shipped'].includes(lineStatus) ? 'ordered' : 'planned'
      const category = item?.category ?? v.category ?? null
      const mainsPowered = isMainsPowered(item)
      const inst = rec?.installation ?? {}
      const installedRack = inst.rackId ? rackOf.get(String(inst.rackId)) : null
      const deviations = rec
        ? deviceDeviations({ rackId: v.rackId, rackCode: v.rackCode, ru: v.ru, face: v.face }, { rackId: id(inst.rackId), rackCode: installedRack?.code ?? null, ru: inst.ru ?? null, face: inst.face ?? null })
        : []
      devices.push({
        view: v,
        item,
        rec,
        id: v.id,
        hostname: v.hostname,
        label: v.label,
        role: v.role,
        roleLabel: v.roleLabel,
        model: v.model,
        category,
        isPanel: v.isPanel,
        passive: v.isPanel || PASSIVE.includes(category),
        serialised: SERIALISED_CATEGORIES.includes(category),
        mainsPowered,
        roomId: v.roomId,
        roomCode: roomOf.get(String(v.roomId))?.code ?? null,
        rackId: v.rackId,
        rackCode: v.rackCode,
        ru: v.ru,
        face: v.face,
        heightU: v.heightU,
        mounting: v.mounting,
        status,
        lineKey,
        lineStatus,
        delivered,
        deviations,
      })
    }
    const deviceById = new Map(devices.map((d) => [d.id, d]))
    const nameOf = (devId) => viewOf.get(String(devId))?.label ?? 'device'

    const connections = data.connections.map((c) => {
      const rec = connRecordOf.get(c.id) ?? null
      const status = rec && rec.status !== 'draft' ? rec.status : frozen ? 'approved' : 'designed'
      const deviations = rec ? connectionDeviations(c, rec.installed ?? {}) : []
      const destRoom = viewOf.get(c.dest.deviceId)?.roomId ?? viewOf.get(c.source.deviceId)?.roomId
      return { view: c, rec, id: c.id, status, deviations, roomCode: roomOf.get(String(destRoom))?.code ?? null }
    })
    const connsOfDevice = (devId) => connections.filter((c) => c.view.source.deviceId === devId || c.view.dest.deviceId === devId)

    // Per device: unhandled deviations (its own and its connections'), open exceptions, DGUV.
    for (const d of devices) {
      const own = unhandledDeviations(d.deviations, exceptions, { deviceId: d.id })
      const viaConns = connsOfDevice(d.id).flatMap((c) => unhandledDeviations(c.deviations, exceptions, { deviceId: d.id, connectionId: c.id }))
      d.openDeviations = own.length + viaConns.length
      const connIds = new Set(connsOfDevice(d.id).map((c) => c.id))
      d.openExceptions = exceptions.filter((e) => e.status === 'open' && (String(e.deviceId) === d.id || (e.connectionId && connIds.has(String(e.connectionId))))).length
      d.dguv = dguvStatus({ lastInspectionDate: d.rec?.dguv?.lastInspectionDate ?? null, mainsPowered: d.mainsPowered }, today, time.dguv)
    }
    return { started: true, frozen, data, devices, deviceById, connections, connsOfDevice, exceptions, nameOf, viewOf, rackOf, roomOf, today, time }
  }

  // The device, checked: a designed device of this building's deployment.
  async function deviceContext(req, deviceId, session = null) {
    const device = mongoose.isValidObjectId(deviceId) ? await Device.findOne({ _id: deviceId, origin: 'planned', layer: 'lld' }).session(session).lean() : null
    if (!device) throw notFound('Device not found')
    const building = await requireBuilding(req, device.buildingId, session)
    const ctx = await load(req, building, session)
    if (!ctx.started) throw conflict('lld_not_started', 'This building has no LLD yet')
    const d = ctx.deviceById.get(String(device._id))
    if (!d) throw notFound('This device is not installed by the project (not procured)')
    return { building, ctx, d }
  }
  async function connectionContext(req, connectionId, session = null) {
    const conn = mongoose.isValidObjectId(connectionId) ? await Connection.findOne({ _id: connectionId, layer: 'lld' }).session(session).lean() : null
    if (!conn) throw notFound('Connection not found')
    const building = await requireBuilding(req, conn.buildingId, session)
    const ctx = await load(req, building, session)
    const c = ctx.connections.find((x) => x.id === String(conn._id))
    if (!c) throw notFound('Connection not found')
    return { building, ctx, c }
  }
  // Deployment records are read-only after the handover is accepted (M6b).
  async function writable(building) {
    await assertNotHandedOver(building.id)
  }
  function requireFrozen(ctx) {
    if (!ctx.frozen) throw conflict('design_not_frozen', 'Deployment starts once the client approves the Solution Package (the LLD is frozen)')
  }
  async function rolesOf(req) {
    return (await callerAccess(req)).roles
  }
  function requireRole(roles, allowed, message) {
    if (!allowed.some((r) => roles.includes(r))) throw forbidden(message)
  }

  // After an installation is saved: exceptions whose deviation is gone are
  // corrected; those describing an older installed value are superseded.
  async function settleExceptions({ deviceId, connectionId = null, deviations }, session) {
    const filter = connectionId ? { connectionId: oid(connectionId) } : { deviceId: oid(deviceId), connectionId: null }
    const live = await DeploymentException.find({ ...filter, status: { $in: [...LIVE_EXCEPTION] } }).session(session).lean()
    for (const e of live) {
      const outcome = exceptionOutcome(e, deviations)
      if (outcome) await DeploymentException.updateOne({ _id: e._id }, { $set: { status: outcome, closedAt: new Date() } }, { session })
    }
  }

  async function recordFor(d, building, session) {
    const existing = await DeploymentRecord.findOne({ deviceId: d.id }).session(session)
    if (existing) return existing
    return new DeploymentRecord({ buildingId: building.id, deviceId: oid(d.id), status: 'draft' })
  }
  const setProvenance = (rec, fields, source, actor, actorName) => {
    for (const f of fields) rec.provenance.set(f, { source, setBy: actor.userId, setByName: actorName, setAt: new Date() })
  }

  function deviceView(ctx, d, names) {
    const rec = d.rec
    const inst = rec?.installation ?? {}
    const installedRack = inst.rackId ? ctx.rackOf.get(String(inst.rackId)) : null
    const conns = ctx.connsOfDevice(d.id)
    const blockers = acceptanceBlockers({ serialised: d.serialised, serial: inst.serial, mainsPowered: d.mainsPowered, dguvRecorded: Boolean(rec?.dguv?.lastInspectionDate), openDeviations: d.openDeviations, openExceptions: d.openExceptions })
    return {
      id: d.id,
      hostname: d.hostname,
      label: d.label,
      role: d.role,
      roleLabel: d.roleLabel,
      model: d.model,
      category: d.category,
      isPanel: d.isPanel,
      passive: d.passive,
      serialised: d.serialised,
      mainsPowered: d.mainsPowered,
      roomId: d.roomId,
      roomCode: d.roomCode,
      rackId: d.rackId,
      rackCode: d.rackCode,
      ru: d.ru,
      face: d.face,
      heightU: d.heightU,
      status: d.status,
      statusLabel: STATUS_LABELS[d.status] ?? d.status,
      deploymentLabel: deploymentLabel(d.status),
      delivery: { lineKey: d.lineKey, status: d.lineStatus, delivered: d.delivered },
      installation: {
        serial: inst.serial ?? null,
        mac: inst.mac ?? null,
        rackId: id(inst.rackId),
        rackCode: installedRack?.code ?? null,
        ru: inst.ru ?? null,
        face: inst.face ?? null,
        pduOutlet: inst.pduOutlet ?? null,
        gps: inst.gps ?? null,
        notes: inst.notes ?? null,
        technician: inst.technicianName ?? null,
        installedAt: inst.installedAt ?? null,
        updatedAt: inst.updatedAt ?? null,
      },
      dguv: d.mainsPowered
        ? {
            lastInspectionDate: rec?.dguv?.lastInspectionDate ?? null,
            inspector: rec?.dguv?.inspector ?? null,
            certificateFileId: id(rec?.dguv?.certificateFileId),
            recordedBy: names.get(String(rec?.dguv?.recordedBy)) ?? null,
            recordedAt: rec?.dguv?.recordedAt ?? null,
            ...d.dguv,
          }
        : null,
      deviations: d.deviations.map((x) => ({ ...x, handled: !unhandledDeviations([x], ctx.exceptions, { deviceId: d.id }).length })),
      openDeviations: d.openDeviations,
      openExceptions: d.openExceptions,
      acceptanceBlockers: blockers,
      connectionIds: conns.map((c) => c.id),
      history: (rec?.history ?? []).map((h) => ({ status: h.status, by: h.byName, at: h.at, note: h.note ?? null })),
      acceptedAt: rec?.acceptedAt ?? null,
      acceptedBy: names.get(String(rec?.acceptedBy)) ?? null,
    }
  }

  function connectionView(ctx, c, names) {
    const v = c.view
    const end = (e) => ({ deviceId: e.deviceId, portId: e.portId, name: ctx.nameOf(e.deviceId), planned: ctx.deviceById.has(e.deviceId) })
    const inst = c.rec?.installed ?? {}
    return {
      id: c.id,
      source: end(v.source),
      dest: end(v.dest),
      media: v.media,
      speed: v.speed,
      sourceSfpCode: v.sourceSfpCode,
      destSfpCode: v.destSfpCode,
      hops: v.hops.map((h) => ({ patchPanelId: h.patchPanelId, name: ctx.nameOf(h.patchPanelId), inPort: h.inPort, outPort: h.outPort, inSide: h.inSide, outSide: h.outSide })),
      segments: v.segments.map((s) => {
        const got = (inst.segments ?? []).find((x) => x.index === s.index)
        return { index: s.index, kind: s.kind, from: { ...s.from, name: ctx.nameOf(s.from.deviceId) }, to: { ...s.to, name: ctx.nameOf(s.to.deviceId) }, cableId: s.cableId, effectiveM: s.effectiveM, installed: got ? { cableId: got.cableId ?? null, installedM: got.installedM ?? null, confirmed: Boolean(got.confirmed) } : null }
      }),
      roomCode: c.roomCode,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      installed: c.rec ? { sourcePort: inst.sourcePort ?? null, destPort: inst.destPort ?? null, media: inst.media ?? null, sourceSfpCode: inst.sourceSfpCode ?? null, destSfpCode: inst.destSfpCode ?? null, by: c.rec.installedByName ?? null, at: c.rec.installedAt ?? null } : null,
      test: c.rec?.test?.result ? { result: c.rec.test.result, note: c.rec.test.note ?? null, by: c.rec.test.byName ?? null, at: c.rec.test.at } : null,
      deviations: c.deviations.map((x) => ({ ...x, handled: !unhandledDeviations([x], ctx.exceptions, { deviceId: null, connectionId: c.id }).length })),
      acceptedAt: c.rec?.acceptedAt ?? null,
      acceptedBy: names.get(String(c.rec?.acceptedBy)) ?? null,
    }
  }

  function exceptionView(ctx, e, names) {
    return {
      id: String(e._id),
      deviceId: String(e.deviceId),
      deviceName: ctx.nameOf(e.deviceId),
      connectionId: id(e.connectionId),
      field: e.field,
      label: e.label,
      designedValue: e.designedValue,
      installedValue: e.installedValue,
      reason: e.reason,
      photoFileIds: (e.photoFileIds ?? []).map(String),
      status: e.status,
      loggedBy: e.loggedByName ?? names.get(String(e.loggedBy)) ?? null,
      loggedAt: e.loggedAt,
      reviewedBy: e.reviewedByName ?? null,
      reviewedAt: e.reviewedAt ?? null,
      reviewNote: e.reviewNote ?? null,
      closedAt: e.closedAt ?? null,
    }
  }

  async function deviceDetail(req, deviceId) {
    const { ctx, d } = await deviceContext(req, deviceId)
    const names = await namesOf([d.rec?.acceptedBy, d.rec?.dguv?.recordedBy])
    return deviceView(ctx, d, names)
  }
  async function connectionDetail(req, connectionId) {
    const { ctx, c } = await connectionContext(req, connectionId)
    return connectionView(ctx, c, await namesOf([c.rec?.acceptedBy]))
  }

  return {
    load,
    deviceDetail,
    connectionDetail,

    // The deployment screen of one building.
    async view(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const roles = await rolesOf(req)
      const ctx = await load(req, building)
      const base = { building: { id: building.id, code: building.code, name: building.name } }
      if (!ctx.started) return { ...base, started: false, frozen: false }
      const names = await namesOf([...ctx.devices.flatMap((d) => [d.rec?.acceptedBy, d.rec?.dguv?.recordedBy]), ...ctx.connections.map((c) => c.rec?.acceptedBy), ...ctx.exceptions.map((e) => e.loggedBy)])
      const devices = ctx.devices.map((d) => deviceView(ctx, d, names))
      const connections = ctx.connections.map((c) => connectionView(ctx, c, names))
      const floors = ctx.data.floors.map((f) => ({ id: String(f._id), name: f.name ?? f.code ?? f.token, order: f.order ?? 0 }))
      const rooms = ctx.data.rooms.map((r) => ({ id: String(r._id), code: r.code, name: r.name ?? r.code, floorId: id(r.floorId) }))
      const racks = ctx.data.racks.map((r) => ({ id: String(r._id), code: r.code, roomId: String(r.roomId), heightU: r.heightU ?? 42 }))
      const roomCodeOf = new Map(rooms.map((r) => [r.id, r.code]))
      return {
        ...base,
        started: true,
        frozen: ctx.frozen,
        today: ctx.today,
        timeZone: ctx.time.timeZone,
        dguvSettings: ctx.time.dguv,
        devices,
        connections,
        exceptions: ctx.exceptions.map((e) => exceptionView(ctx, e, names)),
        existingDevices: ctx.data.views.filter((v) => v.origin === 'existing').map((v) => ({ id: v.id, label: v.label, hostname: v.hostname, model: v.model, role: v.role, roomId: v.roomId, rackId: v.rackId })),
        floors,
        rooms,
        racks,
        tree: buildLocationTree({ building: { id: building.id, name: `${building.code} ${building.name ?? ''}`.trim() }, floors, rooms, racks, devices: devices.map((d) => ({ id: d.id, hostname: d.hostname, label: d.label, roomId: d.roomId, rackId: d.rackId, status: d.status, deliveryReady: d.delivery.delivered })) }),
        pipeline: pipelineStats(devices, connections),
        roomChecklists: roomChecklists({
          devices: ctx.devices.map((d) => ({ roomCode: d.roomCode, role: d.role, passive: d.passive, mainsPowered: d.mainsPowered, dguvRecorded: Boolean(d.rec?.dguv?.lastInspectionDate), rackId: d.rackId, status: d.status })),
          connections: connections.map((c) => ({ roomCode: c.roomCode, media: c.media, status: c.status })),
          racks: racks.map((r) => ({ id: r.id, roomCode: roomCodeOf.get(r.roomId) ?? null })),
        }),
        permissions: {
          install: roles.includes('field_engineer'),
          recordDguv: roles.some((r) => ['field_engineer', 'pm'].includes(r)),
          accept: roles.some((r) => ['pm', 'reviewer'].includes(r)),
          reviewExceptions: roles.some((r) => ['pm', 'reviewer'].includes(r)),
        },
      }
    },

    // The Field Engineer's installation record (serial, MAC, placement, PDU
    // outlet, GPS, notes); `markInstalled` moves a delivered device to Installed.
    async saveInstallation(req, deviceId, body, actor) {
      const roles = await rolesOf(req)
      requireRole(roles, ['field_engineer'], 'Only the Field Engineer records installations')
      const { building, ctx, d } = await deviceContext(req, deviceId)
      await writable(building)
      requireFrozen(ctx)
      if (!d.delivered && !INSTALLED_PLUS.has(d.status)) throw conflict('awaiting_delivery', `Awaiting delivery — ${d.label} can be installed once its procurement line is Delivered`)
      if (['accepted', 'in_service', 'maintenance'].includes(d.status)) throw conflict('accepted', 'This device is accepted — changes are operational edits in the CMDB')
      // Validate before the transaction (clear messages); the indexes guard races.
      let mac
      if (body.mac !== undefined) {
        const problem = macProblem(body.mac)
        if (problem) throw badRequest(problem)
        mac = installMac(body.mac)
        if (mac) {
          const cmo = await Device.findOne({ 'installation.mac': mac, _id: { $ne: oid(d.id) } }, { hostname: 1, origin: 1 }).lean()
          if (cmo) throw conflict('mac_in_use', `MAC ${mac} belongs to ${cmo.origin === 'existing' ? 'the CMO-imported device ' : ''}${cmo.hostname ?? 'another device'}`)
          const other = await DeploymentRecord.findOne({ 'installation.mac': mac, deviceId: { $ne: oid(d.id) } }, { deviceId: 1 }).lean()
          if (other) throw conflict('mac_in_use', `MAC ${mac} is already recorded on ${ctx.nameOf(other.deviceId)}`)
        }
      }
      let serial
      if (body.serial !== undefined) {
        serial = body.serial ? body.serial.trim() : null
        if (serial) {
          const held = await SerialRegistry.findOne({ serial, ownerId: { $ne: oid(d.id) } }).collation({ locale: 'en', strength: 2 }).lean()
          let holder = null
          if (held) {
            const owner = await Device.findById(held.ownerId, { hostname: 1, label: 1, origin: 1 }).lean()
            holder = { kind: owner?.origin === 'existing' ? 'cmo' : 'device', name: owner?.hostname ?? owner?.label ?? 'another device' }
          }
          const problem = serialProblem(serial, holder)
          if (problem) throw holder ? conflict('serial_in_use', problem) : badRequest(problem)
        }
      }
      if (body.rackId) {
        const rack = ctx.rackOf.get(String(body.rackId))
        if (!rack) throw badRequest('That rack is not in this building')
        if (body.ru != null && body.ru + (d.heightU ?? 1) - 1 > (rack.heightU ?? 42)) throw badRequest(`RU ${body.ru} does not fit a ${d.heightU ?? 1}U device in the ${rack.heightU}U rack ${rack.code}`)
      }
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const result = await withTransaction(async (session) => {
        const rec = await recordFor(d, building, session)
        const before = { ...(rec.installation?.toObject?.() ?? {}) }
        const changed = []
        const setField = (field, value) => {
          if (value === undefined) return
          const prev = rec.installation?.[field] ?? null
          if (String(prev ?? '') === String(value ?? '')) return
          rec.set(`installation.${field}`, value)
          changed.push(field)
        }
        setField('serial', serial)
        setField('mac', mac)
        if (body.rackId !== undefined) setField('rackId', body.rackId ? oid(body.rackId) : null)
        setField('ru', body.ru)
        setField('face', body.face)
        setField('pduOutlet', body.pduOutlet)
        setField('notes', body.notes)
        if (body.gps !== undefined) {
          rec.set('installation.gps', body.gps)
          changed.push('gps')
        }
        const willInstall = body.markInstalled && !INSTALLED_PLUS.has(rec.status)
        if (willInstall) {
          const inst = rec.installation
          if (d.serialised && !inst.serial) throw badRequest('Record the serial number before marking the device installed')
          if (d.mounting !== '0U' && d.rackId && (!inst.rackId || inst.ru == null || !inst.face)) throw badRequest('Confirm the rack, RU and face before marking the device installed')
          rec.status = 'installed'
          rec.history.push({ status: 'installed', by: actor.userId, byName: actorName })
        }
        if (!changed.length && !willInstall) return { changed: [], installed: false }
        rec.set('installation.technicianId', actor.userId)
        rec.set('installation.technicianName', actorName)
        rec.set('installation.updatedAt', new Date())
        if (willInstall) rec.set('installation.installedAt', new Date())
        setProvenance(rec, changed.map((f) => `installation_${f}`), 'deployment', actor, actorName)
        rec.version += 1
        rec.updatedAt = new Date()
        // The project serial registry: one row per serial, owned by the device.
        if (changed.includes('serial')) {
          await SerialRegistry.deleteMany({ ownerType: 'device', ownerId: oid(d.id) }, { session })
          if (serial) await SerialRegistry.create([{ serial, ownerType: 'device', ownerId: oid(d.id) }], { session })
        }
        try {
          await rec.save({ session })
        } catch (err) {
          if (err.code === 11000) throw conflict('mac_in_use', 'That MAC address is already recorded on another device')
          throw err
        }
        const inst = rec.installation
        const installedRack = inst.rackId ? ctx.rackOf.get(String(inst.rackId)) : null
        await settleExceptions({ deviceId: d.id, deviations: deviceDeviations({ rackId: d.rackId, rackCode: d.rackCode, ru: d.ru, face: d.face }, { rackId: id(inst.rackId), rackCode: installedRack?.code ?? null, ru: inst.ru ?? null, face: inst.face ?? null }) }, session)
        await audit(req, building, actor, willInstall ? 'deployment.device.installed' : 'deployment.installation.updated', {
          objectType: 'Device',
          objectId: d.id,
          comment: d.label,
          changes: changed.map((f) => ({ objectType: 'Device', objectId: d.id, field: `installation.${f}`, before: before[f] instanceof mongoose.Types.ObjectId ? String(before[f]) : before[f] ?? null, after: (() => { const v = rec.installation[f]; return v instanceof mongoose.Types.ObjectId ? String(v) : v && typeof v === 'object' ? JSON.stringify(v) : v ?? null })() })),
          session,
        })
        return { changed, installed: willInstall }
      }).catch((err) => {
        if (err.code === 11000) throw conflict('serial_in_use', 'That serial is already registered in this project')
        throw err
      })
      if (result.installed) {
        await notifyQuietly({ type: 'device_installed', buildingId: building.id, title: `${d.label} installed (${building.code})`, body: `${d.roomCode ?? ''}${d.rackCode ? ` · ${d.rackCode}` : ''}`.trim() || null, relatedObjectType: 'device', relatedObjectId: d.id, link: link(req, building), groupLink: link(req, building), actorId: actor.userId, to: { roles: ['pm'] } })
      }
      return { ...result, device: await deviceDetail(req, d.id) }
    },

    // DGUV V3 inspection of a mains-powered device: date, inspector, certificate.
    async recordDguv(req, deviceId, body, actor) {
      const roles = await rolesOf(req)
      requireRole(roles, ['field_engineer', 'pm'], 'Only the Field Engineer or a PM records a DGUV inspection')
      const { building, ctx, d } = await deviceContext(req, deviceId)
      await writable(building)
      requireFrozen(ctx)
      if (!d.mainsPowered) throw badRequest(`${d.label} is not mains-powered — DGUV V3 inspections apply to mains-powered devices only`)
      if (!INSTALLED_PLUS.has(d.status)) throw conflict('not_installed', 'Inspect the device once it is installed')
      if (body.inspectionDate > ctx.today) throw badRequest('The inspection date cannot be in the future')
      if (body.certificateFileId) {
        const file = await File.findOne({ _id: body.certificateFileId, deletedAt: null, 'attachedTo.type': 'device', 'attachedTo.id': oid(d.id) }).lean()
        if (!file) throw badRequest('Upload the certificate to this device first')
      }
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      await withTransaction(async (session) => {
        const rec = await recordFor(d, building, session)
        const before = rec.dguv?.lastInspectionDate ?? null
        rec.set('dguv', { lastInspectionDate: body.inspectionDate, inspector: body.inspector, certificateFileId: body.certificateFileId ? oid(body.certificateFileId) : null, recordedBy: actor.userId, recordedAt: new Date(), remindersSent: [] })
        setProvenance(rec, ['dguv_lastInspectionDate'], 'deployment', actor, actorName)
        rec.version += 1
        rec.updatedAt = new Date()
        await rec.save({ session })
        await audit(req, building, actor, 'deployment.dguv.recorded', { objectType: 'Device', objectId: d.id, comment: `${d.label}: inspected ${body.inspectionDate} by ${body.inspector}`, changes: [{ objectType: 'Device', objectId: d.id, field: 'dguv.lastInspectionDate', before, after: body.inspectionDate }], session })
      })
      return { device: await deviceDetail(req, d.id) }
    },

    // Installed → Configured → Tested (Field Engineer) → Accepted (PM / Reviewer).
    async setDeviceStatus(req, deviceId, body, actor) {
      const roles = await rolesOf(req)
      const { building, ctx, d } = await deviceContext(req, deviceId)
      await writable(building)
      requireFrozen(ctx)
      const conns = ctx.connsOfDevice(d.id)
      const problem = deviceStepProblem(d.status, body.status, {
        roles,
        delivered: d.delivered,
        serialised: d.serialised,
        serial: d.rec?.installation?.serial,
        mainsPowered: d.mainsPowered,
        dguvRecorded: Boolean(d.rec?.dguv?.lastInspectionDate),
        openDeviations: d.openDeviations,
        openExceptions: d.openExceptions,
        connections: conns.map((c) => ({ status: c.status })),
      })
      if (problem) throw /Only/.test(problem) ? forbidden(problem) : conflict('invalid_transition', problem)
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      await withTransaction(async (session) => {
        const saved = await DeploymentRecord.findOneAndUpdate(
          { deviceId: oid(d.id), status: d.status },
          {
            $set: { status: body.status, updatedAt: new Date(), ...(body.status === 'accepted' ? { acceptedBy: actor.userId, acceptedAt: new Date() } : {}) },
            $push: { history: { status: body.status, by: actor.userId, byName: actorName, at: new Date(), note: body.note ?? null } },
            $inc: { version: 1 },
          },
          { session, returnDocument: 'after' }
        )
        if (!saved) throw conflict('stale_status', 'The device changed since you loaded it — reload')
        await audit(req, building, actor, `deployment.device.${body.status}`, { objectType: 'Device', objectId: d.id, comment: `${d.label}: ${STATUS_LABELS[d.status]} → ${STATUS_LABELS[body.status]}`, changes: [{ objectType: 'Device', objectId: d.id, field: 'status', before: d.status, after: body.status }], session })
      })
      if (body.status === 'accepted') {
        await notifyQuietly({ type: 'device_accepted', buildingId: building.id, title: `${d.label} accepted — now in the CMDB (${building.code})`, relatedObjectType: 'device', relatedObjectId: d.id, link: link(req, building), groupLink: link(req, building), actorId: actor.userId, to: { roles: ['pm', 'field_engineer'] } })
      }
      return { device: await deviceDetail(req, d.id) }
    },

    // Patching of one connection, per end and per cable segment; `confirm`
    // moves it to Installed (every cable confirmed, with its ID and length).
    async saveConnection(req, connectionId, body, actor) {
      const roles = await rolesOf(req)
      requireRole(roles, ['field_engineer'], 'Only the Field Engineer confirms patching')
      const { building, ctx, c } = await connectionContext(req, connectionId)
      await writable(building)
      requireFrozen(ctx)
      if (c.status === 'accepted') throw conflict('accepted', 'This connection is accepted — changes are operational edits in the CMDB')
      for (const e of [c.view.source, c.view.dest, ...c.view.hops.map((h) => ({ deviceId: h.patchPanelId }))]) {
        const end = ctx.deviceById.get(e.deviceId)
        if (end && !end.delivered && !INSTALLED_PLUS.has(end.status)) throw conflict('awaiting_delivery', `Awaiting delivery of ${end.label}`)
      }
      const segCount = c.view.segments.length
      for (const s of body.segments ?? []) if (s.index >= segCount) throw badRequest(`This connection has ${segCount} cable(s)`)
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const out = await withTransaction(async (session) => {
        let rec = await ConnectionRecord.findOne({ connectionId: oid(c.id) }).session(session)
        if (!rec) rec = new ConnectionRecord({ buildingId: building.id, connectionId: oid(c.id), status: 'draft' })
        const before = JSON.stringify(rec.installed ?? {})
        for (const f of ['sourcePort', 'destPort', 'media', 'sourceSfpCode', 'destSfpCode']) if (body[f] !== undefined) rec.set(`installed.${f}`, body[f] || null)
        if (body.segments) {
          const segs = new Map((rec.installed?.segments ?? []).map((s) => [s.index, { index: s.index, cableId: s.cableId, installedM: s.installedM, confirmed: s.confirmed }]))
          for (const s of body.segments) {
            const prev = segs.get(s.index) ?? { index: s.index, cableId: null, installedM: null, confirmed: false }
            segs.set(s.index, { index: s.index, cableId: s.cableId !== undefined ? s.cableId || null : prev.cableId, installedM: s.installedM !== undefined ? s.installedM : prev.installedM, confirmed: s.confirmed !== undefined ? s.confirmed : prev.confirmed })
          }
          rec.set('installed.segments', [...segs.values()].sort((a, b) => a.index - b.index))
        }
        const changed = JSON.stringify(rec.installed ?? {}) !== before
        let installed = false
        if (body.confirm) {
          const segs = new Map((rec.installed?.segments ?? []).map((s) => [s.index, s]))
          const missing = c.view.segments.filter((s) => {
            const got = segs.get(s.index)
            return !got?.confirmed || !got.cableId || got.installedM == null
          })
          const problem = connectionStepProblem(c.status, 'installed', { roles, segmentsConfirmed: missing.length === 0 })
          if (problem) throw badRequest(missing.length ? `Confirm every cable with its cable ID and Installed length (${missing.map((s) => `cable ${s.index + 1}`).join(', ')} missing)` : problem)
          if (!PATCHED.has(rec.status) || rec.status === 'faulty') {
            installed = rec.status === 'draft'
            rec.status = 'installed'
          }
          rec.installedBy = actor.userId
          rec.installedByName = actorName
          rec.installedAt = new Date()
        }
        // Re-patching a tested link needs a new test.
        if (changed && ['tested', 'faulty'].includes(rec.status)) {
          rec.status = 'installed'
          rec.set('test', { result: null, note: null, by: null, byName: null, at: null })
        }
        rec.updatedAt = new Date()
        await rec.save({ session })
        await settleExceptions({ connectionId: c.id, deviations: connectionDeviations(c.view, rec.installed.toObject ? rec.installed.toObject() : rec.installed) }, session)
        if (changed || installed) await audit(req, building, actor, installed ? 'deployment.connection.installed' : 'deployment.connection.updated', { objectType: 'Connection', objectId: c.id, comment: `${ctx.nameOf(c.view.source.deviceId)} ${c.view.source.portId ?? ''} → ${ctx.nameOf(c.view.dest.deviceId)} ${c.view.dest.portId ?? ''}`.trim(), changes: changed ? [{ objectType: 'Connection', objectId: c.id, field: 'installed', before: JSON.parse(before), after: rec.installed.toObject ? rec.installed.toObject() : rec.installed }] : [], session })
        return { installed }
      })
      return { ...out, connection: await connectionDetail(req, c.id) }
    },

    // The link test (Field Engineer): pass → Tested, fail → Faulty.
    async testConnection(req, connectionId, body, actor) {
      const roles = await rolesOf(req)
      const { building, ctx, c } = await connectionContext(req, connectionId)
      await writable(building)
      requireFrozen(ctx)
      const to = body.result === 'pass' ? 'tested' : 'faulty'
      const problem = connectionStepProblem(c.status, to, { roles })
      if (problem) throw /Only/.test(problem) ? forbidden(problem) : conflict('invalid_transition', problem)
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      await withTransaction(async (session) => {
        const saved = await ConnectionRecord.findOneAndUpdate({ connectionId: oid(c.id), status: c.status }, { $set: { status: to, test: { result: body.result, note: body.note ?? null, by: actor.userId, byName: actorName, at: new Date() }, updatedAt: new Date() } }, { session, returnDocument: 'after' })
        if (!saved) throw conflict('stale_status', 'The connection changed since you loaded it — reload')
        await audit(req, building, actor, `deployment.connection.test_${body.result}`, { objectType: 'Connection', objectId: c.id, comment: body.note ?? null, changes: [{ objectType: 'Connection', objectId: c.id, field: 'status', before: c.status, after: to }], session })
      })
      return { connection: await connectionDetail(req, c.id) }
    },

    // A PM or Reviewer accepts a tested connection with nothing unresolved.
    async acceptConnection(req, connectionId, actor) {
      const roles = await rolesOf(req)
      const { building, ctx, c } = await connectionContext(req, connectionId)
      await writable(building)
      requireFrozen(ctx)
      const problem = connectionStepProblem(c.status, 'accepted', { roles })
      if (problem) throw /Only/.test(problem) ? forbidden(problem) : conflict('invalid_transition', problem)
      const open = unhandledDeviations(c.deviations, ctx.exceptions, { deviceId: null, connectionId: c.id }).length + ctx.exceptions.filter((e) => e.status === 'open' && String(e.connectionId) === c.id).length
      if (open) throw conflict('unresolved', 'Resolve the connection’s deviations and exceptions first')
      await withTransaction(async (session) => {
        const saved = await ConnectionRecord.findOneAndUpdate({ connectionId: oid(c.id), status: 'tested' }, { $set: { status: 'accepted', acceptedBy: actor.userId, acceptedAt: new Date(), updatedAt: new Date() } }, { session, returnDocument: 'after' })
        if (!saved) throw conflict('stale_status', 'The connection changed since you loaded it — reload')
        await audit(req, building, actor, 'deployment.connection.accepted', { objectType: 'Connection', objectId: c.id, changes: [{ objectType: 'Connection', objectId: c.id, field: 'status', before: 'tested', after: 'accepted' }], session })
      })
      return { connection: await connectionDetail(req, c.id) }
    },

    // The Field Engineer logs a detected difference as an exception instead of correcting it.
    async logException(req, body, actor) {
      const roles = await rolesOf(req)
      requireRole(roles, ['field_engineer'], 'Only the Field Engineer logs installation exceptions')
      const { building, ctx, d } = await deviceContext(req, body.deviceId)
      await writable(building)
      requireFrozen(ctx)
      let deviations
      if (body.connectionId) {
        const c = ctx.connections.find((x) => x.id === body.connectionId)
        if (!c || !ctx.connsOfDevice(d.id).includes(c)) throw notFound('Connection not found on this device')
        deviations = unhandledDeviations(c.deviations, ctx.exceptions, { deviceId: d.id, connectionId: c.id })
      } else {
        deviations = unhandledDeviations(d.deviations, ctx.exceptions, { deviceId: d.id })
      }
      const dev = deviations.find((x) => x.field === body.field)
      if (!dev) throw conflict('no_deviation', 'There is no open difference from the design for this field — nothing to log')
      if (body.photoFileIds.length) {
        const files = await File.countDocuments({ _id: { $in: body.photoFileIds.map(oid) }, deletedAt: null, 'attachedTo.type': 'device', 'attachedTo.id': oid(d.id) })
        if (files !== new Set(body.photoFileIds).size) throw badRequest('Attach photos uploaded to this device')
      }
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const exception = await withTransaction(async (session) => {
        const [e] = await DeploymentException.create([{ buildingId: building.id, deviceId: oid(d.id), connectionId: body.connectionId ? oid(body.connectionId) : null, field: dev.field, label: dev.label, designedValue: dev.designedValue, installedValue: dev.installedValue, reason: body.reason, photoFileIds: body.photoFileIds.map(oid), loggedBy: actor.userId, loggedByName: actorName }], { session })
        await audit(req, building, actor, 'deployment.exception.logged', { objectType: 'DeploymentException', objectId: e._id, comment: `${d.label} ${dev.label}: designed ${dev.designedValue}, installed ${dev.installedValue} — ${body.reason}`, session })
        return e.toObject()
      })
      await notifyQuietly({ type: 'exception_logged', buildingId: building.id, title: `Exception on ${d.label}: ${dev.label} ${dev.designedValue} → ${dev.installedValue} (${building.code})`, body: body.reason, relatedObjectType: 'deployment_exception', relatedObjectId: String(exception._id), link: link(req, building), groupLink: link(req, building), actorId: actor.userId, to: { roles: ['pm', 'reviewer'] } })
      return { exception: exceptionView(ctx, exception, new Map()) }
    },

    // A Reviewer or PM accepts or rejects an open exception.
    async reviewException(req, exceptionId, body, actor) {
      const roles = await rolesOf(req)
      requireRole(roles, ['pm', 'reviewer'], 'Only a Reviewer or PM reviews exceptions')
      const e = mongoose.isValidObjectId(exceptionId) ? await DeploymentException.findById(exceptionId).lean() : null
      if (!e) throw notFound('Exception not found')
      const building = await requireBuilding(req, e.buildingId)
      await writable(building)
      if (e.status !== 'open') throw conflict('not_open', `This exception is already ${e.status}`)
      const actorName = (await namesOf([actor.userId])).get(String(actor.userId)) ?? null
      const saved = await withTransaction(async (session) => {
        const s = await DeploymentException.findOneAndUpdate({ _id: e._id, status: 'open' }, { $set: { status: body.decision, reviewedBy: actor.userId, reviewedByName: actorName, reviewedAt: new Date(), reviewNote: body.note || null } }, { session, returnDocument: 'after' }).lean()
        if (!s) throw conflict('not_open', 'This exception was reviewed or closed meanwhile')
        await audit(req, building, actor, `deployment.exception.${body.decision}`, { objectType: 'DeploymentException', objectId: e._id, comment: body.note || null, changes: [{ objectType: 'DeploymentException', objectId: String(e._id), field: 'status', before: 'open', after: body.decision }], session })
        return s
      })
      const ctx = await load(req, building)
      await notifyQuietly({ type: 'exception_reviewed', buildingId: building.id, title: `Exception ${body.decision} on ${ctx.nameOf(e.deviceId)}: ${e.label} (${building.code})`, body: body.note || null, relatedObjectType: 'deployment_exception', relatedObjectId: String(e._id), link: link(req, building), actorId: actor.userId, to: { userIds: [e.loggedBy] } })
      return { exception: exceptionView(ctx, saved, new Map()) }
    },
  }
}

// Deployment and CMDB phase statuses per building (calculated, never stored):
// deployment starts with the first installed device and completes when every
// designed device is accepted; the CMDB fills as devices are accepted.
export async function deploymentStatusesByBuilding(session = null) {
  const [designed, records] = await Promise.all([
    Device.aggregate([{ $match: { layer: 'lld', origin: 'planned', category: { $nin: ['wan_sp_connection', 'remote_site'] }, role: { $nin: ['wan_circuit', 'remote_site'] } } }, { $group: { _id: '$buildingId', n: { $sum: 1 } } }]).session(session),
    DeploymentRecord.find({ status: { $nin: ['draft', 'retired'] } }, { buildingId: 1, deviceId: 1, status: 1 }).session(session).lean(),
  ])
  const total = new Map(designed.map((d) => [String(d._id), d.n]))
  const devices = await Device.find({ _id: { $in: records.map((r) => r.deviceId) }, layer: 'lld' }, { _id: 1 }).session(session).lean()
  const live = new Set(devices.map((d) => String(d._id)))
  const byBuilding = new Map()
  for (const r of records) {
    if (!live.has(String(r.deviceId))) continue // a change request removed the device
    const key = String(r.buildingId)
    if (!byBuilding.has(key)) byBuilding.set(key, [])
    byBuilding.get(key).push({ status: r.status })
  }
  const deployment = new Map()
  const cmdb = new Map()
  for (const [buildingId, list] of byBuilding) {
    const accepted = list.filter((d) => ['accepted', 'in_service', 'maintenance'].includes(d.status)).length
    const designedCount = total.get(buildingId) ?? list.length
    deployment.set(buildingId, accepted >= designedCount && designedCount > 0 ? 'completed' : 'in_progress')
    cmdb.set(buildingId, cmdbPhaseStatus(designedCount, accepted))
  }
  return { deployment, cmdb }
}
