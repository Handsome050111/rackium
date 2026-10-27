import mongoose from 'mongoose'
import { deviceDisplayName } from '@rackium/shared/deviceName.js'
import { Connection } from '../models/connection.js'
import { PortOccupancy } from '../models/portOccupancy.js'
import { Device } from '../models/device.js'
import { User } from '../models/user.js'
import { AppError } from '../http/errors.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The save-time conflict check (addendum v2.3 Q2) on the HLD and LLD: a
// design write names the revision it was loaded at, and any newer one
// refuses it (stale_revision, never a silent overwrite). When the save
// touches a port that someone changed since — the connection it edits, or
// the one now holding a port it asks for — the refusal says which port and
// who: "Port Te1/1/1 on <device> was changed by <user>, reload".
// `ends`: the { deviceId, portId } pairs the save asks for.
export async function namePortConflict(err, { layer, baseRevision, connectionId = null, ends = [] }) {
  if (!(err instanceof AppError) || err.code !== 'stale_revision') return err
  const wanted = ends.filter((e) => e?.deviceId && e?.portId && mongoose.isValidObjectId(e.deviceId))
  const holders = new Map()
  for (const e of wanted) {
    const row = await PortOccupancy.findOne({ layer, deviceId: oid(e.deviceId), portKey: { $regex: `^${escape(String(e.portId).toLowerCase())}(#|$)` }, connectionId: { $ne: null } }, { connectionId: 1 }).lean()
    if (row) holders.set(String(row.connectionId), e)
  }
  const ids = [...new Set([...(connectionId ? [String(connectionId)] : []), ...holders.keys()])].filter((x) => mongoose.isValidObjectId(x))
  if (!ids.length) return err
  const changed = (await Connection.find({ _id: { $in: ids.map(oid) }, 'edited.layer': layer, 'edited.revision': { $gt: baseRevision } }).lean())[0]
  if (!changed) return err
  // The port named: the one asked for that this connection holds, else its source port.
  const end = holders.get(String(changed._id)) ?? { deviceId: changed.source?.deviceId, portId: changed.source?.portId }
  const [device, user] = await Promise.all([end.deviceId ? Device.findById(end.deviceId, { hostname: 1, label: 1, existingLabel: 1, model: 1 }).lean() : null, changed.updatedBy ? User.findById(changed.updatedBy, { name: 1, email: 1 }).lean() : null])
  const who = user?.name || user?.email || 'someone'
  const port = end.portId ? `Port ${end.portId} on ${deviceDisplayName(device ?? {}, 'device')}` : `The link from ${deviceDisplayName(device ?? {}, 'device')}`
  return new AppError(409, 'port_changed', `${port} was changed by ${who} since you loaded it — reload, then make your change again.`, { ...(err.details ?? {}), port: end.portId ?? null, deviceId: end.deviceId ? String(end.deviceId) : null, changedBy: who, connectionId: String(changed._id) })
}
