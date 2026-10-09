import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { computeSuggestedLength, determineSituation, DEFAULT_STOCK_LENGTHS } from '@rackium/shared/cableLength.js'
import { findRoute } from '@rackium/shared/pathway.js'
import { findConflicts, computeFreeRU } from '@rackium/shared/rackValidation.js'
import { suggestNextCableId } from '@rackium/shared/cableId.js'
import { roleInfo, resolveRoleCodes } from '@rackium/shared/hldRoles.js'
import { buildHostname } from '@rackium/shared/naming.js'
import { summariseFindings } from '@rackium/shared/hldRules.js'
import { portKey, portsOf, isPatchPanel, validateLld, diffDesigns, reconcileWithHld } from '@rackium/shared/lldDesign.js'
import { canApproveSubmission } from '@rackium/shared/policy.js'
import { Device } from '../models/device.js'
import { Connection } from '../models/connection.js'
import { PortOccupancy } from '../models/portOccupancy.js'
import { CableIdRegistry } from '../models/cableIdRegistry.js'
import { LldDesign } from '../models/lldDesign.js'
import { DesignBranch } from '../models/designBranch.js'
import { HldDesign } from '../models/hldDesign.js'
import { DesignVersion } from '../models/designVersion.js'
import { Approval } from '../models/approval.js'
import { File } from '../models/file.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { RuState } from '../models/ruState.js'
import { Pathway } from '../models/pathway.js'
import { Country } from '../models/country.js'
import { Organisation } from '../models/organisation.js'
import { User } from '../models/user.js'
import { projectCatalogue } from '../catalogue/service.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const lower = (v) => String(v).trim().toLowerCase()
const MAIN = 'lld'
const layerOf = (branchId) => (branchId ? `lld:${branchId}` : MAIN)
const branchOfLayer = (layer) => (layer?.startsWith('lld:') ? layer.slice(4) : null)
const isLldLayer = (layer) => layer === MAIN || Boolean(layer?.startsWith('lld:'))

// --- Loading -----------------------------------------------------------------

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

async function orgSettings(session = null) {
  const org = await Organisation.findById(currentScope().organisationId, { 'settings.stockLengths': 1, 'settings.namingRoleCodes': 1 }).session(session).lean()
  const raw = org?.settings?.namingRoleCodes
  return { stockLengths: org?.settings?.stockLengths ?? DEFAULT_STOCK_LENGTHS, namingCodes: raw instanceof Map ? Object.fromEntries(raw) : raw ?? {} }
}

// Everything one design layer of a building needs: the survey's floors,
// rooms and racks, existing (surveyed) gear and active RU states, the
// layer's devices, connections and port occupancy, pathways and catalogue.
async function loadLayer(buildingId, layer, projectId, session = null) {
  const floors = await Floor.find({ buildingId }).sort({ order: 1 }).session(session).lean()
  const rooms = await Room.find({ buildingId }).sort({ code: 1 }).session(session).lean()
  const racks = await Rack.find({ buildingId }).sort({ code: 1 }).session(session).lean()
  const existing = await Device.find({ buildingId, origin: 'existing' }).session(session).lean()
  const devices = await Device.find({ buildingId, layer }).session(session).lean()
  const connections = await Connection.find({ buildingId, layer }).sort({ createdAt: 1 }).session(session).lean()
  const occupancy = await PortOccupancy.find({ layer, deviceId: { $in: [...existing, ...devices].map((d) => d._id) } }).session(session).lean()
  const ruStates = await RuState.find({ rackId: { $in: racks.map((r) => r._id) }, releasedAt: null }).session(session).lean()
  const pathwayRows = await Pathway.find().session(session).lean()
  const catalogue = await projectCatalogue(projectId)
  const settings = await orgSettings(session)
  const pathways = pathwayRows.map((p) => ({ fromRoomId: String(p.roomLowId), toRoomId: String(p.roomHighId), routeStatus: p.routeStatus, distanceM: p.distanceM ?? null }))
  return { floors, rooms, racks, existing, devices, connections, occupancy, ruStates, pathways, catalogue, settings }
}

function catalogueIndex(catalogue) {
  const byKey = new Map(catalogue.map((i) => [lower(i.key), i]))
  return {
    item: (key) => (key ? byKey.get(lower(key)) ?? null : null),
    optic: (code) => {
      const item = code ? byKey.get(lower(code)) : null
      return item?.kind === 'optic' ? item : null
    },
  }
}

function deviceView(d, cat, racks) {
  const item = cat.item(d.catalogueKey)
  const rack = d.rackId ? racks.find((r) => String(r._id) === String(d.rackId)) : null
  const info = roleInfo(d.role)
  return {
    id: String(d._id),
    origin: d.origin,
    layer: d.layer ?? null,
    hldRef: id(d.hldRef),
    role: d.role ?? null,
    roleLabel: info?.label ?? null,
    hostname: d.hostname ?? null,
    label: d.hostname ?? d.label ?? info?.label ?? 'Device',
    catalogueKey: d.catalogueKey ?? null,
    model: d.model ?? null,
    category: item?.category ?? d.category ?? null,
    isPanel: isPatchPanel(item, d),
    roomId: id(d.roomId ?? rack?.roomId),
    rackId: id(d.rackId),
    rackCode: rack?.code ?? null,
    ru: d.ru ?? null,
    heightU: item?.heightU ?? d.heightU ?? null,
    face: d.face ?? 'front',
    fullDepth: Boolean(item?.fullDepth ?? d.fullDepth),
    mounting: item?.mounting === '0U' || d.mounting === '0U' ? '0U' : 'rack',
    railSide: d.railSide ?? null,
    rackMounted: item ? Boolean(item.rackMounted) : Boolean(d.rackId),
    psuConfigured: d.psuConfigured ?? null,
    ports: portsOf(item, d).map((p) => ({ id: p.id, n: p.n, type: p.type, speed: p.speed ?? null, role: p.role })),
  }
}

// Brief §6.3 lengths for a connection, from where its ends now are: same
// rack (RU), same room (rack positions) or across rooms (pathway); rounded
// up to the organisation's stock table. Estimated when the route is.
function lengthOf(conn, deviceById, rackPos, pathways, stockLengths) {
  const a = deviceById.get(id(conn.source.deviceId))
  const b = deviceById.get(id(conn.dest.deviceId))
  const empty = { lengthM: null, lengthEstimated: true, customLengthRequired: false, suggestedM: null, situation: null, estimateReason: 'An end has no room yet', placementPending: true }
  if (!a?.roomId || !b?.roomId) return empty
  const situation = determineSituation({ sourceRackId: a.rackId, destRackId: b.rackId, sourceRoomId: a.roomId, destRoomId: b.roomId })
  const placementPending = (situation === 'same-rack' && (a.ru == null || b.ru == null)) || (situation === 'same-room' && (!a.rackId || !b.rackId))
  let estimateReason = null
  let distance
  if (situation === 'cross-room') {
    const route = findRoute(a.roomId, b.roomId, pathways)
    if (!route) estimateReason = 'No pathway recorded between these rooms'
    else if (route.routeStatus !== 'surveyed') estimateReason = 'Pathway route is marked Estimated'
    else if (route.distanceM == null) estimateReason = 'Surveyed pathway has no distance'
    distance = route?.distanceM ?? null
  }
  if (placementPending) return { ...empty, situation, estimateReason: 'Place both devices to calculate the length', lengthEstimated: false }
  const end = (d, extra = {}) => ({ rackId: d.rackId, roomId: d.roomId, ru: d.ru ?? 1, rackPosition: d.rackId ? rackPos.get(d.rackId) ?? 1 : 1, ...extra })
  const r = computeSuggestedLength({ source: end(a), dest: end(b, { surveyedPathwayLength: distance }), media: conn.media, stockLengths })
  return { lengthM: r.rawMeters, lengthEstimated: Boolean(estimateReason) || r.estimated, customLengthRequired: r.customLengthRequired, suggestedM: r.suggested, situation, estimateReason, placementPending: false }
}

function rackPositions(racks) {
  const out = new Map()
  const byRoom = new Map()
  for (const r of racks) byRoom.set(String(r.roomId), [...(byRoom.get(String(r.roomId)) ?? []), r])
  for (const list of byRoom.values()) list.forEach((r, i) => out.set(String(r._id), i + 1))
  return out
}

function connectionView(c, length) {
  const engineer = c.lengths?.engineerSelectedM ?? null
  return {
    id: String(c._id),
    layer: c.layer,
    hldRef: id(c.hldRef),
    source: { deviceId: String(c.source.deviceId), portId: c.source.portId ?? null },
    dest: { deviceId: String(c.dest.deviceId), portId: c.dest.portId ?? null },
    media: c.media,
    speed: c.speed,
    sourceSfpCode: c.sourceSfpCode ?? null,
    destSfpCode: c.destSfpCode ?? null,
    viaPatchPanel: Boolean(c.viaPatchPanel),
    cableId: c.cableId ?? null,
    hops: (c.hops ?? []).map((h) => ({ seq: h.seq, patchPanelId: String(h.patchPanelId), inPort: h.inPort, outPort: h.outPort, segmentCableId: h.segmentCableId ?? null, roomId: id(h.roomId), rackId: id(h.rackId), ru: h.ru ?? null })),
    lengths: { suggestedM: length.suggestedM, engineerSelectedM: engineer, effectiveM: engineer ?? length.suggestedM, installedM: c.lengths?.installedM ?? null },
    length,
    status: c.status,
  }
}

function inputs(data) {
  const cat = catalogueIndex(data.catalogue)
  const rackPos = rackPositions(data.racks)
  const views = [...data.existing, ...data.devices].map((d) => deviceView(d, cat, data.racks))
  const deviceById = new Map(views.map((d) => [d.id, d]))
  const connections = data.connections.map((c) => connectionView(c, lengthOf(c, deviceById, rackPos, data.pathways, data.settings.stockLengths)))
  const occupancyByDevice = new Map()
  for (const o of data.occupancy) occupancyByDevice.set(String(o.deviceId), [...(occupancyByDevice.get(String(o.deviceId)) ?? []), o])
  const ctx = {
    deviceById,
    itemOf: (d) => cat.item(d.catalogueKey),
    opticOf: (code) => cat.optic(code),
    patchPanelFreePorts: (roomId, kind) => {
      const panels = views.filter((d) => d.isPanel && d.roomId === String(roomId) && (kind === 'fibre') === d.ports.some((p) => /LC|SC|SFP/i.test(p.type)))
      if (!panels.length) return null
      return panels.reduce((sum, p) => sum + Math.max(0, p.ports.length - (occupancyByDevice.get(p.id) ?? []).filter((o) => o.portKey.endsWith('#front') || !o.portKey.includes('#')).length), 0)
    },
  }
  return { cat, rackPos, views, deviceById, connections, ctx, occupancyByDevice }
}

function runValidation(data) {
  const { views, connections, ctx } = inputs(data)
  const racks = data.racks.map((r) => ({ id: String(r._id), code: r.code, heightU: r.heightU, maxLoadKg: r.details?.maxLoadKg ?? null }))
  const findings = validateLld({ devices: views, connections: connections.map((c) => ({ ...c, ...c.length })), racks, cmoUnplaced: [] }, ctx)
  return { findings, summary: summariseFindings(findings) }
}

// A layer as a version snapshot: its devices and connections with every
// design field (placement, ports, hops, cable IDs, lengths).
function snapshotOf(data) {
  const { views, connections } = inputs(data)
  const own = new Set(data.devices.map((d) => String(d._id)))
  return {
    devices: views.filter((d) => own.has(d.id)),
    connections,
    raw: {
      devices: data.devices.map((d) => ({ _id: String(d._id), role: d.role ?? null, hostname: d.hostname ?? null, label: d.label ?? null, model: d.model ?? null, catalogueKey: d.catalogueKey ?? null, category: d.category ?? null, roomId: id(d.roomId), rackId: id(d.rackId), ru: d.ru ?? null, heightU: d.heightU ?? null, face: d.face ?? null, fullDepth: Boolean(d.fullDepth), mounting: d.mounting ?? null, psuConfigured: d.psuConfigured ?? null, hldRef: id(d.hldRef), salId: id(d.salId) })),
      connections: data.connections.map((c) => ({
        _id: String(c._id),
        hldRef: id(c.hldRef),
        originId: id(c.originId),
        source: { deviceId: String(c.source.deviceId), portId: c.source.portId ?? null },
        dest: { deviceId: String(c.dest.deviceId), portId: c.dest.portId ?? null },
        media: c.media,
        speed: c.speed,
        sourceSfpCode: c.sourceSfpCode ?? null,
        destSfpCode: c.destSfpCode ?? null,
        viaPatchPanel: Boolean(c.viaPatchPanel),
        cableId: c.cableId ?? null,
        hops: (c.hops ?? []).map((h) => ({ seq: h.seq, patchPanelId: String(h.patchPanelId), inPort: h.inPort, outPort: h.outPort, segmentCableId: h.segmentCableId ?? null, roomId: id(h.roomId), rackId: id(h.rackId), ru: h.ru ?? null })),
        lengths: { engineerSelectedM: c.lengths?.engineerSelectedM ?? null },
      })),
    },
  }
}

// --- Revisions ---------------------------------------------------------------------

async function staleError(doc, baseRevision, what) {
  const who = (await namesOf([doc?.lastEditedBy])).get(String(doc?.lastEditedBy)) ?? 'someone'
  return new AppError(409, 'stale_revision', `This ${what} was changed by ${who} since you loaded it (revision ${doc?.revision ?? 0}, yours ${baseRevision}). Reload to see the latest, then make your change again.`, {
    revision: doc?.revision ?? 0,
    lastEditedBy: who,
    lastEditedAt: doc?.lastEditedAt ?? null,
  })
}

// The main LLD or an open branch: claims the next revision or refuses.
async function claim({ buildingId, branchId }, baseRevision, actor, session) {
  const now = new Date()
  if (branchId) {
    const updated = await DesignBranch.findOneAndUpdate({ _id: branchId, buildingId, status: 'open', revision: baseRevision }, { $inc: { revision: 1 }, $set: { lastEditedAt: now, lastEditedBy: actor.userId } }, { session, returnDocument: 'after' })
    if (updated) return updated
    const current = await DesignBranch.findById(branchId).session(session)
    if (!current || current.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
    throw await staleError(current, baseRevision, 'branch')
  }
  const updated = await LldDesign.findOneAndUpdate(
    { buildingId, revision: baseRevision, state: { $ne: 'awaiting_approval' } },
    { $inc: { revision: 1 }, $set: { state: 'draft', lastEditedAt: now, lastEditedBy: actor.userId } },
    { session, returnDocument: 'after' }
  )
  if (updated) return updated
  const current = await LldDesign.findOne({ buildingId }).session(session)
  if (!current) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
  if (current.state === 'awaiting_approval') throw conflict('lld_submitted', 'The LLD is submitted for approval — it can be edited again once a PM or Reviewer decides')
  throw await staleError(current, baseRevision, 'LLD')
}

// --- Registries (written in the caller's transaction) --------------------------

function validPort(device, portId, cat) {
  const ports = portsOf(cat.item(device.catalogueKey), device)
  if (!ports.length) return portId
  const port = ports.find((p) => lower(p.id) === lower(portId))
  if (!port) throw badRequest(`${portId} is not a port of ${device.hostname ?? device.label ?? 'the device'}`)
  return port.id
}

// Every port a connection takes: its ends (a panel end is the front) and
// each hop (rear in, front out). One registry row each; a clash aborts.
async function takePorts(conn, layer, devices, cat, session) {
  const rows = []
  for (const side of ['source', 'dest']) {
    const end = conn[side]
    if (!end.portId) continue
    const device = devices.get(String(end.deviceId))
    rows.push({ deviceId: end.deviceId, portId: end.portId, portKey: portKey(end.portId, isPatchPanel(cat.item(device?.catalogueKey), device) ? 'front' : null), source: 'connection', hopSeq: null, who: device })
  }
  for (const hop of conn.hops ?? []) {
    const panel = devices.get(String(hop.patchPanelId))
    rows.push({ deviceId: hop.patchPanelId, portId: hop.inPort, portKey: portKey(hop.inPort, 'rear'), source: 'hop', hopSeq: hop.seq, who: panel })
    rows.push({ deviceId: hop.patchPanelId, portId: hop.outPort, portKey: portKey(hop.outPort, 'front'), source: 'hop', hopSeq: hop.seq, who: panel })
  }
  for (const r of rows) {
    try {
      await PortOccupancy.create([{ layer, deviceId: r.deviceId, portId: r.portId, portKey: r.portKey, connectionId: conn._id, hopSeq: r.hopSeq, source: r.source }], { session })
    } catch (err) {
      if (err.code === 11000) throw conflict('port_in_use', `${r.portId}${r.portKey.includes('#') ? ` (${r.portKey.split('#')[1]})` : ''} on ${r.who?.hostname ?? r.who?.label ?? 'the device'} is already used by another connection`)
      throw err
    }
  }
}

// The connection's cable ID and hop segment IDs in the layer's registry:
// unchanged IDs stay, dropped ones are retired (never reused, F4), new ones
// are reserved; an ID owned by another connection is refused.
async function syncCableIds(conn, layer, session) {
  const wanted = [
    ...(conn.cableId ? [{ cableId: conn.cableId.trim(), ownerType: 'connection', hopSeq: null }] : []),
    ...(conn.hops ?? []).filter((h) => h.segmentCableId).map((h) => ({ cableId: h.segmentCableId.trim(), ownerType: 'hop', hopSeq: h.seq })),
  ]
  const keys = wanted.map((w) => lower(w.cableId))
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup) throw conflict('cable_id_in_use', `Cable ID ${wanted[keys.indexOf(dup)].cableId} is used twice on this connection`)
  const current = await CableIdRegistry.find({ layer, connectionId: conn._id }).session(session)
  for (const row of current) {
    if (row.status === 'reserved' && !keys.includes(row.cableKey)) {
      row.status = 'retired'
      await row.save({ session })
    }
  }
  for (const w of wanted) {
    const row = await CableIdRegistry.findOne({ layer, cableKey: lower(w.cableId) }).session(session)
    if (row && String(row.connectionId) !== String(conn._id)) throw conflict('cable_id_in_use', `Cable ID ${w.cableId} is already used in this project${row.status === 'retired' ? ' (retired IDs are never reused)' : ''}`)
    // A branch shares the project's namespace with the main LLD: it may keep
    // the IDs it inherited from this building's main design; a new one is
    // also claimed in the main registry (as retired, owned by the branch
    // connection), so the unique index arbitrates between a branch and the
    // main design writing at the same time, and the ID stays used even if
    // the branch is discarded.
    if (layer !== MAIN && !row) {
      const main = await CableIdRegistry.findOne({ layer: MAIN, cableKey: lower(w.cableId) }).session(session).lean()
      if (main) {
        const inherited = main.status === 'reserved' && conn.originId && String(main.connectionId) === String(conn.originId)
        if (String(main.connectionId) !== String(conn._id) && !inherited) throw conflict('cable_id_in_use', `Cable ID ${w.cableId} is already used in this project${main.status === 'retired' ? ' (retired IDs are never reused)' : ''}`)
      } else {
        try {
          await CableIdRegistry.create([{ layer: MAIN, cableId: w.cableId, cableKey: lower(w.cableId), ownerType: w.ownerType, connectionId: conn._id, hopSeq: w.hopSeq, status: 'retired' }], { session })
        } catch (err) {
          if (err.code === 11000) throw conflict('cable_id_in_use', `Cable ID ${w.cableId} is already used in this project`)
          throw err
        }
      }
    }
    if (row) {
      Object.assign(row, { status: 'reserved', ownerType: w.ownerType, hopSeq: w.hopSeq, cableId: w.cableId })
      await row.save({ session })
    } else {
      try {
        await CableIdRegistry.create([{ layer, cableId: w.cableId, cableKey: lower(w.cableId), ownerType: w.ownerType, connectionId: conn._id, hopSeq: w.hopSeq }], { session })
      } catch (err) {
        if (err.code === 11000) throw conflict('cable_id_in_use', `Cable ID ${w.cableId} is already used in this project`)
        throw err
      }
    }
  }
}

async function releaseConnection(connId, layer, session) {
  await PortOccupancy.deleteMany({ layer, connectionId: connId }, { session })
  await CableIdRegistry.updateMany({ layer, connectionId: connId, status: 'reserved' }, { $set: { status: 'retired' } }, { session })
}

// Applies validated fields to a connection document and re-registers it.
async function writeConnection(doc, body, { layer, data, isNew }, session) {
  const cat = catalogueIndex(data.catalogue)
  const devices = new Map([...data.existing, ...data.devices].map((d) => [String(d._id), d]))
  for (const side of ['source', 'dest']) {
    if (body[side] === undefined) continue
    const device = devices.get(String(body[side].deviceId))
    if (!device) throw notFound(`The ${side === 'source' ? 'source' : 'destination'} device is not in this design`)
    doc[side] = { deviceId: device._id, portId: body[side].portId ? validPort(device, body[side].portId, cat) : null }
  }
  if (String(doc.source.deviceId) === String(doc.dest.deviceId)) throw badRequest('A connection joins two different devices')
  for (const f of ['media', 'speed', 'sourceSfpCode', 'destSfpCode', 'viaPatchPanel']) if (body[f] !== undefined) doc[f] = body[f]
  if (body.cableId !== undefined) doc.cableId = body.cableId ? body.cableId.trim() : null
  if (body.engineerSelectedM !== undefined) doc.set('lengths.engineerSelectedM', body.engineerSelectedM)
  if (body.hops !== undefined) {
    doc.hops = body.hops.map((h, i) => {
      const panel = devices.get(String(h.patchPanelId))
      if (!panel || !isPatchPanel(cat.item(panel.catalogueKey), panel)) throw badRequest(`Hop ${i + 1}: not a patch panel of this building`)
      const rack = data.racks.find((r) => String(r._id) === String(panel.rackId))
      return { seq: i + 1, patchPanelId: panel._id, inPort: validPort(panel, h.inPort, cat), outPort: validPort(panel, h.outPort, cat), segmentCableId: h.segmentCableId ? h.segmentCableId.trim() : null, roomId: rack?.roomId ?? panel.roomId ?? null, rackId: panel.rackId ?? null, ru: panel.ru ?? null }
    })
  }
  doc.updatedAt = new Date()
  await doc.save({ session })
  if (!isNew) await PortOccupancy.deleteMany({ layer, connectionId: doc._id }, { session })
  await takePorts(doc, layer, devices, cat, session)
  await syncCableIds(doc, layer, session)
  return doc
}

// Copies devices and connections into a layer. `keepIds` (restore) keeps the
// snapshot ids; otherwise new ids, endpoints remapped. Ports and cable IDs are
// registered for the copies.
async function copyIntoLayer({ devices, connections }, { layer, building, keepIds = false, hldRefOf = (x) => x.hldRef ?? null, carryCableIds = true, data, actor }, session) {
  const idMap = new Map()
  for (const d of devices) {
    const newId = keepIds ? oid(d._id ?? d.id) : new mongoose.Types.ObjectId()
    idMap.set(String(d._id ?? d.id), newId)
    await Device.create(
      [
        {
          _id: newId,
          origin: 'planned',
          status: 'planned',
          layer,
          hldRef: hldRefOf(d),
          role: d.role ?? null,
          hostname: d.hostname ?? null,
          label: d.label ?? null,
          model: d.model ?? null,
          catalogueKey: d.catalogueKey ?? null,
          category: d.category ?? null,
          salId: building.salId,
          buildingId: building.id,
          roomId: d.roomId ?? null,
          rackId: d.rackId ?? null,
          ru: d.ru ?? null,
          heightU: d.heightU ?? null,
          face: d.face ?? 'front',
          fullDepth: Boolean(d.fullDepth),
          mounting: d.mounting === '0U' ? '0U' : 'rack',
          psuConfigured: d.psuConfigured ?? null,
        },
      ],
      { session }
    )
  }
  const map = (devId) => idMap.get(String(devId)) ?? oid(devId)
  const fresh = await Device.find({ buildingId: building.id, layer }).session(session).lean()
  const full = { ...data, devices: fresh }
  for (const c of connections) {
    // A copy into a branch remembers the main connection it came from.
    const originId = layer === MAIN ? null : keepIds ? c.originId ?? null : c.originId ?? c._id ?? c.id ?? null
    const doc = new Connection({ _id: keepIds ? oid(c._id ?? c.id) : new mongoose.Types.ObjectId(), buildingId: building.id, layer, hldRef: c.hldRef ?? null, originId: originId ? oid(originId) : null, source: { deviceId: map(c.source.deviceId), portId: c.source.portId ?? null }, dest: { deviceId: map(c.dest.deviceId), portId: c.dest.portId ?? null }, media: c.media, speed: c.speed, createdBy: actor.userId, updatedBy: actor.userId })
    await writeConnection(
      doc,
      {
        sourceSfpCode: c.sourceSfpCode ?? null,
        destSfpCode: c.destSfpCode ?? null,
        viaPatchPanel: Boolean(c.viaPatchPanel),
        cableId: carryCableIds ? c.cableId ?? null : null,
        engineerSelectedM: c.lengths?.engineerSelectedM ?? null,
        hops: (c.hops ?? []).map((h) => ({ patchPanelId: String(map(h.patchPanelId)), inPort: h.inPort, outPort: h.outPort, segmentCableId: carryCableIds ? h.segmentCableId ?? null : null })),
      },
      { layer, data: full, isNew: true },
      session
    )
  }
  return idMap
}

// The main 'lld' layer spans every building of the project, so clearing works
// through the building's own connections and devices, never the whole layer.
// Their cable IDs are retired (kept, never reused).
async function clearLayer(buildingId, layer, session) {
  const conns = (await Connection.find({ buildingId, layer }, { _id: 1 }).session(session).lean()).map((c) => c._id)
  const devices = (await Device.find({ buildingId, layer }, { _id: 1 }).session(session).lean()).map((d) => d._id)
  await PortOccupancy.deleteMany({ layer, $or: [{ connectionId: { $in: conns } }, { deviceId: { $in: devices } }] }, { session })
  await CableIdRegistry.updateMany({ layer, connectionId: { $in: conns }, status: 'reserved' }, { $set: { status: 'retired' } }, { session })
  await Connection.deleteMany({ buildingId, layer }, { session })
  await Device.deleteMany({ buildingId, layer }, { session })
  return conns
}

// --- Service ---------------------------------------------------------------------

export function createLldService({ storage }) {
  async function readSnapshot(fileId) {
    const file = await File.findById(fileId).lean()
    if (!file) throw notFound('Version snapshot not found')
    return JSON.parse((await storage.read(file.storageKey)).toString('utf8'))
  }

  async function latestApprovedHld(buildingId) {
    const hld = await HldDesign.findOne({ buildingId }).lean()
    if (!hld?.latestApprovedVersionId) return null
    return DesignVersion.findById(hld.latestApprovedVersionId).lean()
  }

  async function context(req, buildingId, branchId = null) {
    const building = await requireBuilding(req, buildingId)
    const lld = await LldDesign.findOne({ buildingId: building.id }).lean()
    let branch = null
    if (branchId) {
      branch = mongoose.isValidObjectId(branchId) ? await DesignBranch.findOne({ _id: branchId, buildingId: building.id }).lean() : null
      if (!branch) throw notFound('Branch not found')
    }
    return { building, lld, branch, layer: layerOf(branch ? String(branch._id) : null) }
  }

  async function write(req, { buildingId, branchId = null }, baseRevision, actor, fn) {
    const { building, lld, branch, layer } = await context(req, buildingId, branchId)
    if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
    if (branch && branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
    return withTransaction(async (session) => {
      const claimed = await claim({ buildingId: building.id, branchId: branch ? String(branch._id) : null }, baseRevision, actor, session)
      const data = await loadLayer(building.id, layer, req.project.id, session)
      const out = await fn({ building, data, layer, session })
      return { ...out, revision: claimed.revision }
    })
  }

  async function audit(req, building, actor, action, extra) {
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'lld', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })
  }

  async function deviceInLayer(req, deviceId) {
    const device = mongoose.isValidObjectId(deviceId) ? await Device.findById(deviceId).lean() : null
    if (!device || device.origin !== 'planned' || !isLldLayer(device.layer)) throw notFound('Device not found')
    await requireBuilding(req, device.buildingId)
    return device
  }
  async function connectionInLayer(req, connectionId) {
    const conn = mongoose.isValidObjectId(connectionId) ? await Connection.findById(connectionId).lean() : null
    if (!conn || !isLldLayer(conn.layer)) throw notFound('Connection not found')
    await requireBuilding(req, conn.buildingId)
    return conn
  }

  async function writeVersion({ building, data, actor, label, branchId, basedOnVersionId, session }) {
    const { projectId } = currentScope()
    const snap = snapshotOf(data)
    const versionId = new mongoose.Types.ObjectId()
    const fileId = new mongoose.Types.ObjectId()
    const last = await DesignVersion.findOne({ buildingId: building.id, designType: 'lld' }).sort({ number: -1 }).session(session).lean()
    const number = (last?.number ?? 0) + 1
    const bytes = Buffer.from(JSON.stringify({ designType: 'lld', building: { id: building.id, code: building.code }, label, number, branchId: branchId ?? null, ...snap, createdAt: new Date().toISOString() }, null, 2))
    const storageKey = `files/${projectId}/${fileId}`
    await storage.put(storageKey, bytes)
    try {
      await File.create([{ _id: fileId, buildingId: building.id, attachedTo: { type: 'designVersion', id: versionId }, category: 'data_snapshot', fileName: `LLD-${building.code}-v${number}.json`, storageKey, mimeType: 'application/json', sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), uploadedBy: actor.userId }], { session })
      await DesignVersion.create([{ _id: versionId, buildingId: building.id, designType: 'lld', number, label, basedOnVersionId, branchId: branchId ?? null, snapshotFileId: fileId, counts: { devices: snap.devices.length, connections: snap.connections.length }, createdBy: actor.userId }], { session })
    } catch (err) {
      await storage.remove(storageKey).catch(() => {})
      throw err
    }
    return { versionId, number }
  }

  return {
    // The LLD screen: the layer's devices (and the surveyed gear it shares),
    // connections with lengths, occupancy, racks and RU states, versions,
    // branches, approvals, the HLD baseline and a cable-ID suggestion.
    async view(req, buildingId, branchId = null) {
      const { building, lld, branch, layer } = await context(req, buildingId, branchId)
      const hldVersion = await latestApprovedHld(building.id)
      const hldState = await HldDesign.findOne({ buildingId: building.id }, { state: 1 }).lean()
      const base = {
        building,
        started: Boolean(lld),
        hld: { latestApprovedNumber: hldVersion?.number ?? null, latestApprovedVersionId: id(hldVersion?._id), deviceCount: hldVersion?.counts?.devices ?? null, basedOnNumber: lld?.basedOnHldNumber ?? null, changed: Boolean(lld && hldVersion && hldVersion.number > lld.basedOnHldNumber), state: hldState?.state ?? null },
      }
      if (!lld) return { ...base, status: 'not_started' }
      const data = await loadLayer(building.id, layer, req.project.id)
      const { views, connections, occupancyByDevice } = inputs(data)
      const versions = await DesignVersion.find({ buildingId: building.id, designType: 'lld' }).sort({ number: -1 }).lean()
      const branches = await DesignBranch.find({ buildingId: building.id, designType: 'lld' }).sort({ createdAt: -1 }).lean()
      const approvals = await Approval.find({ buildingId: building.id, phaseKey: 'lld' }).sort({ submittedAt: -1 }).limit(20).lean()
      const names = await namesOf([...approvals.flatMap((a) => [a.submittedBy, a.decision?.decidedBy]), ...versions.map((v) => v.createdBy), lld.lastEditedBy, branch?.lastEditedBy])
      const allIds = await CableIdRegistry.find({}, { cableKey: 1 }).lean()
      const own = new Set(data.devices.map((d) => String(d._id)))
      const rackViews = data.racks.map((r) => {
        const placements = views
          // A device with a rack but no RU yet is unplaced (listed, not drawn); 0U gear sits on a rail.
          .filter((d) => d.rackId === String(r._id) && (d.ru != null || d.mounting === '0U' || d.heightU === 0))
          .map((d) => ({ id: d.id, ru: d.ru ?? 0, heightU: d.ru == null ? 0 : d.heightU ?? 1, face: d.face, fullDepth: d.fullDepth, mounting: d.ru == null ? '0U' : 'rack', railSide: d.ru == null ? d.railSide ?? 'left' : null, kind: 'device', label: d.label, sublabel: d.model, planned: own.has(d.id) }))
        const states = data.ruStates.filter((s) => String(s.rackId) === String(r._id)).map((s) => ({ id: `ru-${s._id}`, ru: s.ru, heightU: 1, face: s.face === 'rear' ? 'rear' : 'front', fullDepth: s.face === 'both', mounting: 'rack', kind: s.state, label: s.reason ?? (s.state === 'reserved' ? 'Reserved' : 'Blocked') }))
        const all = [...placements, ...states]
        return { id: String(r._id), roomId: String(r.roomId), code: r.code, heightU: r.heightU, placements: all, freeRuByFace: { front: computeFreeRU(all, r.heightU, 'front'), rear: computeFreeRU(all, r.heightU, 'rear') } }
      })
      return {
        ...base,
        status: (await lldStatusByBuilding()).get(building.id) ?? 'in_progress',
        design: { revision: branch ? branch.revision : lld.revision, mainRevision: lld.revision, state: lld.state, lastEditedBy: names.get(String((branch ?? lld).lastEditedBy)) ?? null, lastEditedAt: (branch ?? lld).lastEditedAt },
        branch: branch ? { id: String(branch._id), name: branch.name, status: branch.status } : null,
        floors: data.floors.map((f) => ({ id: String(f._id), token: f.token, name: f.name, order: f.order })),
        rooms: data.rooms.map((r) => ({ id: String(r._id), floorId: String(r.floorId), code: r.code, isMainRoom: Boolean(r.isMainRoom) })),
        racks: rackViews,
        devices: views.map((d) => ({ ...d, inDesign: own.has(d.id), occupied: (occupancyByDevice.get(d.id) ?? []).map((o) => ({ portKey: o.portKey, connectionId: String(o.connectionId) })) })),
        connections,
        cableIdSuggestion: suggestNextCableId(allIds.map((r) => r.cableKey)),
        versions: versions.map((v) => ({ id: String(v._id), number: v.number, label: v.label, frozen: v.frozen, branchId: id(v.branchId), counts: v.counts, createdAt: v.createdAt, createdBy: names.get(String(v.createdBy)) ?? null })),
        branches: branches.map((b) => ({ id: String(b._id), name: b.name, status: b.status, parentVersionId: id(b.parentVersionId), createdAt: b.createdAt })),
        approvals: approvals.map((a) => ({ id: String(a._id), status: a.status, submittedBy: names.get(String(a.submittedBy)) ?? null, submittedById: String(a.submittedBy), submittedAt: a.submittedAt, versionNumber: versions.find((v) => String(v._id) === String(a.designVersionId))?.number ?? null, decision: a.decision ? { value: a.decision.value, decidedBy: names.get(String(a.decision.decidedBy)) ?? null, decidedAt: a.decision.decidedAt, comments: a.decision.comments ?? null } : null })),
        renameLocked: Boolean(lld.latestApprovedVersionId),
        stockLengths: data.settings.stockLengths,
        // Optics for fibre ends (Rackium Editor).
        optics: data.catalogue.filter((i) => i.kind === 'optic').map((i) => ({ key: i.key, media: i.mediaSpeed?.media ?? null, speed: i.mediaSpeed?.speed ?? null })),
        // What the LLD may add to a rack (Rack Elevations).
        passiveModels: data.catalogue.filter((i) => i.kind === 'device_model' && ['patch_panel', 'cable_management', 'accessory'].includes(i.category) && i.rackMounted).map((i) => ({ key: i.key, model: i.model, category: i.category, heightU: i.heightU ?? 1 })),
      }
    },

    async validate(req, buildingId, branchId = null) {
      const { building, lld, layer } = await context(req, buildingId, branchId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      return runValidation(await loadLayer(building.id, layer, req.project.id))
    },

    // LLD derives from the latest approved HLD (brief §5.4): a working copy of
    // its devices and uplinks, each remembering the HLD item it came from.
    async start(req, { buildingId }, actor) {
      const building = await requireBuilding(req, buildingId)
      if (await LldDesign.exists({ buildingId: building.id })) throw conflict('lld_started', 'The LLD of this building is already started')
      const version = await latestApprovedHld(building.id)
      if (!version) throw conflict('hld_not_approved', `The HLD of ${building.code} must be approved before the LLD starts`)
      const snapshot = await readSnapshot(version.snapshotFileId)
      return withTransaction(async (session) => {
        const [lld] = await LldDesign.create([{ buildingId: building.id, basedOnHldVersionId: version._id, basedOnHldNumber: version.number, startedBy: actor.userId, lastEditedAt: new Date(), lastEditedBy: actor.userId }], { session })
        const data = await loadLayer(building.id, MAIN, req.project.id, session)
        await copyIntoLayer(
          { devices: snapshot.devices.map((d) => ({ ...d, _id: d.id, hldRef: d.id, rackId: d.rackId, ru: null })), connections: snapshot.connections.map((c) => ({ ...c, _id: c.id, hldRef: c.id })) },
          { layer: MAIN, building, data, actor, carryCableIds: false },
          session
        )
        await audit(req, building, actor, 'lld.started', { objectType: 'Building', objectId: building.id, comment: `From HLD v${version.number}: ${snapshot.devices.length} device(s), ${snapshot.connections.length} uplink(s)`, session })
        return { revision: lld.revision, basedOnHldNumber: version.number }
      })
    },

    // Side-by-side HLD vs LLD (no automatic re-sync).
    async reconciliation(req, buildingId) {
      const { building, lld } = await context(req, buildingId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      const version = await latestApprovedHld(building.id)
      const snapshot = await readSnapshot(version.snapshotFileId)
      const data = await loadLayer(building.id, MAIN, req.project.id)
      const lldSide = { devices: data.devices.map((d) => ({ id: String(d._id), hldRef: id(d.hldRef), hostname: d.hostname, label: d.label, role: d.role, catalogueKey: d.catalogueKey, roomId: id(d.roomId) })), connections: data.connections.map((c) => ({ id: String(c._id), hldRef: id(c.hldRef), source: { deviceId: String(c.source.deviceId) }, dest: { deviceId: String(c.dest.deviceId) }, media: c.media, speed: c.speed, sourceSfpCode: c.sourceSfpCode ?? null, destSfpCode: c.destSfpCode ?? null })) }
      return { basedOnNumber: lld.basedOnHldNumber, hldNumber: version.number, changed: version.number > lld.basedOnHldNumber, ...reconcileWithHld({ devices: snapshot.devices, connections: snapshot.connections }, lldSide) }
    },

    // Copies chosen HLD items into the LLD (explicit, per item).
    async copyFromHld(req, { buildingId, hldDeviceIds, hldConnectionIds, baseRevision }, actor) {
      const version = await latestApprovedHld(buildingId)
      if (!version) throw conflict('hld_not_approved', 'No approved HLD to copy from')
      const snapshot = await readSnapshot(version.snapshotFileId)
      return write(req, { buildingId }, baseRevision, actor, async ({ building, data, session }) => {
        const devices = snapshot.devices.filter((d) => hldDeviceIds.includes(d.id))
        if (devices.length !== hldDeviceIds.length) throw notFound('A device is not in the approved HLD')
        const inLld = new Map(data.devices.filter((d) => d.hldRef).map((d) => [String(d.hldRef), String(d._id)]))
        for (const d of devices) if (inLld.has(d.id)) throw conflict('already_in_lld', `${d.hostname ?? d.label} is already in the LLD`)
        const idMap = await copyIntoLayer({ devices: devices.map((d) => ({ ...d, _id: d.id, hldRef: d.id, ru: null })), connections: [] }, { layer: MAIN, building, data, actor, carryCableIds: false }, session)
        for (const [hldId, newId] of idMap) inLld.set(hldId, String(newId))
        const conns = snapshot.connections.filter((c) => hldConnectionIds.includes(c.id))
        if (conns.length !== hldConnectionIds.length) throw notFound('An uplink is not in the approved HLD')
        const existingIds = new Set(data.existing.map((d) => String(d._id)))
        const mapped = conns.map((c) => {
          const end = (devId) => inLld.get(devId) ?? (existingIds.has(devId) ? devId : null)
          const [s, t] = [end(c.source.deviceId), end(c.dest.deviceId)]
          if (!s || !t) throw conflict('copy_device_first', 'Copy both of the uplink’s devices into the LLD first')
          return { ...c, _id: c.id, hldRef: c.id, source: { deviceId: s, portId: c.source.portId ?? null }, dest: { deviceId: t, portId: c.dest.portId ?? null } }
        })
        const fresh = { ...data, devices: await Device.find({ buildingId: building.id, layer: MAIN }).session(session).lean() }
        await copyIntoLayer({ devices: [], connections: mapped }, { layer: MAIN, building, data: fresh, actor, carryCableIds: false }, session)
        await audit(req, building, actor, 'lld.copied_from_hld', { objectType: 'Building', objectId: building.id, comment: `${devices.length} device(s), ${conns.length} uplink(s) from HLD v${version.number}`, session })
        return { copied: { devices: devices.length, connections: conns.length } }
      })
    },

    // "Mark reviewed against HLD vN": the baseline moves; nothing else changes.
    async rebase(req, { buildingId, baseRevision }, actor) {
      const version = await latestApprovedHld(buildingId)
      return write(req, { buildingId }, baseRevision, actor, async ({ building, session }) => {
        await LldDesign.updateOne({ buildingId: building.id }, { $set: { basedOnHldVersionId: version._id, basedOnHldNumber: version.number } }, { session })
        await audit(req, building, actor, 'lld.rebased', { objectType: 'Building', objectId: building.id, comment: `Reviewed against HLD v${version.number}`, session })
        return { basedOnHldNumber: version.number }
      })
    },

    // A passive item the LLD adds (patch panel, cable manager).
    async addDevice(req, body, actor) {
      return write(req, body, body.baseRevision, actor, async ({ building, data, layer, session }) => {
        const cat = catalogueIndex(data.catalogue)
        const item = cat.item(body.catalogueKey)
        if (!item || item.kind !== 'device_model' || !['patch_panel', 'cable_management', 'accessory'].includes(item.category)) throw badRequest('The LLD adds patch panels, cable managers and accessories from the catalogue')
        const rack = data.racks.find((r) => String(r._id) === body.rackId)
        if (!rack) throw notFound('Rack not found in this building')
        const count = data.devices.filter((d) => String(d.rackId) === body.rackId && d.category === item.category).length + 1
        const label = body.label ?? `${item.category === 'patch_panel' ? 'PP' : 'CM'}-${rack.code}-${String(count).padStart(2, '0')}`
        const device = new Device({ origin: 'planned', status: 'planned', layer, salId: building.salId, buildingId: building.id, roomId: rack.roomId, rackId: rack._id, ru: body.ru, heightU: item.heightU ?? 1, face: body.face, fullDepth: Boolean(item.fullDepth), mounting: item.mounting === '0U' ? '0U' : 'rack', label, model: item.model, catalogueKey: item.key, category: item.category })
        if (body.ru != null) assertPlacement(device, rack, data)
        await device.save({ session })
        await audit(req, building, actor, 'lld.device.added', { objectType: 'Device', objectId: device._id, comment: `${label} in ${rack.code}${body.ru ? ` RU${body.ru}` : ''}`, session })
        return { device: deviceView(device.toObject(), cat, data.racks) }
      })
    },

    // Rack elevation: place (or unplace) a device by rack, RU and face.
    async place(req, deviceId, body, actor) {
      const existing = await deviceInLayer(req, deviceId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, body.baseRevision, actor, async ({ building, data, session }) => {
        const device = await Device.findById(deviceId).session(session)
        const before = { rackId: id(device.rackId), ru: device.ru, face: device.face }
        if (body.rackId) {
          const rack = data.racks.find((r) => String(r._id) === body.rackId)
          if (!rack) throw notFound('Rack not found in this building')
          const item = catalogueIndex(data.catalogue).item(device.catalogueKey)
          if (item && !item.rackMounted) throw badRequest(`${device.hostname ?? device.label} is not rack-mounted`)
          Object.assign(device, { rackId: rack._id, roomId: rack.roomId, ru: body.ru, face: body.face })
          if (body.ru != null) assertPlacement(device, rack, data, catalogueIndex(data.catalogue))
        } else {
          Object.assign(device, { rackId: null, ru: null })
        }
        await device.save({ session })
        await audit(req, building, actor, 'lld.device.placed', { objectType: 'Device', objectId: device._id, changes: [{ objectType: 'Device', objectId: String(device._id), field: 'placement', before: `${before.rackId ?? '—'} RU${before.ru ?? '—'} ${before.face ?? ''}`.trim(), after: `${id(device.rackId) ?? '—'} RU${device.ru ?? '—'} ${device.face}` }], session })
        return { device: deviceView(device.toObject(), catalogueIndex(data.catalogue), data.racks) }
      })
    },

    async deleteDevice(req, deviceId, { baseRevision }, actor) {
      const existing = await deviceInLayer(req, deviceId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, baseRevision, actor, async ({ building, data, layer, session }) => {
        if (data.connections.some((c) => (c.hops ?? []).some((h) => String(h.patchPanelId) === deviceId))) throw conflict('panel_in_use', `${existing.label ?? 'This patch panel'} carries hops — remove them first`)
        const conns = data.connections.filter((c) => String(c.source.deviceId) === deviceId || String(c.dest.deviceId) === deviceId)
        for (const c of conns) {
          await releaseConnection(c._id, layer, session)
          await Connection.deleteOne({ _id: c._id }, { session })
        }
        await Device.deleteOne({ _id: existing._id }, { session })
        await audit(req, building, actor, 'lld.device.deleted', { objectType: 'Device', objectId: existing._id, comment: `${existing.hostname ?? existing.label} and ${conns.length} connection(s)`, session })
        return { deleted: { device: deviceId, connections: conns.map((c) => String(c._id)) } }
      })
    },

    async createConnection(req, body, actor) {
      return write(req, body, body.baseRevision, actor, async ({ building, data, layer, session }) => {
        const doc = new Connection({ buildingId: building.id, layer, source: body.source, dest: body.dest, media: body.media, speed: body.speed, createdBy: actor.userId, updatedBy: actor.userId })
        await writeConnection(doc, body, { layer, data, isNew: true }, session)
        await audit(req, building, actor, 'lld.connection.created', { objectType: 'Connection', objectId: doc._id, comment: `${doc.media.toUpperCase()}${doc.cableId ? ` · ${doc.cableId}` : ''}`, session })
        data.connections.push(doc.toObject())
        return { connection: inputs(data).connections.find((c) => c.id === String(doc._id)) }
      })
    },

    // Rackium Editor: ports, hops, cable IDs, media, Engineer Selected length.
    async updateConnection(req, connectionId, body, actor) {
      const existing = await connectionInLayer(req, connectionId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, body.baseRevision, actor, async ({ building, data, layer, session }) => {
        const doc = await Connection.findById(connectionId).session(session)
        const before = connectionView(doc.toObject(), {})
        doc.updatedBy = actor.userId
        await writeConnection(doc, body, { layer, data, isNew: false }, session)
        const after = connectionView(doc.toObject(), {})
        const fields = ['source', 'dest', 'media', 'speed', 'sourceSfpCode', 'destSfpCode', 'cableId', 'hops']
        const changes = fields.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => ({ objectType: 'Connection', objectId: connectionId, field: f, before: before[f] ?? null, after: after[f] ?? null }))
        if (before.lengths.engineerSelectedM !== after.lengths.engineerSelectedM) changes.push({ objectType: 'Connection', objectId: connectionId, field: 'engineerSelectedM', before: before.lengths.engineerSelectedM, after: after.lengths.engineerSelectedM })
        await audit(req, building, actor, 'lld.connection.updated', { objectType: 'Connection', objectId: doc._id, changes, session })
        data.connections = data.connections.map((c) => (String(c._id) === connectionId ? doc.toObject() : c))
        return { connection: inputs(data).connections.find((c) => c.id === connectionId) }
      })
    },

    async deleteConnection(req, connectionId, { baseRevision }, actor) {
      const existing = await connectionInLayer(req, connectionId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, baseRevision, actor, async ({ building, layer, session }) => {
        await releaseConnection(existing._id, layer, session)
        await Connection.deleteOne({ _id: existing._id }, { session })
        await audit(req, building, actor, 'lld.connection.deleted', { objectType: 'Connection', objectId: existing._id, comment: existing.cableId ?? null, session })
        return { deleted: connectionId }
      })
    },

    // Hostname rename (DATA-MODEL §7): preview every affected hostname, then
    // apply in one transaction with one audit entry. Not after LLD approval.
    async renamePreview(req, body) {
      const { building, lld, layer } = await context(req, body.buildingId, body.branchId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      const data = await loadLayer(building.id, layer, req.project.id)
      return { rows: await renamePlan(building, data, body) }
    },

    async rename(req, body, actor) {
      const lld = await LldDesign.findOne({ buildingId: body.buildingId }).lean()
      if (lld?.latestApprovedVersionId) throw conflict('change_request_required', 'The LLD has been approved — a rename now goes through a change request (coming with M5)')
      return write(req, body, body.baseRevision, actor, async ({ building, data, session }) => {
        const rows = await renamePlan(building, data, body)
        const problems = rows.filter((r) => r.problem)
        if (problems.length) throw new AppError(409, 'rename_conflict', problems.map((r) => `${r.from ?? r.to}: ${r.problem}`).join('; '), { rows })
        const changing = rows.filter((r) => r.from !== r.to)
        // Two passes so swapping names never trips the unique index mid-way.
        for (const r of changing) await Device.updateOne({ _id: r.deviceId }, { $set: { hostname: `__rename_${r.deviceId}` } }, { session })
        for (const r of changing) await Device.updateOne({ _id: r.deviceId }, { $set: { hostname: r.to } }, { session })
        await audit(req, building, actor, 'device.hostname.renamed', { objectType: 'Building', objectId: building.id, comment: `${changing.length} hostname(s) renamed`, changes: changing.map((r) => ({ objectType: 'Device', objectId: r.deviceId, field: 'hostname', before: r.from, after: r.to })), session })
        return { renamed: changing.length }
      })
    },

    // --- Versions and branches (brief §6.10) --------------------------------------

    async saveVersion(req, body, actor) {
      const { building, lld, branch, layer } = await context(req, body.buildingId, body.branchId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      if (branch && branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
      return withTransaction(async (session) => {
        const data = await loadLayer(building.id, layer, req.project.id, session)
        const { versionId, number } = await writeVersion({ building, data, actor, label: body.label, branchId: branch?._id ?? null, basedOnVersionId: lld.basedOnHldVersionId, session })
        await audit(req, building, actor, 'lld.version.saved', { objectType: 'DesignVersion', objectId: versionId, comment: `v${number} ${body.label}${branch ? ` (branch ${branch.name})` : ''}`, session })
        return { versionId: String(versionId), number }
      })
    },

    async diff(req, { buildingId, from, to }) {
      const { building, lld } = await context(req, buildingId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      const load = async (ref) => {
        if (ref.startsWith('current')) {
          const branchId = ref.split(':')[1] ?? null
          const { layer } = await context(req, buildingId, branchId)
          const snap = snapshotOf(await loadLayer(building.id, layer, req.project.id))
          return { label: branchId ? 'Branch (current)' : 'Current LLD', snap }
        }
        const version = await DesignVersion.findOne({ _id: ref, buildingId: building.id, designType: 'lld' }).lean()
        if (!version) throw notFound('Version not found')
        return { label: `v${version.number} ${version.label ?? ''}`.trim(), snap: await readSnapshot(version.snapshotFileId) }
      }
      const [a, b] = [await load(from), await load(to)]
      return { from: a.label, to: b.label, ...diffDesigns(a.snap, b.snap) }
    },

    // Restore a version into the main LLD or a branch (frozen versions stay as
    // they are). Ids are kept, so a cable gets its own ID back.
    async restore(req, versionId, body, actor) {
      const version = mongoose.isValidObjectId(versionId) ? await DesignVersion.findOne({ _id: versionId, designType: 'lld' }).lean() : null
      if (!version) throw notFound('Version not found')
      const snapshot = await readSnapshot(version.snapshotFileId)
      return write(req, { buildingId: String(version.buildingId), branchId: body.branchId }, body.baseRevision, actor, async ({ building, data, layer, session }) => {
        const sameLayer = (version.branchId ? `lld:${version.branchId}` : MAIN) === layer
        await clearLayer(building.id, layer, session)
        await copyIntoLayer({ devices: snapshot.raw.devices, connections: snapshot.raw.connections }, { layer, building, data: { ...data, devices: [] }, actor, keepIds: sameLayer }, session)
        await audit(req, building, actor, 'lld.version.restored', { objectType: 'DesignVersion', objectId: version._id, comment: `v${version.number} ${version.label ?? ''}`.trim(), session })
        return { restored: version.number }
      })
    },

    async createBranch(req, body, actor) {
      const { building, lld } = await context(req, body.buildingId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      let source
      if (body.fromVersionId) {
        const version = await DesignVersion.findOne({ _id: body.fromVersionId, buildingId: building.id, designType: 'lld' }).lean()
        if (!version) throw notFound('Version not found')
        source = (await readSnapshot(version.snapshotFileId)).raw
      }
      return withTransaction(async (session) => {
        const [branch] = await DesignBranch.create([{ buildingId: building.id, name: body.name, parentVersionId: body.fromVersionId ?? null, createdBy: actor.userId, lastEditedAt: new Date(), lastEditedBy: actor.userId }], { session })
        const layer = layerOf(String(branch._id))
        if (!source) source = snapshotOf(await loadLayer(building.id, MAIN, req.project.id, session)).raw
        const data = await loadLayer(building.id, layer, req.project.id, session)
        await copyIntoLayer({ devices: source.devices, connections: source.connections }, { layer, building, data, actor }, session)
        await audit(req, building, actor, 'lld.branch.created', { objectType: 'DesignBranch', objectId: branch._id, comment: body.name, session })
        return { branch: { id: String(branch._id), name: branch.name, status: branch.status, revision: branch.revision } }
      })
    },

    // Promotion replaces the main LLD with the branch; the branch closes.
    async promoteBranch(req, branchId, { baseRevision }, actor) {
      const branch = mongoose.isValidObjectId(branchId) ? await DesignBranch.findById(branchId).lean() : null
      if (!branch) throw notFound('Branch not found')
      if (branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
      return write(req, { buildingId: String(branch.buildingId) }, baseRevision, actor, async ({ building, session }) => {
        const from = layerOf(String(branch._id))
        const keys = (await CableIdRegistry.find({ layer: from }, { cableKey: 1 }).session(session).lean()).map((r) => r.cableKey)
        const branchConns = (await Connection.find({ buildingId: building.id, layer: from }, { _id: 1 }).session(session).lean()).map((c) => c._id)
        const mainConns = await clearLayer(building.id, MAIN, session)
        // The branch's IDs take over this building's main rows (and the
        // branch's own claims) for the same IDs; an ID held anywhere else in
        // the project blocks the promotion.
        const clash = await CableIdRegistry.findOne({ layer: MAIN, cableKey: { $in: keys }, connectionId: { $nin: [...mainConns, ...branchConns] } }).session(session).lean()
        if (clash) throw conflict('cable_id_in_use', `Cable ID ${clash.cableId} is already used elsewhere in this project — change it on the branch first`)
        await CableIdRegistry.deleteMany({ layer: MAIN, cableKey: { $in: keys } }, { session })
        await Device.updateMany({ buildingId: building.id, layer: from }, { $set: { layer: MAIN } }, { session })
        await Connection.updateMany({ buildingId: building.id, layer: from }, { $set: { layer: MAIN, originId: null } }, { session })
        await PortOccupancy.updateMany({ layer: from }, { $set: { layer: MAIN } }, { session })
        await CableIdRegistry.updateMany({ layer: from }, { $set: { layer: MAIN } }, { session })
        await DesignBranch.updateOne({ _id: branch._id }, { $set: { status: 'promoted', resolvedBy: actor.userId, resolvedAt: new Date() } }, { session })
        await audit(req, building, actor, 'lld.branch.promoted', { objectType: 'DesignBranch', objectId: branch._id, comment: branch.name, session })
        return { promoted: String(branch._id) }
      })
    },

    async discardBranch(req, branchId, actor) {
      const branch = mongoose.isValidObjectId(branchId) ? await DesignBranch.findById(branchId).lean() : null
      if (!branch) throw notFound('Branch not found')
      const building = await requireBuilding(req, branch.buildingId)
      if (branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
      return withTransaction(async (session) => {
        const layer = layerOf(String(branch._id))
        await clearLayer(building.id, layer, session)
        await CableIdRegistry.deleteMany({ layer }, { session })
        await DesignBranch.updateOne({ _id: branch._id }, { $set: { status: 'discarded', resolvedBy: actor.userId, resolvedAt: new Date() } }, { session })
        await audit(req, building, actor, 'lld.branch.discarded', { objectType: 'DesignBranch', objectId: branch._id, comment: branch.name, session })
        return { discarded: String(branch._id) }
      })
    },

    // --- Workflow ----------------------------------------------------------------

    async submit(req, { buildingId, baseRevision }, actor) {
      const { building, lld } = await context(req, buildingId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      if (lld.state === 'awaiting_approval') throw conflict('lld_submitted', 'The LLD is already submitted for approval')
      if (lld.revision !== baseRevision) throw await staleError(lld, baseRevision, 'LLD')
      const data = await loadLayer(building.id, MAIN, req.project.id)
      if (!data.devices.length) throw conflict('empty_lld', 'There is nothing to submit')
      const { findings, summary } = runValidation(data)
      if (summary.blocksSubmit) throw new AppError(409, 'validation_blocked', `${summary.critical} Critical finding(s) must be fixed before the LLD can be submitted`, { summary, findings: findings.filter((f) => f.severity === 'critical') })
      return withTransaction(async (session) => {
        const claimed = await LldDesign.findOneAndUpdate({ buildingId: building.id, revision: baseRevision, state: { $ne: 'awaiting_approval' } }, { $inc: { revision: 1 }, $set: { state: 'awaiting_approval' } }, { session, returnDocument: 'after' })
        if (!claimed) throw await staleError(await LldDesign.findOne({ buildingId: building.id }).session(session), baseRevision, 'LLD')
        const { versionId, number } = await writeVersion({ building, data, actor, label: 'Submitted for approval', branchId: null, basedOnVersionId: lld.basedOnHldVersionId, session })
        const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'lld', gate: 'lld_internal', designVersionId: versionId, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
        await LldDesign.updateOne({ _id: claimed._id }, { $set: { pendingApprovalId: approval._id } }, { session })
        await audit(req, building, actor, 'lld.submitted', { objectType: 'DesignVersion', objectId: versionId, comment: `LLD v${number} submitted (${summary.warning} warning(s))`, session })
        return { revision: claimed.revision, versionNumber: number, approvalId: String(approval._id) }
      })
    },

    async decide(req, { buildingId, decision, comment }, actor) {
      const building = await requireBuilding(req, buildingId)
      const approval = await Approval.findOne({ buildingId: building.id, gate: 'lld_internal', status: 'pending' }).lean()
      if (!approval) throw conflict('no_pending_approval', 'The LLD is not awaiting approval')
      const { roles } = await callerAccess(req)
      if (!canApproveSubmission({ roles, actorId: actor.userId, submitterId: approval.submittedBy })) {
        throw forbidden(String(actor.userId) === String(approval.submittedBy) ? 'You submitted this LLD — someone else must decide on it' : 'Only a PM or Reviewer decides on the LLD')
      }
      if (decision === 'changes_requested' && !String(comment ?? '').trim()) throw badRequest('Say what needs to change')
      return withTransaction(async (session) => {
        const decided = await Approval.findOneAndUpdate({ _id: approval._id, status: 'pending' }, { $set: { status: decision, reviewerId: actor.userId, decision: { value: decision, decidedAt: new Date(), decidedBy: actor.userId, decidedByRole: actor.role, comments: String(comment ?? '').trim() || null } } }, { session, returnDocument: 'after' })
        if (!decided) throw conflict('already_decided', 'This submission was decided meanwhile — reload')
        const set = { state: decision === 'approved' ? 'approved' : 'changes_requested', pendingApprovalId: null }
        if (decision === 'approved') {
          await DesignVersion.updateOne({ _id: approval.designVersionId }, { $set: { frozen: true, frozenAt: new Date() } }, { session })
          set.latestApprovedVersionId = approval.designVersionId
        }
        const design = await LldDesign.findOneAndUpdate({ buildingId: building.id }, { $set: set, $inc: { revision: 1 } }, { session, returnDocument: 'after' })
        await audit(req, building, actor, decision === 'approved' ? 'lld.approved' : 'lld.changes_requested', { objectType: 'Approval', objectId: approval._id, comment: String(comment ?? '').trim() || null, session })
        return { revision: design.revision, state: design.state }
      })
    },
  }
}

// Shared rack rules against everything else in the rack: surveyed gear,
// active RU states and the design's other placed devices.
function assertPlacement(device, rack, data, cat = catalogueIndex(data.catalogue)) {
  const item = cat.item(device.catalogueKey)
  const heightU = item?.heightU ?? device.heightU ?? 1
  if (heightU === 0) return
  const candidate = { id: String(device._id), ru: device.ru, heightU, face: device.face ?? 'front', fullDepth: Boolean(item?.fullDepth ?? device.fullDepth), kind: 'device', label: device.hostname ?? device.label }
  const others = [
    ...[...data.existing, ...data.devices]
      .filter((d) => String(d.rackId) === String(rack._id) && String(d._id) !== String(device._id) && d.ru != null && (d.heightU ?? 0) > 0)
      .map((d) => ({ id: String(d._id), ru: d.ru, heightU: catalogueIndex(data.catalogue).item(d.catalogueKey)?.heightU ?? d.heightU, face: d.face ?? 'front', fullDepth: Boolean(d.fullDepth), kind: 'device', label: d.hostname ?? d.label ?? 'device' })),
    ...data.ruStates.filter((s) => String(s.rackId) === String(rack._id)).map((s) => ({ id: `ru-${s._id}`, ru: s.ru, heightU: 1, face: s.face === 'rear' ? 'rear' : 'front', fullDepth: s.face === 'both', kind: s.state, label: s.state === 'reserved' ? 'a reserved RU' : 'a blocked RU' })),
  ]
  const conflicts = findConflicts(candidate, others, rack.heightU)
  if (conflicts.length) throw badRequest(`${candidate.label}: ${conflicts.map((c) => c.message).join('; ')}`, { conflicts })
}

// The rename preview: each affected device, old → new, and any problem.
async function renamePlan(building, data, body) {
  const settings = data.settings
  const codes = resolveRoleCodes(settings.namingCodes)
  const country = building.countryId ? await Country.findById(building.countryId).lean() : null
  const floorOf = (d) => data.floors.find((f) => String(f._id) === String(data.rooms.find((r) => String(r._id) === String(d.roomId))?.floorId))
  let wanted
  if (body.regenerate) {
    wanted = data.devices
      .filter((d) => roleInfo(d.role)?.named)
      .map((d) => {
        const seq = Number(String(d.hostname ?? '').match(/-(\d{3})$/)?.[1] ?? 1)
        return { deviceId: String(d._id), hostname: buildHostname({ role: codes[d.role], country: country?.code ?? 'XX', sal: building.salCode ?? 'SAL', campus: building.campusCode ?? 'C', building: building.code, floor: floorOf(d)?.token ?? 'X', seq }) }
      })
  } else {
    wanted = body.renames
  }
  const byId = new Map(data.devices.map((d) => [String(d._id), d]))
  const finalNames = new Map(data.devices.map((d) => [String(d._id), d.hostname]))
  for (const w of wanted) if (byId.has(w.deviceId)) finalNames.set(w.deviceId, w.hostname)
  const counts = new Map()
  for (const name of finalNames.values()) if (name) counts.set(lower(name), (counts.get(lower(name)) ?? 0) + 1)
  const existingNames = new Set(data.existing.map((d) => d.hostname).filter(Boolean).map(lower))
  return wanted.map((w) => {
    const d = byId.get(w.deviceId)
    if (!d) return { deviceId: w.deviceId, from: null, to: w.hostname, problem: 'Not a device of this design' }
    const problem = counts.get(lower(w.hostname)) > 1 ? 'Two devices would share this hostname' : existingNames.has(lower(w.hostname)) ? 'Already used by a surveyed device' : null
    return { deviceId: w.deviceId, from: d.hostname ?? null, to: w.hostname, problem }
  })
}

// LLD phase status per building (calculated).
export async function lldStatusByBuilding(session = null) {
  const designs = await LldDesign.find({}, { buildingId: 1, state: 1 }).session(session).lean()
  return new Map(designs.map((d) => [String(d.buildingId), d.state === 'approved' ? 'approved' : d.state === 'awaiting_approval' ? 'awaiting_approval' : d.state === 'changes_requested' ? 'changes_requested' : 'in_progress']))
}
