import { buildHierarchyImportPlan } from '@rackium/shared/hierarchyImport.js'
import { Country } from '../models/country.js'
import { Sal } from '../models/sal.js'
import { Campus } from '../models/campus.js'
import { Building } from '../models/building.js'
import { Wing } from '../models/wing.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Organisation } from '../models/organisation.js'
import { withTransaction } from '../db/transaction.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { badRequest, notFound, conflict } from '../http/errors.js'


// Each level's direct children, for delete protection. A level can only be
// deleted once every one of these comes back empty. Later milestones extend
// this with their own child collections (devices under a rack, connections,
// survey records, ...) by pushing onto the relevant array — nothing here
// needs to change for that.
const CHILD_CHECKS = {
  country: [{ model: Sal, field: 'countryId' }],
  sal: [{ model: Campus, field: 'salId' }],
  campus: [{ model: Building, field: 'campusId' }],
  building: [
    { model: Floor, field: 'buildingId' },
    { model: Wing, field: 'buildingId' },
  ],
  wing: [{ model: Floor, field: 'wingId' }],
  floor: [{ model: Room, field: 'floorId' }],
  room: [{ model: Rack, field: 'roomId' }],
  rack: [],
}

// Call from a later module's own file to add a dependency check, e.g.
// registerDeleteGuard('rack', { model: Device, field: 'rackId', label: 'devices' }).
export function registerDeleteGuard(level, guard) {
  if (!CHILD_CHECKS[level]) throw new Error(`Unknown hierarchy level: ${level}`)
  CHILD_CHECKS[level].push(guard)
}

async function assertDeletable(level, id) {
  for (const { model, field } of CHILD_CHECKS[level]) {
    const count = await model.countDocuments({ [field]: id })
    if (count > 0) throw conflict('has_children', `Cannot delete: it still has ${model.modelName.toLowerCase()} records under it`)
  }
}

const LABEL = { country: 'Country', sal: 'SAL', campus: 'Campus', building: 'Building', wing: 'Wing', floor: 'Floor', room: 'Room', rack: 'Rack' }

async function audit(level, action, { organisationId, projectId, actor, objectId, changes = [] }) {
  await recordAudit({
    organisationId,
    projectId,
    actor: userActor(actor.userId, actor.role),
    action: `hierarchy.${level}.${action}`,
    objectType: LABEL[level],
    objectId,
    changeType: 'design_intent',
    source: 'ui',
    changes,
  })
}

export function createHierarchyService() {
  return {
    async createCountry({ organisationId, projectId, actor, body }) {
      const country = await Country.create({ code: body.code, name: body.name })
      await audit('country', 'created', { organisationId, projectId, actor, objectId: country._id })
      return toCountry(country)
    },
    async updateCountry({ organisationId, projectId, actor, id, body }) {
      const country = await Country.findById(id)
      if (!country) throw notFound('Country not found')
      country.name = body.name
      await country.save()
      await audit('country', 'updated', { organisationId, projectId, actor, objectId: country._id })
      return toCountry(country)
    },
    async deleteCountry({ id }) {
      await assertDeletable('country', id)
      const result = await Country.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Country not found')
      return { id, deleted: true }
    },

    async createSal({ organisationId, projectId, actor, body }) {
      const country = await Country.findById(body.countryId)
      if (!country) throw badRequest('countryId does not exist in this project')
      const sal = await Sal.create({ countryId: body.countryId, code: body.code })
      await audit('sal', 'created', { organisationId, projectId, actor, objectId: sal._id })
      return toSal(sal)
    },
    async deleteSal({ id }) {
      await assertDeletable('sal', id)
      const result = await Sal.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('SAL not found')
      return { id, deleted: true }
    },

    async createCampus({ organisationId, projectId, actor, body }) {
      const sal = await Sal.findById(body.salId)
      if (!sal) throw badRequest('salId does not exist in this project')
      const campus = await Campus.create({ salId: body.salId, code: body.code })
      await audit('campus', 'created', { organisationId, projectId, actor, objectId: campus._id })
      return toCampus(campus)
    },
    async deleteCampus({ id }) {
      await assertDeletable('campus', id)
      const result = await Campus.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Campus not found')
      return { id, deleted: true }
    },

    async createBuilding({ organisationId, projectId, actor, body }) {
      const campus = await Campus.findById(body.campusId)
      if (!campus) throw badRequest('campusId does not exist in this project')
      const building = await Building.create({ campusId: body.campusId, code: body.code, name: body.name, siteSize: body.siteSize })
      await audit('building', 'created', { organisationId, projectId, actor, objectId: building._id })
      return toBuilding(building)
    },
    async updateBuilding({ organisationId, projectId, actor, id, body }) {
      const building = await Building.findById(id)
      if (!building) throw notFound('Building not found')
      if (body.name !== undefined) building.name = body.name
      if (body.siteSize !== undefined) building.siteSize = body.siteSize
      await building.save()
      await audit('building', 'updated', { organisationId, projectId, actor, objectId: building._id })
      return toBuilding(building)
    },
    async deleteBuilding({ id }) {
      await assertDeletable('building', id)
      const result = await Building.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Building not found')
      return { id, deleted: true }
    },

    async createWing({ organisationId, projectId, actor, body }) {
      const building = await Building.findById(body.buildingId)
      if (!building) throw badRequest('buildingId does not exist in this project')
      const wing = await Wing.create({ buildingId: body.buildingId, code: body.code, name: body.name, order: body.order })
      await audit('wing', 'created', { organisationId, projectId, actor, objectId: wing._id })
      return toWing(wing)
    },
    async deleteWing({ id }) {
      await assertDeletable('wing', id)
      const result = await Wing.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Wing not found')
      return { id, deleted: true }
    },

    async createFloor({ organisationId, projectId, actor, body }) {
      const building = await Building.findById(body.buildingId)
      if (!building) throw badRequest('buildingId does not exist in this project')
      if (body.wingId) {
        const wing = await Wing.findOne({ _id: body.wingId, buildingId: body.buildingId })
        if (!wing) throw badRequest('wingId does not exist on this building')
      }
      const floor = await Floor.create({ buildingId: body.buildingId, wingId: body.wingId ?? null, token: body.token, name: body.name, order: body.order })
      await audit('floor', 'created', { organisationId, projectId, actor, objectId: floor._id })
      return toFloor(floor)
    },
    async updateFloor({ organisationId, projectId, actor, id, body }) {
      const floor = await Floor.findById(id)
      if (!floor) throw notFound('Floor not found')
      if (body.token !== undefined) floor.token = body.token
      if (body.name !== undefined) floor.name = body.name
      if (body.order !== undefined) floor.order = body.order
      await floor.save()
      await audit('floor', 'updated', { organisationId, projectId, actor, objectId: floor._id })
      return toFloor(floor)
    },
    async deleteFloor({ id }) {
      await assertDeletable('floor', id)
      const result = await Floor.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Floor not found')
      return { id, deleted: true }
    },

    async createRoom({ organisationId, projectId, actor, body }) {
      const floor = await Floor.findById(body.floorId)
      if (!floor) throw badRequest('floorId does not exist in this project')
      const room = await Room.create({ floorId: body.floorId, buildingId: floor.buildingId, code: body.code, name: body.name ?? null, isMainRoom: body.isMainRoom })
      await audit('room', 'created', { organisationId, projectId, actor, objectId: room._id })
      return toRoom(room)
    },
    async updateRoom({ organisationId, projectId, actor, id, body }) {
      const room = await Room.findById(id)
      if (!room) throw notFound('Room not found')
      if (body.name !== undefined) room.name = body.name
      if (body.isMainRoom !== undefined) room.isMainRoom = body.isMainRoom
      await room.save()
      await audit('room', 'updated', { organisationId, projectId, actor, objectId: room._id })
      return toRoom(room)
    },
    async deleteRoom({ id }) {
      await assertDeletable('room', id)
      const result = await Room.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Room not found')
      return { id, deleted: true }
    },

    async createRack({ organisationId, projectId, actor, body }) {
      const room = await Room.findById(body.roomId)
      if (!room) throw badRequest('roomId does not exist in this project')
      await assertAllowedHeight(organisationId, body.heightU)
      const rack = await Rack.create({ roomId: body.roomId, buildingId: room.buildingId, code: body.code, heightU: body.heightU })
      await audit('rack', 'created', { organisationId, projectId, actor, objectId: rack._id })
      return toRack(rack)
    },
    async updateRack({ organisationId, projectId, actor, id, body }) {
      const rack = await Rack.findById(id)
      if (!rack) throw notFound('Rack not found')
      if (body.heightU !== undefined) {
        await assertAllowedHeight(organisationId, body.heightU)
        rack.heightU = body.heightU
      }
      await rack.save()
      await audit('rack', 'updated', { organisationId, projectId, actor, objectId: rack._id })
      return toRack(rack)
    },
    async deleteRack({ id }) {
      await assertDeletable('rack', id)
      const result = await Rack.deleteOne({ _id: id })
      if (!result.deletedCount) throw notFound('Rack not found')
      return { id, deleted: true }
    },

    // Scoped to the current project by the tenant plugin via the request context.
    async listTree() {
      const [countries, sals, campuses, buildings, wings, floors, rooms, racks] = await Promise.all([
        Country.find().lean(),
        Sal.find().lean(),
        Campus.find().lean(),
        Building.find().lean(),
        Wing.find().lean(),
        Floor.find().lean(),
        Room.find().lean(),
        Rack.find().lean(),
      ])
      return {
        countries: countries.map(toCountry),
        sals: sals.map(toSal),
        campuses: campuses.map(toCampus),
        buildings: buildings.map(toBuilding),
        wings: wings.map(toWing),
        floors: floors.map(toFloor),
        rooms: rooms.map(toRoom),
        racks: racks.map(toRack),
      }
    },

    // Validates with the shared pure plan builder, then creates everything
    // that does not already exist (by natural code), in one transaction.
    async bulkImport({ organisationId, projectId, actor, rows }) {
      const plan = buildHierarchyImportPlan(rows)
      if (!plan.ok) throw badRequest('Some rows did not validate', { rowErrors: plan.rowErrors })

      return withTransaction(async (session) => {
        const counts = await applyHierarchyPlan(plan, session)
        await recordAudit({
          organisationId,
          projectId,
          actor: userActor(actor.userId, actor.role),
          action: 'hierarchy.import.completed',
          objectType: 'Project',
          objectId: projectId,
          changeType: 'import',
          source: 'import',
          changes: [],
          session,
        })
        return counts
      })
    },
  }
}

// Creates whatever a plan (shared/src/hierarchyImport.js#buildHierarchyImportPlan
// output) does not already have, by natural code, inside the caller's
// transaction. Reused by bulkImport above and by the project wizard
// (organisations/service.js#createProject), which validates and builds the
// same kind of plan from its own Structure step before calling this. Must run
// inside a tenant scope that already has the right projectId (ambient from
// the request, or opened by the caller for a brand-new project).
export async function applyHierarchyPlan(plan, session) {
  assertPlanReferencesResolve(plan)
  const countryIds = new Map()
  for (const c of plan.countries) {
    const doc = await findOrCreate(Country, { code: c.code }, { code: c.code, name: c.name }, session)
    countryIds.set(c.code, doc._id)
  }
  const salIds = new Map()
  for (const s of plan.sals) {
    const countryId = countryIds.get(s.countryCode)
    const doc = await findOrCreate(Sal, { countryId, code: s.code }, { countryId, code: s.code }, session)
    salIds.set(`${s.countryCode}|${s.code}`, doc._id)
  }
  const campusIds = new Map()
  for (const c of plan.campuses) {
    const salId = salIds.get(`${c.countryCode}|${c.salCode}`)
    const doc = await findOrCreate(Campus, { salId, code: c.code }, { salId, code: c.code }, session)
    campusIds.set(`${c.countryCode}|${c.salCode}|${c.code}`, doc._id)
  }
  const buildingIds = new Map()
  for (const b of plan.buildings) {
    const campusId = campusIds.get(`${b.countryCode}|${b.salCode}|${b.campusCode}`)
    const doc = await findOrCreate(Building, { campusId, code: b.code }, { campusId, code: b.code, name: b.name }, session)
    buildingIds.set(`${b.countryCode}|${b.salCode}|${b.campusCode}|${b.code}`, doc._id)
  }
  for (const w of plan.wings) {
    const buildingId = buildingIds.get(`${w.countryCode}|${w.salCode}|${w.campusCode}|${w.buildingCode}`)
    await findOrCreate(Wing, { buildingId, code: w.code }, { buildingId, code: w.code, name: w.name, order: 0 }, session)
  }
  return { countries: plan.countries.length, sals: plan.sals.length, campuses: plan.campuses.length, buildings: plan.buildings.length, wings: plan.wings.length }
}

// Every child in a plan must name a parent that is also in the plan (manual
// entry and CSV import both build this shape without foreign keys yet — this
// is where a reference to a country/SAL/campus/building that was never
// included gets caught, before anything is created).
function assertPlanReferencesResolve(plan) {
  const countryCodes = new Set(plan.countries.map((c) => c.code))
  for (const s of plan.sals) {
    if (!countryCodes.has(s.countryCode)) throw badRequest(`SAL ${s.code} names a country not in this submission: ${s.countryCode}`)
  }
  const salKeys = new Set(plan.sals.map((s) => `${s.countryCode}|${s.code}`))
  for (const c of plan.campuses) {
    if (!salKeys.has(`${c.countryCode}|${c.salCode}`)) throw badRequest(`Campus ${c.code} names a SAL not in this submission: ${c.salCode}`)
  }
  const campusKeys = new Set(plan.campuses.map((c) => `${c.countryCode}|${c.salCode}|${c.code}`))
  for (const b of plan.buildings) {
    if (!campusKeys.has(`${b.countryCode}|${b.salCode}|${b.campusCode}`)) throw badRequest(`Building ${b.code} names a campus not in this submission: ${b.campusCode}`)
  }
  const buildingKeys = new Set(plan.buildings.map((b) => `${b.countryCode}|${b.salCode}|${b.campusCode}|${b.code}`))
  for (const w of plan.wings ?? []) {
    if (!buildingKeys.has(`${w.countryCode}|${w.salCode}|${w.campusCode}|${w.buildingCode}`)) throw badRequest(`Wing ${w.code} names a building not in this submission: ${w.buildingCode}`)
  }
}

async function findOrCreate(Model, filter, doc, session) {
  const existing = await Model.findOne(filter).session(session)
  if (existing) return existing
  const [created] = await Model.create([doc], { session })
  return created
}

async function assertAllowedHeight(organisationId, heightU) {
  const org = await Organisation.findById(organisationId).lean()
  const allowed = new Set([...(org?.settings?.standardHeightsU ?? []), ...(org?.settings?.customHeightsU ?? [])])
  if (!allowed.has(heightU)) throw badRequest(`heightU must be one of: ${[...allowed].sort((a, b) => a - b).join(', ')}`)
}

const toCountry = (c) => ({ id: String(c._id), code: c.code, name: c.name })
const toSal = (s) => ({ id: String(s._id), countryId: String(s.countryId), code: s.code })
const toCampus = (c) => ({ id: String(c._id), salId: String(c.salId), code: c.code })
const toBuilding = (b) => ({ id: String(b._id), campusId: String(b.campusId), code: b.code, name: b.name, siteSize: b.siteSize })
const toWing = (w) => ({ id: String(w._id), buildingId: String(w.buildingId), code: w.code, name: w.name, order: w.order })
const toFloor = (f) => ({ id: String(f._id), buildingId: String(f.buildingId), wingId: f.wingId ? String(f.wingId) : null, token: f.token, name: f.name, order: f.order })
const toRoom = (r) => ({ id: String(r._id), floorId: String(r.floorId), buildingId: String(r.buildingId), code: r.code, name: r.name, isMainRoom: r.isMainRoom })
const toRack = (r) => ({ id: String(r._id), roomId: String(r.roomId), buildingId: String(r.buildingId), code: r.code, heightU: r.heightU })
