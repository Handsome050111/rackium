import mongoose from 'mongoose'
import { findConflicts, computeFreeRU } from '@rackium/shared/rackValidation.js'
import { computeReadiness } from '@rackium/shared/rackReadiness.js'
import { normaliseMac, isValidMac } from '@rackium/shared/cmoModel.js'
import { Rack } from '../models/rack.js'
import { Room } from '../models/room.js'
import { Floor } from '../models/floor.js'
import { Device } from '../models/device.js'
import { RuState } from '../models/ruState.js'
import { SerialRegistry } from '../models/serialRegistry.js'
import { File } from '../models/file.js'
import { registerDeleteGuard } from '../hierarchy/service.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireRack } from './access.js'

// A rack with reserved or blocked RUs cannot be deleted while they are active.
registerDeleteGuard('rack', { model: RuState, field: 'rackId', filter: { releasedAt: null } })

const FACT_GROUPS = ['details', 'mountingPower', 'cablePath', 'accessibility']
const id = (v) => (v ? String(v) : null)

function rackMeta(rack) {
  return Object.fromEntries(FACT_GROUPS.map((g) => [g, rack[g] ?? {}]))
}

function devicePlacement(d) {
  return {
    id: String(d._id),
    deviceId: String(d._id),
    kind: 'device',
    ru: d.ru ?? 0,
    heightU: d.heightU ?? 0,
    face: d.face ?? 'front',
    fullDepth: Boolean(d.fullDepth),
    mounting: d.mounting ?? 'rack',
    railSide: d.railSide ?? null,
    category: d.category ?? null,
    label: d.label ?? d.hostname ?? d.model ?? 'Device',
    sublabel: d.sublabel ?? d.model ?? null,
    hostname: d.hostname ?? null,
    model: d.model ?? null,
    catalogueKey: d.catalogueKey ?? null,
    serial: d.installation?.serial ?? null,
    mac: d.installation?.mac ?? null,
    fromCmo: Boolean(d.importBatchId),
  }
}

// Reserved/blocked RUs drawn and validated as one-RU placements of their kind
// (shared/rackValidation.js: blocked occupies both faces, reserved its own).
function ruStatePlacement(s) {
  return {
    id: `ru-${s._id}`,
    ruStateId: String(s._id),
    kind: s.state,
    ru: s.ru,
    heightU: 1,
    face: s.face === 'rear' ? 'rear' : 'front',
    fullDepth: s.face === 'both',
    mounting: 'rack',
    category: null,
    label: s.state === 'reserved' ? s.reason ?? 'Reserved' : s.reason ?? 'Blocked',
    sublabel: s.state === 'reserved' ? 'Reserved RU' : 'Blocked RU',
    setByRole: s.setByRole,
  }
}

async function loadRackSurvey(rackId, session = null) {
  const rack = await Rack.findById(rackId).session(session).lean()
  const room = await Room.findById(rack.roomId).session(session).lean()
  const floor = await Floor.findById(room.floorId).session(session).lean()
  const devices = await Device.find({ rackId: rack._id, origin: 'existing' }).session(session).lean()
  const states = await RuState.find({ rackId: rack._id, releasedAt: null }).session(session).lean()
  return { rack, room, floor, devices, states }
}

export function createRackService() {
  return {
    async get(req, rackId) {
      const { building } = await requireRack(req, rackId)
      const { rack, room, floor, devices, states } = await loadRackSurvey(rackId)
      const placements = [...devices.map(devicePlacement), ...states.map(ruStatePlacement)]
      const meta = rackMeta(rack)
      // CMO devices of this building that can be picked, with where they sit now.
      const cmoDevices = await Device.find({ buildingId: building.id, origin: 'existing', importBatchId: { $ne: null } }).lean()
      const serials = await SerialRegistry.find({}, { serial: 1, ownerId: 1 }).lean()
      const photos = await File.find({ 'attachedTo.type': 'rack', 'attachedTo.id': rack._id, deletedAt: null }).sort({ uploadedAt: 1 }).lean()
      return {
        building: { id: building.id, code: building.code, name: building.name },
        rack: { id: String(rack._id), code: rack.code, heightU: rack.heightU },
        room: { id: String(room._id), code: room.code },
        floor: { id: String(floor._id), name: floor.name, token: floor.token },
        placements,
        meta,
        readiness: computeReadiness({ placements, rackHeightU: rack.heightU, meta }),
        freeRu: { front: computeFreeRU(placements, rack.heightU, 'front'), rear: computeFreeRU(placements, rack.heightU, 'rear') },
        roomCmoList: cmoDevices.map((d) => ({
          deviceId: String(d._id),
          serial: d.installation?.serial ?? null,
          mac: d.installation?.mac ?? null,
          expectedHostname: d.hostname ?? null,
          model: d.model ?? null,
          placedInRackId: id(d.rackId),
        })),
        allProjectSerials: serials.map((s) => ({ deviceId: String(s.ownerId), serial: s.serial })),
        revision: { revision: rack.surveyRevision?.revision ?? 0, savedAt: rack.surveyRevision?.savedAt ?? null, autosavedAt: rack.surveyRevision?.autosavedAt ?? null },
        photos: photos.map((f) => ({ id: String(f._id), fileName: f.fileName, category: f.category, caption: f.caption ?? null })),
      }
    },

    // Replaces the rack's existing gear with `placements` (autosave and
    // explicit save both call this). Validated server-side with the shared
    // rack rules against every other placement and the reserved/blocked RUs;
    // serials and MACs go through the project registry. One transaction.
    async savePlacements(req, rackId, placements, actor) {
      const { building } = await requireRack(req, rackId)
      const { organisationId, projectId } = currentScope()
      return withTransaction(async (session) => {
        const { rack, devices, states } = await loadRackSurvey(rackId, session)
        const statePlacements = states.map(ruStatePlacement)

        // 1. Geometry: every placement against the RU states and every other placement.
        const candidates = placements.map((p, i) => ({ ...p, id: `p${i}`, kind: 'device', ru: p.mounting === '0U' ? 0 : p.ru, heightU: p.mounting === '0U' ? 0 : p.heightU }))
        for (const c of candidates) {
          if (c.mounting !== '0U' && c.heightU < 1) throw badRequest(`${c.label}: a rack-mounted item is at least 1U`)
          const conflicts = findConflicts(c, [...statePlacements, ...candidates.filter((o) => o.id !== c.id)], rack.heightU)
          if (conflicts.length) throw badRequest(`${c.label}: ${conflicts.map((x) => x.message).join('; ')}`, { conflicts })
        }

        // 2. Identity: placed devices must be this building's; serials and MACs unique in the project.
        const keptIds = new Set()
        const results = []
        for (const p of placements) {
          // The client chooses the id of a newly placed item (as for files), so
          // undo/redo and repeated autosaves keep addressing the same device.
          let device = p.deviceId ? await Device.findById(p.deviceId).session(session) : null
          if (device) {
            if (device.origin !== 'existing' || String(device.buildingId) !== building.id) throw badRequest(`${p.label}: not a device of this building`)
          } else {
            device = new Device({ ...(p.deviceId ? { _id: p.deviceId } : {}), origin: 'existing', status: 'in_service', salId: building.salId, buildingId: building.id, organisationId, projectId })
          }
          if (p.mac && !isValidMac(p.mac)) throw badRequest(`${p.label}: invalid MAC format`)
          // Omitted identity keeps what the device has. An imported CMO
          // device's serial is its identity and is not changed here.
          const oldSerial = device.installation?.serial ?? null
          const oldMac = device.installation?.mac ?? null
          const newSerial = p.serial === undefined ? oldSerial : p.serial?.trim() || null
          const mac = p.mac === undefined ? oldMac : p.mac ? normaliseMac(p.mac) : null
          if (device.importBatchId && newSerial?.toLowerCase() !== oldSerial?.toLowerCase()) {
            throw badRequest(`${p.label}: the serial of an imported CMO device cannot be changed here`)
          }
          Object.assign(device, {
            roomId: rack.roomId,
            rackId: rack._id,
            ru: p.mounting === '0U' ? null : p.ru,
            heightU: p.mounting === '0U' ? 0 : p.heightU,
            face: p.face,
            fullDepth: p.fullDepth,
            mounting: p.mounting,
            railSide: p.mounting === '0U' ? p.railSide : null,
            category: p.category,
            label: p.label,
            sublabel: p.sublabel,
            catalogueKey: p.catalogueKey === undefined ? device.catalogueKey ?? null : p.catalogueKey,
            hostname: p.hostname === undefined ? device.hostname ?? null : p.hostname,
            model: p.model === undefined ? device.model ?? null : p.model,
          })
          device.installation = { ...(device.installation ?? {}), serial: newSerial, mac }
          if (oldSerial !== newSerial) {
            if (newSerial) {
              const owner = await SerialRegistry.findOne({ serial: newSerial }).collation({ locale: 'en', strength: 2 }).session(session)
              if (owner && String(owner.ownerId) !== String(device._id)) throw conflict('duplicate_serial', `Serial ${newSerial} is already recorded against another device`)
            }
            if (oldSerial) await SerialRegistry.deleteOne({ serial: oldSerial, ownerId: device._id }, { session }).collation({ locale: 'en', strength: 2 })
            if (newSerial) await SerialRegistry.create([{ serial: newSerial, ownerType: 'device', ownerId: device._id }], { session })
          }
          try {
            await device.save({ session })
          } catch (err) {
            if (err.code === 11000 && err.keyPattern?._id) throw conflict('duplicate', `${p.label}: this device id is already in use`)
            if (err.code === 11000) throw conflict('duplicate', `${p.label}: hostname or MAC already used by another device in this project`)
            throw err
          }
          keptIds.add(String(device._id))
          results.push(device)
        }

        // 3. Gear no longer in the rack: imported or identified devices are
        //    unplaced (they still exist); anonymous library items are removed.
        let removed = 0
        for (const d of devices) {
          if (keptIds.has(String(d._id))) continue
          if (d.importBatchId || d.installation?.serial) {
            await Device.updateOne({ _id: d._id }, { $set: { rackId: null, ru: null, face: null, heightU: null, mounting: null, railSide: null } }, { session })
          } else {
            await Device.deleteOne({ _id: d._id }, { session })
          }
          removed++
        }

        await Rack.updateOne({ _id: rack._id }, { $set: { 'surveyRevision.autosavedAt': new Date() } }, { session })
        await recordAudit({
          organisationId,
          projectId,
          buildingId: building.id,
          phaseKey: 'survey',
          actor: userActor(actor.userId, actor.role),
          action: 'survey.rack.saved',
          objectType: 'Rack',
          objectId: rack._id,
          changeType: 'design_intent',
          source: 'ui',
          comment: `${results.length} item(s) placed, ${removed} removed`,
          session,
        })
        return { saved: results.length, removed }
      })
    },

    // Explicit "Save version" (brief §6.10): the revision counter; autosave never bumps it.
    async saveVersion(req, rackId, actor) {
      const { building } = await requireRack(req, rackId)
      const rack = await Rack.findByIdAndUpdate(rackId, { $inc: { 'surveyRevision.revision': 1 }, $set: { 'surveyRevision.savedAt': new Date(), 'surveyRevision.savedBy': actor.userId } }, { returnDocument: 'after' }).lean()
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.rack.version_saved', objectType: 'Rack', objectId: rack._id, changeType: 'design_intent', source: 'ui', comment: `revision ${rack.surveyRevision.revision}` })
      return { revision: rack.surveyRevision.revision, savedAt: rack.surveyRevision.savedAt }
    },

    async updateFacts(req, rackId, body, actor) {
      const { building } = await requireRack(req, rackId)
      const rack = await Rack.findById(rackId)
      const changes = []
      for (const group of FACT_GROUPS) {
        if (!body[group]) continue
        const before = rack[group] ?? {}
        const after = { ...before, ...body[group] }
        for (const key of Object.keys(body[group])) {
          if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) changes.push({ objectType: 'Rack', objectId: String(rack._id), field: `${group}.${key}`, before: before[key] ?? null, after: after[key] ?? null })
        }
        rack.set(group, after)
        rack.markModified(group)
      }
      await rack.save()
      if (changes.length) {
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.rack.facts_updated', objectType: 'Rack', objectId: rack._id, changeType: 'design_intent', source: 'ui', changes })
      }
      return rackMeta(rack.toObject())
    },

    // Reserved RU: Architect. Blocked RU: PM or Org Admin; the Architect cannot
    // override a block (brief v2.3 §4.1, DATA-MODEL §4.2).
    async setRuState(req, rackId, body, actor) {
      const { building } = await requireRack(req, rackId)
      const { roles } = await callerAccess(req)
      const allowed = body.state === 'reserved' ? roles.includes('architect') : roles.includes('pm') || roles.includes('org_admin')
      if (!allowed) throw forbidden(body.state === 'reserved' ? 'Only the Architect reserves RUs' : 'Only a PM or Org Admin blocks RUs')
      const { rack, devices, states } = await loadRackSurvey(rackId)
      const candidate = { id: 'new', kind: body.state, ru: body.ru, heightU: 1, face: body.face === 'rear' ? 'rear' : 'front', fullDepth: body.face === 'both', label: body.state }
      const conflicts = findConflicts(candidate, [...devices.map(devicePlacement), ...states.map(ruStatePlacement)], rack.heightU)
      if (conflicts.length) throw conflict('ru_occupied', `RU ${body.ru}: ${conflicts.map((c) => c.message).join('; ')}`)
      const state = await RuState.create({ buildingId: building.id, rackId, ru: body.ru, face: body.face, state: body.state, reason: body.reason, setBy: actor.userId, setByRole: body.state === 'reserved' ? 'architect' : roles.includes('pm') ? 'pm' : 'org_admin' })
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: `survey.ru.${body.state}`, objectType: 'RuState', objectId: state._id, changeType: 'design_intent', source: 'ui', comment: `RU ${body.ru} (${body.face})` })
      return ruStatePlacement(state)
    },

    async releaseRuState(req, rackId, stateId, actor) {
      const { building } = await requireRack(req, rackId)
      const state = mongoose.isValidObjectId(stateId) ? await RuState.findOne({ _id: stateId, rackId, releasedAt: null }) : null
      if (!state) throw notFound('RU state not found')
      const { roles } = await callerAccess(req)
      const allowed = state.state === 'reserved' ? roles.includes('architect') : roles.includes('pm') || roles.includes('org_admin')
      if (!allowed) throw forbidden(state.state === 'reserved' ? 'Only the Architect releases a reservation' : 'Only a PM or Org Admin releases a block')
      state.releasedAt = new Date()
      state.releasedBy = actor.userId
      await state.save()
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: `survey.ru.${state.state}_released`, objectType: 'RuState', objectId: state._id, changeType: 'design_intent', source: 'ui' })
      return { id: String(state._id), released: true }
    },
  }
}
