import mongoose from 'mongoose'
import { dguvStatus, dguvObligation } from '@rackium/shared/deployment.js'
import { localDate } from '@rackium/shared/timeZone.js'
import { Device } from '../models/device.js'
import { Connection } from '../models/connection.js'
import { LldDesign } from '../models/lldDesign.js'
import { SerialRegistry } from '../models/serialRegistry.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { DeploymentException } from '../models/deploymentException.js'
import { recordAudit, systemActor } from '../audit/audit.js'
import { projectCatalogue } from '../catalogue/service.js'
import { orgTimeSettings } from '../organisations/timeSettings.js'

const INSTALLED = ['installed', 'configured', 'tested', 'accepted', 'in_service', 'maintenance']
const lower = (s) => String(s ?? '').trim().toLowerCase()

// An approved change request re-creates the frozen LLD under the ids it
// keeps (M5a). A device or connection it removed leaves an installation
// record behind: retired here, in the same transaction — its serial leaves
// the project registry, its MAC is freed, its open exceptions close, and the
// audit (shown in the CMDB change log) says what was released and why.
// `labels`: device id → hostname/label, read before the promotion.
export async function retireRemovedRecords({ organisationId, projectId, buildingId, reason, labels = new Map(), session }) {
  const [devices, connections] = await Promise.all([
    Device.find({ buildingId, layer: 'lld' }, { _id: 1 }).session(session).lean(),
    Connection.find({ buildingId, layer: 'lld' }, { _id: 1 }).session(session).lean(),
  ])
  const liveDevices = new Set(devices.map((d) => String(d._id)))
  const liveConnections = new Set(connections.map((c) => String(c._id)))
  const now = new Date()
  const out = { devices: 0, connections: 0 }
  const records = await DeploymentRecord.find({ buildingId, status: { $ne: 'retired' } }).session(session).lean()
  for (const rec of records) {
    if (liveDevices.has(String(rec.deviceId))) continue
    const label = labels.get(String(rec.deviceId)) ?? 'device'
    const serial = rec.installation?.serial ?? null
    const mac = rec.installation?.mac ?? null
    await SerialRegistry.deleteMany({ ownerType: 'device', ownerId: rec.deviceId }, { session })
    await DeploymentRecord.updateOne(
      { _id: rec._id },
      {
        $set: { status: 'retired', retired: { at: now, reason, label, previousStatus: rec.status, serial, mac }, 'installation.serial': null, 'installation.mac': null, updatedAt: now },
        $push: { history: { status: 'retired', by: null, byName: null, at: now, note: reason } },
        $inc: { version: 1 },
      },
      { session }
    )
    await DeploymentException.updateMany({ deviceId: rec.deviceId, status: 'open' }, { $set: { status: 'superseded', closedAt: now } }, { session })
    await recordAudit({
      organisationId,
      projectId,
      buildingId,
      phaseKey: 'cmdb',
      actor: systemActor(),
      action: 'deployment.record.retired',
      objectType: 'Device',
      objectId: String(rec.deviceId),
      changeType: 'system',
      source: 'system',
      comment: `${label} removed from the design by ${reason}${serial ? `; serial ${serial} released` : ''}${mac ? `; MAC ${mac} released` : ''}`,
      changes: [
        { objectType: 'Device', objectId: String(rec.deviceId), field: 'status', before: rec.status, after: 'retired' },
        ...(serial ? [{ objectType: 'Device', objectId: String(rec.deviceId), field: 'installation.serial', before: serial, after: null }] : []),
        ...(mac ? [{ objectType: 'Device', objectId: String(rec.deviceId), field: 'installation.mac', before: mac, after: null }] : []),
      ],
      session,
    })
    out.devices += 1
  }
  const connRecords = await ConnectionRecord.find({ buildingId, status: { $ne: 'retired' } }).session(session).lean()
  for (const rec of connRecords) {
    if (liveConnections.has(String(rec.connectionId))) continue
    await ConnectionRecord.updateOne({ _id: rec._id }, { $set: { status: 'retired', retiredAt: now, updatedAt: now } }, { session })
    await DeploymentException.updateMany({ connectionId: rec.connectionId, status: 'open' }, { $set: { status: 'superseded', closedAt: now } }, { session })
    await recordAudit({ organisationId, projectId, buildingId, phaseKey: 'cmdb', actor: systemActor(), action: 'deployment.connection.retired', objectType: 'Connection', objectId: String(rec.connectionId), changeType: 'system', source: 'system', comment: `Connection removed from the design by ${reason}; cable(s) ${(rec.installed?.segments ?? []).map((s) => s.cableId).filter(Boolean).join(', ') || '—'}`, changes: [{ objectType: 'Connection', objectId: String(rec.connectionId), field: 'status', before: rec.status, after: 'retired' }], session })
    out.connections += 1
  }
  return out
}

// The dashboard's connection count (M6a review): the building's designed
// connections (the LLD once started, else the HLD) and how many are
// installed, tested and accepted from their deployment records.
export async function connectionCounts(buildingId) {
  const lld = await LldDesign.findOne({ buildingId }, { _id: 1 }).lean()
  const conns = await Connection.find({ buildingId, layer: lld ? 'lld' : { $in: [null, 'hld'] } }, { _id: 1 }).lean()
  const ids = conns.map((c) => c._id)
  const records = lld ? await ConnectionRecord.find({ connectionId: { $in: ids }, status: { $ne: 'retired' } }, { status: 1 }).lean() : []
  const count = (statuses) => records.filter((r) => statuses.includes(r.status)).length
  return { designed: ids.length, installed: count(['installed', 'tested', 'faulty', 'accepted']), tested: count(['tested', 'accepted']), accepted: count(['accepted']) }
}

// Installed, mains-powered devices of a building (live design devices only),
// each with its DGUV status on the organisation's local date. Runs in the
// project's tenant scope.
export async function dguvDevices({ organisationId, projectId, buildingId = null, now = new Date() }) {
  const filter = { status: { $in: INSTALLED } }
  if (buildingId) filter.buildingId = new mongoose.Types.ObjectId(String(buildingId))
  const records = await DeploymentRecord.find(filter).lean()
  if (!records.length) return []
  const devices = new Map((await Device.find({ _id: { $in: records.map((r) => r.deviceId) }, layer: 'lld' }, { hostname: 1, label: 1, catalogueKey: 1, buildingId: 1 }).lean()).map((d) => [String(d._id), d]))
  const catalogue = new Map((await projectCatalogue(projectId)).map((i) => [lower(i.key), i]))
  const { timeZone, dguv } = await orgTimeSettings(organisationId)
  const today = localDate(now, timeZone)
  const out = []
  for (const rec of records) {
    const device = devices.get(String(rec.deviceId))
    if (!device) continue
    // In DGUV scope: the model requires it (or is mains-powered), or the
    // device was made to require it. An exempted device stays listed, as
    // exempt with its reason, and is never overdue or reminded.
    const obligation = dguvObligation(catalogue.get(lower(device.catalogueKey)), rec.dguvOverride)
    if (!obligation.required && !obligation.exempt) continue
    const label = device.hostname ?? device.label ?? 'device'
    if (obligation.exempt) {
      out.push({ rec, device, label, inspected: Boolean(rec.dguv?.lastInspectionDate), exempt: true, exemptReason: obligation.reason, status: null })
      continue
    }
    const inspected = Boolean(rec.dguv?.lastInspectionDate)
    out.push({ rec, device, label, inspected, exempt: false, status: inspected ? dguvStatus({ lastInspectionDate: rec.dguv.lastInspectionDate, mainsPowered: true }, today, dguv) : null })
  }
  return out
}

// The dashboard's DGUV summary for one building (`total` counts the devices
// to inspect; exempt ones are counted on their own).
export async function dguvSummary(args) {
  const list = await dguvDevices(args)
  const summary = { total: 0, valid: 0, expiring_soon: 0, expiring: 0, overdue: 0, notInspected: 0, exempt: 0 }
  for (const d of list) {
    if (d.exempt) summary.exempt += 1
    else if (!d.inspected) summary.notInspected += 1
    else summary[d.status.status] += 1
    if (!d.exempt) summary.total += 1
  }
  return summary
}
