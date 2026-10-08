import { Building } from '../models/building.js'
import { Campus } from '../models/campus.js'
import { Sal } from '../models/sal.js'

// Building → SAL, which the schema reaches through the campus. Used wherever
// SAL-level things (Unassigned CMO devices and their blockers) meet a
// building. Runs in the caller's project scope. Sequential, not Promise.all:
// a transaction session must not run operations in parallel.
export async function buildingsWithSal(session = null) {
  const buildings = await Building.find().session(session).lean()
  const campuses = await Campus.find().session(session).lean()
  const sals = await Sal.find().session(session).lean()
  const salByCampus = new Map(campuses.map((c) => [String(c._id), String(c.salId)]))
  const salCode = new Map(sals.map((s) => [String(s._id), s.code]))
  return {
    buildings: buildings.map((b) => {
      const salId = salByCampus.get(String(b.campusId)) ?? null
      return { id: String(b._id), code: b.code, name: b.name, salId, salCode: salId ? salCode.get(salId) ?? null : null }
    }),
    sals: sals.map((s) => ({ id: String(s._id), code: s.code })),
  }
}

export async function salIdForBuilding(buildingId, session = null) {
  const building = await Building.findById(buildingId).session(session).lean()
  if (!building) return null
  const campus = await Campus.findById(building.campusId).session(session).lean()
  return campus ? String(campus.salId) : null
}
