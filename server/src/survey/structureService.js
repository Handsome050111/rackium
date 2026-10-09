import mongoose from 'mongoose'
import { validateStructure } from '@rackium/shared/siteValidation.js'
import { floorHostnameToken } from '@rackium/shared/hierarchyImport.js'
import { Building } from '../models/building.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Pathway } from '../models/pathway.js'
import { File } from '../models/file.js'
import { registerDeleteGuard } from '../hierarchy/service.js'
import { recordAudit, userActor, diffChanges } from '../audit/audit.js'
import { badRequest, notFound, conflict } from '../http/errors.js'
import { requireBuilding, requireFloor, requireRoom, buildingsInScope } from '../access/scope.js'

// A room that a pathway names cannot be deleted while the route exists.
registerDeleteGuard('room', { model: Pathway, field: 'roomLowId' })
registerDeleteGuard('room', { model: Pathway, field: 'roomHighId' })

const id = (v) => (v ? String(v) : null)

const roomSurvey = (room) => ({
  access: room.survey?.access ?? 'not_verified',
  power: room.survey?.power ?? 'unknown',
  environment: room.survey?.environment ?? 'unknown',
  captured: Boolean(room.survey?.updatedAt),
})

export function toPathway(p, roomById) {
  const low = roomById.get(String(p.roomLowId))
  const high = roomById.get(String(p.roomHighId))
  return {
    id: String(p._id),
    fromRoomId: String(p.roomLowId),
    toRoomId: String(p.roomHighId),
    fromRoomCode: low?.code ?? null,
    toRoomCode: high?.code ?? null,
    fromBuildingId: id(low?.buildingId),
    toBuildingId: id(high?.buildingId),
    routeStatus: p.routeStatus,
    distanceM: p.distanceM ?? null,
    updatedAt: p.updatedAt,
  }
}

async function photoCounts(attachedType, ids) {
  if (ids.length === 0) return new Map()
  const rows = await File.aggregate([
    { $match: { 'attachedTo.type': attachedType, 'attachedTo.id': { $in: ids.map((x) => new mongoose.Types.ObjectId(String(x))) }, deletedAt: null } },
    { $group: { _id: '$attachedTo.id', n: { $sum: 1 } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

// The prototype's site-structure tree for a set of buildings, plus the
// pathways between their rooms and the structure validation findings.
async function structureFor(buildings) {
  const buildingIds = buildings.map((b) => b.id)
  const [floors, rooms, racks] = await Promise.all([
    Floor.find({ buildingId: { $in: buildingIds } }).sort({ order: 1 }).lean(),
    Room.find({ buildingId: { $in: buildingIds } }).sort({ code: 1 }).lean(),
    Rack.find({ buildingId: { $in: buildingIds } }).sort({ code: 1 }).lean(),
  ])
  const roomIds = rooms.map((r) => r._id)
  const pathways = await Pathway.find({ $or: [{ roomLowId: { $in: roomIds } }, { roomHighId: { $in: roomIds } }] }).lean()
  // Cross-building routes may reach rooms outside these buildings.
  const otherRoomIds = pathways.flatMap((p) => [p.roomLowId, p.roomHighId]).filter((rid) => !roomIds.some((r) => String(r) === String(rid)))
  const otherRooms = otherRoomIds.length ? await Room.find({ _id: { $in: otherRoomIds } }).lean() : []
  const roomById = new Map([...rooms, ...otherRooms].map((r) => [String(r._id), r]))
  const [roomPhotos, pathwayPhotos] = await Promise.all([photoCounts('room', roomIds), photoCounts('pathway', pathways.map((p) => p._id))])

  const tree = buildings.map((b) => ({
    buildingId: b.id,
    buildingCode: b.code,
    buildingName: b.name,
    salCode: b.salCode,
    floors: floors
      .filter((f) => String(f.buildingId) === b.id)
      .map((f) => ({
        id: String(f._id),
        buildingId: b.id,
        name: f.name,
        token: f.token,
        order: f.order,
        rooms: rooms
          .filter((r) => String(r.floorId) === String(f._id))
          .map((r) => ({
            id: String(r._id),
            floorId: String(f._id),
            code: r.code,
            name: r.name ?? r.code,
            isMainRoom: Boolean(r.isMainRoom),
            survey: roomSurvey(r),
            photoCount: roomPhotos.get(String(r._id)) ?? 0,
            racks: racks.filter((k) => String(k.roomId) === String(r._id)).map((k) => ({ id: String(k._id), roomId: String(r._id), code: k.code, heightU: k.heightU })),
          })),
      })),
  }))
  const pathwayList = pathways.map((p) => ({ ...toPathway(p, roomById), photoCount: pathwayPhotos.get(String(p._id)) ?? 0 }))
  const findings = validateStructure({
    rooms: rooms.map((r) => ({ id: String(r._id), code: r.code })),
    racks: racks.map((k) => ({ id: String(k._id), roomId: String(k.roomId), code: k.code })),
    connections: pathwayList.map((p) => ({ id: p.id, distanceM: p.distanceM, fromRoomCode: p.fromRoomCode, toRoomCode: p.toRoomCode })),
    hasRoomMeta: (roomId) => roomSurvey(roomById.get(roomId) ?? {}).captured,
  })
  return { buildings: tree, pathways: pathwayList, findings }
}

async function nextRoomCode(floor, building) {
  const prefix = `TR-${floorHostnameToken(floor.token)}-`
  const existing = await Room.find({ buildingId: building.id }).lean()
  const taken = new Set(existing.map((r) => r.code.toUpperCase()))
  for (let n = 1; n < 100; n++) {
    const code = `${prefix}${String(n).padStart(2, '0')}`
    if (!taken.has(code.toUpperCase())) return code
  }
  throw conflict('no_free_code', 'No free room code on this floor')
}

async function nextRackCode(roomId) {
  const taken = new Set((await Rack.find({ roomId }).lean()).map((r) => r.code.toUpperCase()))
  for (let n = 1; n < 100; n++) {
    const code = `R${String(n).padStart(2, '0')}`
    if (!taken.has(code)) return code
  }
  throw conflict('no_free_code', 'No free rack code in this room')
}

export function createStructureService({ hierarchy }) {
  return {
    async building(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      return { building, ...(await structureFor([building])) }
    },

    // Every in-scope building of the same campus, for cross-building routes.
    async campus(req, buildingId) {
      const building = await requireBuilding(req, buildingId)
      const siblings = (await buildingsInScope(req)).filter((b) => b.campusId === building.campusId).sort((a, b) => a.code.localeCompare(b.code))
      return { building, ...(await structureFor(siblings)) }
    },

    async createFloor(req, body, actor) {
      await requireBuilding(req, body.buildingId)
      return hierarchy.createFloor({ organisationId: req.org.id, projectId: req.project.id, actor, body })
    },

    async createRoom(req, body, actor) {
      const { floor, building } = await requireFloor(req, body.floorId)
      const code = body.code ?? (await nextRoomCode(floor, building))
      return hierarchy.createRoom({ organisationId: req.org.id, projectId: req.project.id, actor, body: { floorId: body.floorId, code, name: body.name, isMainRoom: false } })
    },

    async createRack(req, body, actor) {
      await requireRoom(req, body.roomId)
      const code = body.code ?? (await nextRackCode(body.roomId))
      return hierarchy.createRack({ organisationId: req.org.id, projectId: req.project.id, actor, body: { roomId: body.roomId, code, heightU: body.heightU } })
    },

    async updateRoomSurvey(req, roomId, body, actor) {
      const { building } = await requireRoom(req, roomId)
      const room = await Room.findById(roomId)
      const before = { ...roomSurvey(room) }
      for (const [k, v] of Object.entries(body)) room.set(`survey.${k}`, v)
      room.set('survey.updatedAt', new Date())
      room.set('survey.updatedBy', actor.userId)
      await room.save()
      const after = roomSurvey(room)
      const changes = diffChanges({ objectType: 'Room', objectId: room._id, before, after, fields: ['access', 'power', 'environment'] })
      await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.room.updated', objectType: 'Room', objectId: room._id, changeType: 'design_intent', source: 'ui', changes })
      return { id: String(room._id), survey: after }
    },

    async createPathway(req, body, actor) {
      if (body.fromRoomId === body.toRoomId) throw badRequest('A pathway joins two different rooms')
      const a = await requireRoom(req, body.fromRoomId)
      const b = await requireRoom(req, body.toRoomId)
      const [low, high] = [a.room._id, b.room._id].map(String).sort()
      let pathway
      try {
        pathway = await Pathway.create({
          roomLowId: low,
          roomHighId: high,
          buildingIds: [...new Set([a.building.id, b.building.id])],
          routeStatus: body.routeStatus,
          distanceM: body.distanceM,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
      } catch (err) {
        if (err.code === 11000) throw conflict('pathway_exists', 'These two rooms are already connected')
        throw err
      }
      for (const buildingId of pathway.buildingIds) {
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.pathway.created', objectType: 'Pathway', objectId: pathway._id, changeType: 'design_intent', source: 'ui' })
      }
      return toPathway(pathway, new Map([a.room, b.room].map((r) => [String(r._id), r])))
    },

    async updatePathway(req, pathwayId, body, actor) {
      const pathway = mongoose.isValidObjectId(pathwayId) ? await Pathway.findById(pathwayId) : null
      if (!pathway) throw notFound('Pathway not found')
      const a = await requireRoom(req, pathway.roomLowId)
      const b = await requireRoom(req, pathway.roomHighId)
      const before = { routeStatus: pathway.routeStatus, distanceM: pathway.distanceM }
      if (body.routeStatus !== undefined) pathway.routeStatus = body.routeStatus
      if (body.distanceM !== undefined) pathway.distanceM = body.distanceM
      pathway.updatedBy = actor.userId
      pathway.updatedAt = new Date()
      await pathway.save()
      const changes = diffChanges({ objectType: 'Pathway', objectId: pathway._id, before, after: { routeStatus: pathway.routeStatus, distanceM: pathway.distanceM }, fields: ['routeStatus', 'distanceM'] })
      for (const buildingId of pathway.buildingIds) {
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.pathway.updated', objectType: 'Pathway', objectId: pathway._id, changeType: 'design_intent', source: 'ui', changes })
      }
      return toPathway(pathway, new Map([a.room, b.room].map((r) => [String(r._id), r])))
    },

    async deletePathway(req, pathwayId, actor) {
      const pathway = mongoose.isValidObjectId(pathwayId) ? await Pathway.findById(pathwayId) : null
      if (!pathway) throw notFound('Pathway not found')
      await requireRoom(req, pathway.roomLowId)
      await requireRoom(req, pathway.roomHighId)
      await Pathway.deleteOne({ _id: pathway._id })
      for (const buildingId of pathway.buildingIds) {
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId, phaseKey: 'survey', actor: userActor(actor.userId, actor.role), action: 'survey.pathway.deleted', objectType: 'Pathway', objectId: pathway._id, changeType: 'design_intent', source: 'ui' })
      }
      return { id: String(pathway._id), deleted: true }
    },

    // All the project's pathways in the shape shared/pathway.js and
    // cableLength.js take (routeStatus, distanceM, fromRoomId, toRoomId).
    async allPathways() {
      const pathways = await Pathway.find().lean()
      const rooms = await Room.find({ _id: { $in: pathways.flatMap((p) => [p.roomLowId, p.roomHighId]) } }).lean()
      const roomById = new Map(rooms.map((r) => [String(r._id), r]))
      return pathways.map((p) => toPathway(p, roomById))
    },
  }
}

