import mongoose from 'mongoose'
import { validateCmoRows, normaliseMac, computeCmoKpis, computeCmoPhaseStatus } from '@rackium/shared/cmoModel.js'
import { catalogueKey } from '@rackium/shared/catalogue.js'
import { Device } from '../models/device.js'
import { SerialRegistry } from '../models/serialRegistry.js'
import { ImportBatch } from '../models/importBatch.js'
import { Blocker } from '../models/blocker.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { PlatformCatalogueItem } from '../models/platformCatalogueItem.js'
import { CatalogueItem } from '../models/catalogueItem.js'
import { buildingsWithSal } from '../hierarchy/lookup.js'
import { registerDeleteGuard } from '../hierarchy/service.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { notFound, badRequest, conflict } from '../http/errors.js'

const lower = (v) => String(v).trim().toLowerCase()

// A building, room, rack or SAL that devices still point at cannot be deleted
// (M2's extensible delete check).
registerDeleteGuard('sal', { model: Device, field: 'salId' })
registerDeleteGuard('building', { model: Device, field: 'buildingId' })
registerDeleteGuard('room', { model: Device, field: 'roomId' })
registerDeleteGuard('rack', { model: Device, field: 'rackId' })

// CMO phase status per building (brief v2.3 §5.1, M3a): computed from the
// imported devices, never stored (DATA-MODEL §5.1).
export async function cmoStatusByBuilding(session = null) {
  const { buildings } = await buildingsWithSal(session)
  const devices = await Device.find({ origin: 'existing' }, { buildingId: 1, salId: 1 }).session(session).lean()
  return statusesFrom(buildings, devices)
}

function statusesFrom(buildings, devices) {
  const perBuilding = new Map()
  const unassignedPerSal = new Map()
  for (const d of devices) {
    if (d.buildingId) perBuilding.set(String(d.buildingId), (perBuilding.get(String(d.buildingId)) ?? 0) + 1)
    else unassignedPerSal.set(String(d.salId), (unassignedPerSal.get(String(d.salId)) ?? 0) + 1)
  }
  return new Map(
    buildings.map((b) => [
      b.id,
      computeCmoPhaseStatus({ buildingDeviceCount: perBuilding.get(b.id) ?? 0, salUnassignedCount: unassignedPerSal.get(b.salId) ?? 0 }),
    ])
  )
}

// What a CMO row's `model` text can match in the catalogue: the item's key
// ("Cisco C9300-48UX") or its bare model ("C9300-48UX").
async function catalogueMatcher(projectId, session) {
  const platform = await PlatformCatalogueItem.find({ kind: 'device_model' }, { key: 1, vendor: 1, model: 1 }).session(session).lean()
  const customer = await CatalogueItem.find({ kind: 'device_model', $or: [{ layer: 'organisation' }, { layer: 'project', projectId }] }, { key: 1, vendor: 1, model: 1 })
    .session(session)
    .lean()
  const byText = new Map()
  for (const item of [...platform, ...customer]) {
    const key = catalogueKey(item)
    byText.set(lower(key), key)
    if (!byText.has(lower(item.model))) byText.set(lower(item.model), key)
  }
  return (model) => (model ? byText.get(lower(model)) ?? null : null)
}

// Everything a row is checked against, read once. Inside a commit these
// reads share the transaction's snapshot, so the check and the writes agree.
// Sequential: a transaction session must not run operations in parallel.
async function loadContext(session) {
  const { buildings, sals } = await buildingsWithSal(session)
  const serials = await SerialRegistry.find({}, { serial: 1 }).session(session).lean()
  const devices = await Device.find({}, { hostname: 1, 'installation.mac': 1 }).session(session).lean()
  const rooms = await Room.find({}, { code: 1, buildingId: 1 }).session(session).lean()
  const racks = await Rack.find({}, { code: 1, roomId: 1 }).session(session).lean()
  return {
    buildings,
    sals,
    projectSerials: new Set(serials.map((s) => lower(s.serial))),
    projectMacs: new Set(devices.map((d) => d.installation?.mac).filter(Boolean)),
    projectHostnames: new Set(devices.map((d) => d.hostname).filter(Boolean).map(lower)),
    roomIndex: new Map(rooms.map((r) => [`${r.buildingId}|${lower(r.code)}`, String(r._id)])),
    rackIndex: new Map(racks.map((r) => [`${r.roomId}|${lower(r.code)}`, String(r._id)])),
  }
}

function chooseSal(sals, salId, scope) {
  if (sals.length === 0) throw badRequest('Add a SAL to the project hierarchy before importing CMO inventory')
  const inScope = scope ? sals.filter((s) => scope.coversSal(s.id)) : sals
  if (salId) {
    if (!sals.some((s) => s.id === salId)) throw badRequest('That SAL is not in this project')
    if (!inScope.some((s) => s.id === salId)) throw badRequest('That SAL is outside your scope')
    return salId
  }
  if (inScope.length === 1) return inScope[0].id
  // A building-scoped importer has no SAL: rows without a building are refused per row.
  if (inScope.length === 0) return null
  throw badRequest('Choose the SAL that devices without a building belong to')
}

// Rows outside the caller's membership scope are blocked, like any invalid row.
function applyScope(validated, scope, chosenSalId, buildings) {
  if (!scope) return validated
  const codeOf = new Map(buildings.map((b) => [b.id, b.code]))
  return validated.map((r) => {
    if (!r.valid) return r
    let error = null
    if (r.buildingId && !scope.coversBuilding(r.buildingId)) error = `Building ${codeOf.get(r.buildingId) ?? ''} is outside your scope`.replace('  ', ' ')
    else if (!r.buildingId && !chosenSalId) error = 'Devices without a building need a SAL within your scope'
    return error ? { ...r, valid: false, errors: [...r.errors, error] } : r
  })
}

function validate(rows, ctx) {
  const buildingByCode = new Map(ctx.buildings.map((b) => [lower(b.code), b]))
  return validateCmoRows(rows, {
    projectSerials: ctx.projectSerials,
    projectMacs: ctx.projectMacs,
    projectHostnames: ctx.projectHostnames,
    resolveBuilding: (text) => buildingByCode.get(lower(text))?.id ?? null,
    resolveRoom: (buildingId, code) => ctx.roomIndex.get(`${buildingId}|${lower(code)}`) ?? null,
    resolveRack: (roomId, code) => ctx.rackIndex.get(`${roomId}|${lower(code)}`) ?? null,
  })
}

function summarise(validated) {
  return {
    rows: validated.length,
    valid: validated.filter((r) => r.valid).length,
    blocked: validated.filter((r) => !r.valid).length,
    unassigned: validated.filter((r) => r.valid && !r.buildingId).length,
    warnings: validated.filter((r) => r.warnings.length).length,
  }
}

const optionalId = (v) => (v ? String(v) : null)

function toDevice(d, lookups) {
  return {
    id: String(d._id),
    origin: d.origin,
    hostname: d.hostname ?? null,
    model: d.model ?? null,
    catalogueKey: d.catalogueKey ?? null,
    serial: d.installation?.serial ?? null,
    mac: d.installation?.mac ?? null,
    salId: String(d.salId),
    salCode: lookups.salCode.get(String(d.salId)) ?? null,
    buildingId: optionalId(d.buildingId),
    buildingCode: d.buildingId ? lookups.buildingCode.get(String(d.buildingId)) ?? null : null,
    roomId: optionalId(d.roomId),
    roomCode: d.roomId ? lookups.roomCode.get(String(d.roomId)) ?? null : null,
    rackId: optionalId(d.rackId),
    rackCode: d.rackId ? lookups.rackCode.get(String(d.rackId)) ?? null : null,
    ru: d.ru ?? null,
    status: d.status,
    assignedAt: d.assignedAt ?? null,
  }
}

export function createCmoService() {
  return {
    // `scope` (access/scope.js): only the caller's buildings, SALs and their devices.
    async context({ scope = null } = {}) {
      const all = await buildingsWithSal()
      const buildings = scope ? scope.buildings : all.buildings
      const sals = scope ? scope.sals : all.sals
      const [devices, rooms, racks, lastBatch, statuses] = await Promise.all([
        Device.find({ origin: 'existing' }).sort({ createdAt: 1 }).lean(),
        Room.find({}, { code: 1 }).lean(),
        Rack.find({}, { code: 1 }).lean(),
        ImportBatch.findOne({ type: 'cmo', status: 'committed' }).sort({ uploadedAt: -1 }).lean(),
        cmoStatusByBuilding(),
      ])
      const lookups = {
        salCode: new Map(all.sals.map((s) => [s.id, s.code])),
        buildingCode: new Map(all.buildings.map((b) => [b.id, b.code])),
        roomCode: new Map(rooms.map((r) => [String(r._id), r.code])),
        rackCode: new Map(racks.map((r) => [String(r._id), r.code])),
      }
      const visible = scope ? devices.filter((d) => scope.coversItem({ buildingId: d.buildingId, salId: d.salId })) : devices
      const mapped = visible.map((d) => toDevice(d, lookups))
      return {
        sals,
        buildings: buildings.map((b) => ({ ...b, cmoStatus: statuses.get(b.id) ?? 'not_started' })),
        devices: mapped,
        kpis: computeCmoKpis(mapped),
        lastImportAt: lastBatch?.uploadedAt ?? null,
      }
    },

    async preview({ rows, salId, scope = null }) {
      const ctx = await loadContext(null)
      const chosenSalId = chooseSal(ctx.sals, salId, scope)
      const validated = applyScope(validate(rows, ctx), scope, chosenSalId, ctx.buildings)
      return { salId: chosenSalId, rows: validated, summary: summarise(validated) }
    },

    // DATA-MODEL §10.2 "CMO import commit": the batch, every valid row's
    // device and its serial-registry entry, and (M3a) one blocker per
    // Unassigned device — all in one transaction, or nothing. Rows are
    // re-validated here against the transaction's own snapshot; a serial or
    // MAC that slipped in concurrently hits a unique index and aborts it all.
    async commit({ rows, salId, fileName, actor, scope: callerScope = null }) {
      const { organisationId, projectId } = currentScope()
      const result = await withTransaction(async (session) => {
        const ctx = await loadContext(session)
        const chosenSalId = chooseSal(ctx.sals, salId, callerScope)
        const validated = applyScope(validate(rows, ctx), callerScope, chosenSalId, ctx.buildings)
        const importable = validated.filter((r) => r.valid)
        if (importable.length === 0) throw badRequest('No row can be imported — fix the blocked rows and try again')

        const matchCatalogue = await catalogueMatcher(projectId, session)
        const salOfBuilding = new Map(ctx.buildings.map((b) => [b.id, b.salId]))
        const [batch] = await ImportBatch.create(
          [{ type: 'cmo', salId: chosenSalId, uploadedBy: actor.userId, fileName: fileName ?? null, rowCount: rows.length, status: 'committed' }],
          { session }
        )

        const now = new Date()
        const scope = { organisationId: new mongoose.Types.ObjectId(String(organisationId)), projectId: new mongoose.Types.ObjectId(String(projectId)) }
        const devices = importable.map((r) => ({
          _id: new mongoose.Types.ObjectId(),
          ...scope,
          origin: 'existing',
          status: 'in_service',
          salId: r.buildingId ? salOfBuilding.get(r.buildingId) : chosenSalId,
          buildingId: r.buildingId,
          roomId: r.roomId,
          rackId: r.rackId,
          ru: r.ruPosition,
          hostname: r.hostname,
          model: r.model,
          catalogueKey: matchCatalogue(r.model),
          installation: { serial: r.serial, mac: normaliseMac(r.mac) },
          importBatchId: batch._id,
          createdAt: now,
        }))
        await Device.insertMany(devices, { session })
        await SerialRegistry.insertMany(
          devices.map((d) => ({ ...scope, serial: d.installation.serial, ownerType: 'device', ownerId: d._id, registeredAt: now })),
          { session }
        )

        const unassigned = devices.filter((d) => !d.buildingId)
        const salCode = new Map(ctx.sals.map((s) => [s.id, s.code]))
        if (unassigned.length) {
          await Blocker.insertMany(
            unassigned.map((d) => ({
              ...scope,
              buildingId: null,
              salId: d.salId,
              phaseKey: 'cmo',
              description: `Unassigned CMO device ${d.hostname ?? d.installation.serial} (serial ${d.installation.serial}) at SAL ${salCode.get(String(d.salId)) ?? ''} — the PM assigns it to a building`.trim(),
              relatedObjectType: 'device',
              relatedObjectId: d._id,
              source: 'system',
              raisedAt: now,
              raisedBy: actor.userId,
              priority: 'medium',
              status: 'open',
            })),
            { session }
          )
        }

        const summary = { imported: devices.length, assigned: devices.length - unassigned.length, unassigned: unassigned.length, skipped: validated.length - importable.length }
        batch.summary = summary
        await batch.save({ session })

        const auditBase = {
          organisationId,
          projectId,
          actor: userActor(actor.userId, actor.role),
          action: 'cmo.import.committed',
          objectType: 'ImportBatch',
          objectId: batch._id,
          phaseKey: 'cmo',
          changeType: 'import',
          source: 'import',
          session,
        }
        await recordAudit({ ...auditBase, comment: `${summary.imported} imported (${summary.unassigned} unassigned), ${summary.skipped} skipped` })
        // One entry per building that received devices, so each building's
        // Recent Activity shows its own import.
        const perBuilding = new Map()
        for (const d of devices) if (d.buildingId) perBuilding.set(d.buildingId, (perBuilding.get(d.buildingId) ?? 0) + 1)
        for (const [buildingId, count] of perBuilding) {
          await recordAudit({ ...auditBase, buildingId, comment: `${count} device(s) imported for this building` })
        }
        return { batchId: String(batch._id), salId: chosenSalId, summary }
      })
      return result
    },

    // Brief v2.3 §5.1: "The PM assigns them." Only an Unassigned device, only
    // to a building in its own SAL. Its blocker is resolved in the same
    // transaction.
    async assign({ deviceId, buildingId, actor, scope = null }) {
      const { organisationId, projectId } = currentScope()
      return withTransaction(async (session) => {
        const device = mongoose.isValidObjectId(deviceId) ? await Device.findById(deviceId).session(session) : null
        if (!device || device.origin !== 'existing') throw notFound('Device not found')
        if (scope && !scope.coversItem({ buildingId: device.buildingId, salId: device.salId })) throw notFound('Device not found')
        if (device.buildingId) throw conflict('already_assigned', 'This device is already assigned to a building')
        const { buildings } = await buildingsWithSal(session)
        const building = buildings.find((b) => b.id === buildingId)
        if (!building || (scope && !scope.coversBuilding(building.id))) throw notFound('Building not found')
        if (building.salId !== String(device.salId)) throw badRequest('Assign the device to a building in its own SAL')

        const now = new Date()
        device.buildingId = building.id
        device.assignedBy = actor.userId
        device.assignedAt = now
        await device.save({ session })
        await Blocker.updateMany(
          { relatedObjectType: 'device', relatedObjectId: device._id, status: { $ne: 'resolved' } },
          { $set: { status: 'resolved', resolvedAt: now, resolvedBy: actor.userId } },
          { session }
        )
        await recordAudit({
          organisationId,
          projectId,
          buildingId: building.id,
          phaseKey: 'cmo',
          actor: userActor(actor.userId, actor.role),
          action: 'cmo.device.assigned',
          objectType: 'Device',
          objectId: device._id,
          changeType: 'design_intent',
          source: 'ui',
          comment: `${device.hostname ?? device.installation?.serial} assigned to ${building.code}`,
          changes: [{ objectType: 'Device', objectId: String(device._id), field: 'buildingId', before: null, after: building.id }],
          session,
        })
        return { id: String(device._id), buildingId: building.id, buildingCode: building.code }
      })
    },
  }
}
