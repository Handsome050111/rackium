import mongoose from 'mongoose'
import { rollup, devicesOf, stateOf, DGUV_LEVELS, DGUV_STATE_LABEL } from '@rackium/shared/dguvRollup.js'
import { toCsv } from '@rackium/shared/documents/model.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { Country } from '../models/country.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Device } from '../models/device.js'
import { dguvDevices } from '../deployment/asBuilt.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'
import { projectScope, requireBuilding, requireFloor, requireRoom, requireRack } from '../access/scope.js'
import { notFound } from '../http/errors.js'

// DGUV V3 compliance dashboards (DATA-MODEL §5.16; M7a-2): the rollup over
// the installed mains-powered devices of the buildings in the caller's
// scope, on the organisation's local date with its thresholds; a node out of
// scope is a 404, as its own screen.

const str = (v) => (v == null ? null : String(v))

// Every scoped device with its place (rack → room → floor → building → SAL →
// country) and the names shown for each level.
async function scopedItems(req, now) {
  const scope = await projectScope(req)
  const list = (await dguvDevices({ organisationId: req.org.id, projectId: req.project.id, now })).filter((x) => scope.coversBuilding(x.rec.buildingId))
  const devices = new Map((await Device.find({ _id: { $in: list.map((x) => x.rec.deviceId) } }, { rackId: 1, roomId: 1 }).lean()).map((d) => [String(d._id), d]))
  const rackIds = new Set()
  for (const x of list) {
    const r = x.rec.installation?.rackId ?? devices.get(String(x.rec.deviceId))?.rackId
    if (r) rackIds.add(String(r))
  }
  const racks = new Map((await Rack.find({ _id: { $in: [...rackIds] } }, { code: 1, roomId: 1 }).lean()).map((r) => [String(r._id), r]))
  const roomIds = new Set([...racks.values()].map((r) => String(r.roomId)))
  for (const d of devices.values()) if (d.roomId) roomIds.add(String(d.roomId))
  const rooms = new Map((await Room.find({ _id: { $in: [...roomIds] } }, { code: 1, name: 1, floorId: 1 }).lean()).map((r) => [String(r._id), r]))
  const floors = new Map((await Floor.find({ _id: { $in: [...new Set([...rooms.values()].map((r) => String(r.floorId)))] } }, { token: 1, name: 1 }).lean()).map((f) => [String(f._id), f]))
  const buildings = new Map(scope.buildings.map((b) => [b.id, b]))
  const countries = new Map((await Country.find({}, { code: 1, name: 1 }).lean()).map((c) => [String(c._id), c]))
  const names = { country: new Map(), sal: new Map(), building: new Map(), floor: new Map(), room: new Map(), rack: new Map(), device: new Map() }
  const items = list.map((x) => {
    const device = devices.get(String(x.rec.deviceId))
    const rackId = str(x.rec.installation?.rackId ?? device?.rackId)
    const rack = rackId ? racks.get(rackId) : null
    const roomId = str(rack?.roomId ?? device?.roomId)
    const room = roomId ? rooms.get(roomId) : null
    const floorId = str(room?.floorId)
    const floor = floorId ? floors.get(floorId) : null
    const building = buildings.get(String(x.rec.buildingId))
    const country = building?.countryId ? countries.get(building.countryId) : null
    const deviceId = String(x.rec.deviceId)
    names.device.set(deviceId, x.label)
    if (rack) names.rack.set(rackId, rack.code)
    if (room) names.room.set(roomId, room.name ? `${room.code} — ${room.name}` : room.code)
    if (floor) names.floor.set(floorId, `${floor.token} — ${floor.name}`)
    if (building) names.building.set(building.id, `${building.code} — ${building.name}`)
    if (building?.salId) names.sal.set(building.salId, building.salCode)
    if (country) names.country.set(String(country._id), `${country.name} (${country.code})`)
    return {
      deviceId,
      label: x.label,
      rackId,
      roomId,
      floorId,
      buildingId: String(x.rec.buildingId),
      buildingCode: building?.code ?? null,
      salId: building?.salId ?? null,
      countryId: building?.countryId ?? null,
      inspected: x.inspected,
      status: x.status?.status ?? null,
      dueDate: x.status?.dueDate ?? null,
      daysRemaining: x.status?.daysRemaining ?? null,
      lastInspectionDate: x.rec.dguv?.lastInspectionDate ?? null,
      inspector: x.rec.dguv?.inspector ?? null,
      names: { rack: rack?.code ?? null, room: room ? names.room.get(roomId) : null, floor: floor ? names.floor.get(floorId) : null },
    }
  })
  return { items, names }
}

// A node the caller may open: its own screen's check, or (SAL, country,
// device) at least one scoped device under it; otherwise 404.
async function requireNode(req, level, id, items) {
  if (!DGUV_LEVELS.includes(level)) throw notFound('Not found')
  if (level === 'project') return
  if (!id || !mongoose.isValidObjectId(id)) throw notFound('Not found')
  if (level === 'building') return void (await requireBuilding(req, id))
  if (level === 'floor') return void (await requireFloor(req, id))
  if (level === 'room') return void (await requireRoom(req, id))
  if (level === 'rack') return void (await requireRack(req, id))
  const field = { sal: 'salId', country: 'countryId', device: 'deviceId' }[level]
  if (!items.some((i) => i[field] === id)) throw notFound('Not found')
}

const deviceRow = (i) => ({
  deviceId: i.deviceId,
  label: i.label,
  buildingId: i.buildingId,
  buildingCode: i.buildingCode,
  floor: i.names.floor,
  room: i.names.room,
  rack: i.names.rack,
  state: stateOf(i),
  stateLabel: DGUV_STATE_LABEL[stateOf(i)],
  lastInspectionDate: i.lastInspectionDate,
  dueDate: i.dueDate,
  daysRemaining: i.daysRemaining,
  inspector: i.inspector,
})

export function createDguvService() {
  async function load(req, { level = 'project', id = null }, now) {
    const { items, names } = await scopedItems(req, now)
    await requireNode(req, level, id, items)
    return { items, names }
  }
  return {
    async view(req, { level = 'project', id = null }, { now = new Date() } = {}) {
      const { items, names } = await load(req, { level, id }, now)
      const { timeZone, dguv } = await orgTimeSettings(req.org.id)
      const node = rollup(items, level, id)
      // The way back up: the node's ancestors as the items under it place them.
      const sample = items.find((i) => level === 'project' || i[{ country: 'countryId', sal: 'salId', building: 'buildingId', floor: 'floorId', room: 'roomId', rack: 'rackId', device: 'deviceId' }[level]] === id)
      const path = [{ level: 'project', id: null, name: req.project.doc?.name ?? 'Project' }]
      for (const l of ['country', 'sal', 'building', 'floor', 'room', 'rack', 'device']) {
        if (DGUV_LEVELS.indexOf(l) > DGUV_LEVELS.indexOf(level) || !sample) break
        const lid = sample[{ country: 'countryId', sal: 'salId', building: 'buildingId', floor: 'floorId', room: 'roomId', rack: 'rackId', device: 'deviceId' }[l]]
        if (lid) path.push({ level: l, id: lid, name: names[l].get(lid) ?? '—' })
      }
      return {
        today: localDate(now, timeZone),
        timeZone,
        thresholds: dguv,
        node: { level, id, name: path.at(-1).name, counts: node.counts, worst: node.worst, compliantPct: node.compliantPct },
        path,
        childLevel: node.childLevel,
        rows: node.rows.map((r) => ({ ...r, name: r.id ? names[r.level].get(r.id) ?? '—' : `No ${r.level}` })),
      }
    },

    async devices(req, { level = 'project', id = null, status = null }, { now = new Date() } = {}) {
      const { items } = await load(req, { level, id }, now)
      return { devices: devicesOf(items, level, id, status).map(deviceRow) }
    },

    async csv(req, { level = 'project', id = null, status = null }, { now = new Date() } = {}) {
      const { devices } = await this.devices(req, { level, id, status }, { now })
      const header = ['Building', 'Floor', 'Room', 'Rack', 'Device', 'Status', 'Last inspection', 'Due date', 'Days remaining', 'Inspector']
      return toCsv([header, ...devices.map((d) => [d.buildingCode, d.floor, d.room, d.rack, d.label, d.stateLabel, d.lastInspectionDate, d.dueDate, d.daysRemaining, d.inspector])])
    },
  }
}
