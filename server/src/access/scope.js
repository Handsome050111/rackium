import mongoose from 'mongoose'
import { scopeCoversBuilding, scopeCoversSal } from '@rackium/shared/scope.js'
import { Building } from '../models/building.js'
import { Campus } from '../models/campus.js'
import { Sal } from '../models/sal.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { rolesIn } from '../organisations/service.js'
import { membershipsForUser } from '../auth/service.js'
import { buildingsWithSal } from '../hierarchy/lookup.js'
import { notFound } from '../http/errors.js'

// Membership scope (DATA-MODEL §1.6, D5) — the one place the server decides
// what part of a project a caller may see and act on. A project membership
// may be limited to countries, SALs or buildings. The Org Admin, an unscoped
// project member and a View As session see the whole project. Anything out
// of scope is a 404, indistinguishable from not there.

// The caller's roles and scopes in the current project, worked out once per request.
export async function callerAccess(req) {
  if (req.access) return req.access
  let access
  if (req.viewAsActive) {
    access = { roles: req.roles ?? [], scopes: [] }
  } else {
    const { roles } = await rolesIn(req.user._id, req.org.id, req.project.id)
    const membership = (await membershipsForUser(req.user._id)).find(
      (m) => m.level === 'project' && String(m.projectId) === String(req.project.id) && String(m.organisationId) === String(req.org.id)
    )
    access = { roles, scopes: membershipScopes(membership, roles.includes('org_admin')) }
  }
  req.access = access
  return access
}

// The scopes that apply to a project membership: none for an Org Admin.
export function membershipScopes(membership, isOrgAdmin) {
  return isOrgAdmin ? [] : membership?.scopes ?? []
}

// What a scope list covers among a project's buildings and SALs
// (buildingsWithSal shape). Items that sit in a building are in scope when
// the building is; SAL-level items (no building yet) when the SAL is.
export function scopeView(scopes, { buildings, sals }) {
  const unrestricted = !scopes || scopes.length === 0
  const inBuildings = buildings.filter((b) => scopeCoversBuilding(scopes, b))
  const inSals = sals.filter((s) => scopeCoversSal(scopes, s))
  const buildingIds = new Set(inBuildings.map((b) => b.id))
  const salIds = new Set(inSals.map((s) => s.id))
  const coversBuilding = (id) => unrestricted || buildingIds.has(String(id))
  const coversSal = (id) => unrestricted || salIds.has(String(id))
  return {
    unrestricted,
    buildings: inBuildings,
    sals: inSals,
    coversBuilding,
    coversSal,
    coversItem: ({ buildingId, salId }) => (buildingId ? coversBuilding(buildingId) : coversSal(salId)),
  }
}

// The caller's scope view of the current project (cached per request).
export async function projectScope(req) {
  if (req.scopeView) return req.scopeView
  const { scopes } = await callerAccess(req)
  req.scopeView = scopeView(scopes, await buildingsWithSal())
  return req.scopeView
}

// A building with the ids its scope is matched on.
export async function buildingWithScopeIds(buildingId, session = null) {
  if (!mongoose.isValidObjectId(buildingId)) return null
  const building = await Building.findById(buildingId).session(session).lean()
  if (!building) return null
  const campus = await Campus.findById(building.campusId).session(session).lean()
  const sal = campus ? await Sal.findById(campus.salId).session(session).lean() : null
  return {
    id: String(building._id),
    code: building.code,
    name: building.name,
    campusId: String(building.campusId),
    campusCode: campus?.code ?? null,
    salId: sal ? String(sal._id) : null,
    salCode: sal?.code ?? null,
    countryId: sal ? String(sal.countryId) : null,
  }
}

// The building, if the caller may see it; otherwise a 404.
export async function requireBuilding(req, buildingId, session = null) {
  const building = await buildingWithScopeIds(buildingId, session)
  if (!building) throw notFound('Building not found')
  const { scopes } = await callerAccess(req)
  if (!scopeCoversBuilding(scopes, building)) throw notFound('Building not found')
  return building
}

export async function requireFloor(req, floorId, session = null) {
  const floor = mongoose.isValidObjectId(floorId) ? await Floor.findById(floorId).session(session).lean() : null
  if (!floor) throw notFound('Floor not found')
  return { floor, building: await requireBuilding(req, floor.buildingId, session) }
}

export async function requireRoom(req, roomId, session = null) {
  const room = mongoose.isValidObjectId(roomId) ? await Room.findById(roomId).session(session).lean() : null
  if (!room) throw notFound('Room not found')
  return { room, building: await requireBuilding(req, room.buildingId, session) }
}

export async function requireRack(req, rackId, session = null) {
  const rack = mongoose.isValidObjectId(rackId) ? await Rack.findById(rackId).session(session).lean() : null
  if (!rack) throw notFound('Rack not found')
  return { rack, building: await requireBuilding(req, rack.buildingId, session) }
}

// Buildings of the project the caller may see (with scope ids).
export async function buildingsInScope(req) {
  const { scopes } = await callerAccess(req)
  const all = await Building.find().lean()
  const out = []
  for (const b of all) {
    const withIds = await buildingWithScopeIds(b._id)
    if (scopeCoversBuilding(scopes, withIds)) out.push(withIds)
  }
  return out
}
