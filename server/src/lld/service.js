import mongoose from 'mongoose'
import { namePortConflict } from '../design/portConflict.js'
import crypto from 'node:crypto'
import { DEFAULT_STOCK_LENGTHS } from '@rackium/shared/cableLength.js'
import { connectionSegments, lengthBetween } from '@rackium/shared/cableSegments.js'
import { routeDistance } from '@rackium/shared/pathway.js'
import { findConflicts, computeFreeRU } from '@rackium/shared/rackValidation.js'
import { suggestNextCableId } from '@rackium/shared/cableId.js'
import { roleInfo, resolveRoleCodes } from '@rackium/shared/hldRoles.js'
import { buildHostname } from '@rackium/shared/naming.js'
import { summariseFindings } from '@rackium/shared/hldRules.js'
import { portKey, portsOf, isPatchPanel, validateLld, diffDesigns, reconcileWithHld, routeSides, routeBookings, hopProblems, pairBookings, pairConflicts, nextPanelLabel } from '@rackium/shared/lldDesign.js'
import { canApproveSubmission, rolesAllowed, ACTIONS } from '@rackium/shared/policy.js'
import { deviceDisplayName, cleanExistingLabel, withLegacyName } from '@rackium/shared/deviceName.js'
import { Device } from '../models/device.js'
import { Connection } from '../models/connection.js'
import { PortOccupancy } from '../models/portOccupancy.js'
import { CableIdRegistry } from '../models/cableIdRegistry.js'
import { LldDesign } from '../models/lldDesign.js'
import { DesignBranch } from '../models/designBranch.js'
import { HLD_LAYER, hldDesignSnapshot, copyHldIntoBranch, promoteHldBranch, discardHldBranch, writeHldVersion } from '../hld/service.js'
import { assertChangeRequestEditable, claimBranchRevision } from '../design/branchClaim.js'
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
import { retireRemovedRecords } from '../deployment/asBuilt.js'
import { assertNotHandedOver } from '../handover/guard.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { notifyQuietly, paths } from '../notifications/notify.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'

const id = (v) => (v ? String(v) : null)
const oid = (v) => new mongoose.Types.ObjectId(String(v))
const lower = (v) => String(v).trim().toLowerCase()
const MAIN = 'lld'
const layerOf = (branchId) => (branchId ? `lld:${branchId}` : MAIN)
// The ports a connection save asks for: its ends and its hops' panel ports.
const endsOf = (b) => [b.source, b.dest, ...(b.hops ?? []).flatMap((h) => [{ deviceId: h.patchPanelId, portId: h.inPort }, { deviceId: h.patchPanelId, portId: h.outPort }])].filter(Boolean)
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

function deviceView(d, cat, racks, rooms = []) {
  const item = cat.item(d.catalogueKey)
  const rack = d.rackId ? racks.find((r) => String(r._id) === String(d.rackId)) : null
  const info = roleInfo(d.role)
  const roomId = id(d.roomId ?? rack?.roomId)
  return {
    id: String(d._id),
    origin: d.origin,
    layer: d.layer ?? null,
    hldRef: id(d.hldRef),
    role: d.role ?? null,
    roleLabel: info?.label ?? null,
    hostname: d.hostname ?? null,
    // Shown everywhere a device is listed; the stored label (what was
    // placed, e.g. "24-port patch panel") still sets kind and port count.
    // A device renamed through an approved change request reads "old → new"
    // (DATA-MODEL §5.19); `name` is the current name alone (edit boxes).
    label: withLegacyName(deviceDisplayName(d, info?.label ?? 'Device'), d.legacyHostname),
    name: deviceDisplayName(d, info?.label ?? 'Device'),
    legacyHostname: d.legacyHostname ?? null,
    existingLabel: cleanExistingLabel(d.existingLabel),
    catalogueKey: d.catalogueKey ?? null,
    model: d.model ?? null,
    category: item?.category ?? d.category ?? null,
    isPanel: isPatchPanel(item, d),
    roomId,
    roomCode: roomId ? rooms.find((r) => String(r._id) === roomId)?.code ?? null : null,
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
// `conn`: a rerouted connection's rooms (route.viaRoomIds, DATA-MODEL §5.20)
// apply to its cross-room cable — the one between two rooms off its route.
function lengthOptions(rackPos, pathways, stockLengths, conn = null) {
  const via = (conn?.route?.viaRoomIds ?? []).map(String)
  return {
    rackPositionOf: (rackId) => rackPos.get(String(rackId)) ?? 1,
    routeOf: (roomA, roomB) => routeDistance(String(roomA), String(roomB), pathways, via.length && !via.includes(String(roomA)) && !via.includes(String(roomB)) ? via : []),
    stockLengths,
  }
}

// The end-to-end run (source → destination), for the channel checks.
function lengthOf(conn, deviceById, rackPos, pathways, stockLengths) {
  const length = lengthBetween(deviceById.get(id(conn.source.deviceId)), deviceById.get(id(conn.dest.deviceId)), conn.media, lengthOptions(rackPos, pathways, stockLengths, conn))
  return length.placementPending && length.situation ? { ...length, estimateReason: 'Place both devices to calculate the length' } : length
}

// HLD stage (Reroute, DATA-MODEL §5.20): an uplink routed via the destination
// room's patch panel is two cables — to the panel (in the destination's rack),
// then a patch cord to the device. The LLD designs the panel and its hops.
function viaPanelSegments(c, deviceById, rackPos, pathways, stockLengths) {
  const a = deviceById.get(String(c.source.deviceId))
  const b = deviceById.get(String(c.dest.deviceId))
  if (!a || !b) return c.segments
  const panel = { roomId: b.roomId, rackId: b.rackId, ru: null }
  const opts = lengthOptions(rackPos, pathways, stockLengths, c)
  const cable = (index, from, to, length, cableId) => ({ index, kind: 'patch_cord', from, to, cableId, ...length, engineerSelectedM: null, installedM: null, effectiveM: length.suggestedM })
  return [
    cable(0, { deviceId: String(a.id), portId: c.source.portId ?? null }, { deviceId: null, portId: null }, lengthBetween(a, panel, c.media, opts), c.cableId ?? null),
    cable(1, { deviceId: null, portId: null }, { deviceId: String(b.id), portId: c.dest.portId ?? null }, lengthBetween(panel, b, c.media, opts), null),
  ]
}

// Every cable of the route with its own lengths (shared/cableSegments.js).
function segmentsOf(conn, deviceById, rackPos, pathways, stockLengths) {
  return connectionSegments(conn, { nodeOf: (deviceId) => deviceById.get(String(deviceId)) ?? null, isPanel: (deviceId) => Boolean(deviceById.get(String(deviceId))?.isPanel), ...lengthOptions(rackPos, pathways, stockLengths, conn) })
}

function rackPositions(racks) {
  const out = new Map()
  const byRoom = new Map()
  for (const r of racks) byRoom.set(String(r.roomId), [...(byRoom.get(String(r.roomId)) ?? []), r])
  for (const list of byRoom.values()) list.forEach((r, i) => out.set(String(r._id), i + 1))
  return out
}

// `lengths` are the connection's own cable (segment 0); `segments` every
// cable of the route, each with its Suggested, Engineer Selected and
// Installed length.
function connectionView(c, length, segments = []) {
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
    // Rerouted through other rooms (DATA-MODEL §5.20).
    route: c.route?.viaRoomIds?.length ? { viaRoomIds: c.route.viaRoomIds.map(String) } : null,
    cableId: c.cableId ?? null,
    hops: (c.hops ?? []).map((h) => ({ seq: h.seq, patchPanelId: String(h.patchPanelId), inPort: h.inPort, inSide: h.inSide ?? null, outPort: h.outPort, outSide: h.outSide ?? null, segmentCableId: h.segmentCableId ?? null, roomId: id(h.roomId), rackId: id(h.rackId), ru: h.ru ?? null, lengths: { engineerSelectedM: h.lengths?.engineerSelectedM ?? null, installedM: h.lengths?.installedM ?? null } })),
    lengths: { suggestedM: segments[0]?.suggestedM ?? length.suggestedM, engineerSelectedM: engineer, effectiveM: engineer ?? segments[0]?.suggestedM ?? length.suggestedM, installedM: c.lengths?.installedM ?? null },
    length,
    segments,
    status: c.status,
  }
}

function inputs(data) {
  const cat = catalogueIndex(data.catalogue)
  const rackPos = rackPositions(data.racks)
  const views = [...data.existing, ...data.devices].map((d) => deviceView(d, cat, data.racks, data.rooms))
  const deviceById = new Map(views.map((d) => [d.id, d]))
  const { stockLengths } = data.settings
  const connections = data.connections.map((c) => connectionView(c, lengthOf(c, deviceById, rackPos, data.pathways, stockLengths), segmentsOf(c, deviceById, rackPos, data.pathways, stockLengths)))
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
      devices: data.devices.map((d) => ({ _id: String(d._id), role: d.role ?? null, hostname: d.hostname ?? null, legacyHostname: d.legacyHostname ?? null, label: d.label ?? null, model: d.model ?? null, catalogueKey: d.catalogueKey ?? null, category: d.category ?? null, roomId: id(d.roomId), rackId: id(d.rackId), ru: d.ru ?? null, heightU: d.heightU ?? null, face: d.face ?? null, fullDepth: Boolean(d.fullDepth), mounting: d.mounting ?? null, psuConfigured: d.psuConfigured ?? null, hldRef: id(d.hldRef), originId: id(d.originId), salId: id(d.salId) })),
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
        route: c.route?.viaRoomIds?.length ? { viaRoomIds: c.route.viaRoomIds.map(String) } : null,
        cableId: c.cableId ?? null,
        hops: (c.hops ?? []).map((h) => ({ seq: h.seq, patchPanelId: String(h.patchPanelId), inPort: h.inPort, inSide: h.inSide ?? null, outPort: h.outPort, outSide: h.outSide ?? null, segmentCableId: h.segmentCableId ?? null, roomId: id(h.roomId), rackId: id(h.rackId), ru: h.ru ?? null, lengths: { engineerSelectedM: h.lengths?.engineerSelectedM ?? null, installedM: h.lengths?.installedM ?? null } })),
        lengths: { engineerSelectedM: c.lengths?.engineerSelectedM ?? null, installedM: c.lengths?.installedM ?? null },
      })),
    },
  }
}

// A branch's snapshot on the main design's ids: each copied device and
// connection takes its origin id (records new on the branch keep theirs),
// endpoints and hops follow. Works on view snapshots and on raw ones.
function remapToMain(snap, data) {
  const dev = new Map(data.devices.map((d) => [String(d._id), d.originId ? String(d.originId) : String(d._id)]))
  const conn = new Map(data.connections.map((c) => [String(c._id), c.originId ? String(c.originId) : String(c._id)]))
  const d = (x) => (x == null ? x : dev.get(String(x)) ?? String(x))
  const remapConn = (c) => {
    const key = c._id !== undefined ? '_id' : 'id'
    return { ...c, [key]: conn.get(String(c[key])) ?? String(c[key]), originId: null, source: { ...c.source, deviceId: d(c.source.deviceId) }, dest: { ...c.dest, deviceId: d(c.dest.deviceId) }, hops: (c.hops ?? []).map((h) => ({ ...h, patchPanelId: d(h.patchPanelId) })) }
  }
  const remapDev = (x) => {
    const key = x._id !== undefined ? '_id' : 'id'
    return { ...x, [key]: d(x[key]), originId: null }
  }
  const out = { ...snap, devices: snap.devices.map(remapDev), connections: snap.connections.map(remapConn) }
  if (snap.raw) out.raw = remapToMain(snap.raw, data)
  return out
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
// After the Solution Package approval (M5a) the HLD and LLD are frozen: any
// change goes through a change request, which edits its own branch.
export const FROZEN_MESSAGE = 'The design is frozen by the Solution Package approval — changes go through a change request'

// A branch may be edited while it is an ordinary branch of an unfrozen LLD,
// or the branch of a change request that is still a draft (or sent back).
async function assertBranchEditable(branch, buildingId, session) {
  if (branch?.changeRequestId) return assertChangeRequestEditable(branch, session)
  const lld = await LldDesign.findOne({ buildingId }, { frozen: 1 }).session(session).lean()
  if (lld?.frozen) throw conflict('change_request_required', FROZEN_MESSAGE)
}

async function claim({ buildingId, branchId }, baseRevision, actor, session) {
  const now = new Date()
  if (branchId) {
    await assertBranchEditable(await DesignBranch.findById(branchId).session(session).lean(), buildingId, session)
    return claimBranchRevision({ branchId, buildingId }, baseRevision, actor, session)
  }
  const updated = await LldDesign.findOneAndUpdate(
    { buildingId, revision: baseRevision, state: { $ne: 'awaiting_approval' }, frozen: { $ne: true } },
    { $inc: { revision: 1 }, $set: { state: 'draft', lastEditedAt: now, lastEditedBy: actor.userId } },
    { session, returnDocument: 'after' }
  )
  if (updated) return updated
  const current = await LldDesign.findOne({ buildingId }).session(session)
  if (!current) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
  if (current.frozen) throw conflict('change_request_required', FROZEN_MESSAGE)
  if (current.state === 'awaiting_approval') throw conflict('lld_submitted', 'The LLD is submitted for approval — it can be edited again once a PM or Reviewer decides')
  throw await staleError(current, baseRevision, 'LLD')
}

// Names a planned panel label must not repeat: the layer's own labels and
// hostnames (a repeat would be Critical, L-PANEL-LABEL).
function designNamesExcept(data, deviceId) {
  return data.devices.filter((d) => String(d._id) !== String(deviceId)).flatMap((d) => [d.label, d.hostname]).filter(Boolean)
}
// Names on the surveyed gear: recorded existing labels and hostnames — a
// default label avoids them (a custom one may match: L-PANEL-LABEL-EXISTING).
function existingNames(data) {
  return data.existing.flatMap((d) => [cleanExistingLabel(d.existingLabel), d.hostname]).filter(Boolean)
}

// --- Registries (written in the caller's transaction) --------------------------

function validPort(device, portId, cat) {
  const ports = portsOf(cat.item(device.catalogueKey), device)
  if (!ports.length) return portId
  const port = ports.find((p) => lower(p.id) === lower(portId))
  if (!port) throw badRequest(`${portId} is not a port of ${deviceDisplayName(device, 'the device')}`)
  return port.id
}

// Every port a connection takes: its ends (a panel end is the front) and
// each hop (rear in, front out). One registry row each; a clash aborts.
// Every port a connection takes (shared/lldDesign.js routeBookings): device
// ports, and panel ports on the side their cable type sets — a patch cord
// (device↔panel) on the front, a trunk (panel↔panel) on the rear. One
// registry row each; a clash aborts the transaction.
const panelTest = (devices, cat) => (deviceId) => {
  const d = devices.get(String(deviceId))
  return Boolean(d) && isPatchPanel(cat.item(d.catalogueKey), d)
}
async function takePorts(conn, layer, devices, cat, session) {
  const bookings = routeBookings(conn, panelTest(devices, cat))
  const nameOf = (deviceId) => deviceDisplayName(devices.get(String(deviceId)), 'the panel')
  // One connection per panel port: refuse a side whose other side another
  // connection uses (legacy pre-occupied cabling is exempt).
  const panelIds = [...new Set(bookings.filter((b) => b.side).map((b) => b.deviceId))]
  if (panelIds.length) {
    const others = await PortOccupancy.find({ layer, deviceId: { $in: panelIds.map(oid) }, connectionId: { $ne: conn._id } }).session(session).lean()
    const connectionName = async (connectionId) => {
      const other = await Connection.findById(connectionId).session(session).lean()
      if (!other) return 'another connection'
      return `connection ${other.cableId ?? '(no Cable ID)'} (${nameOf(other.source.deviceId)} → ${nameOf(other.dest.deviceId)})`
    }
    const found = pairConflicts(bookings, others, { connectionId: conn._id, nameOf })
    if (found.length) {
      const names = new Map()
      for (const f of found) if (!names.has(f.otherConnectionId)) names.set(f.otherConnectionId, await connectionName(f.otherConnectionId))
      const detailed = pairConflicts(bookings, others, { connectionId: conn._id, nameOf, connectionName: (cid) => names.get(cid) })
      throw badRequest(detailed.map((f) => f.message).join('; '), { code: 'panel_port_split', conflicts: detailed.map(({ deviceId, portId, side, otherConnectionId }) => ({ deviceId, portId, side, otherConnectionId })) })
    }
  }
  const rows = [
    ...bookings.map((b) => ({ ...b, portKey: portKey(b.portId, b.side), who: devices.get(b.deviceId) })),
    ...pairBookings(bookings).map((p) => ({ ...p, side: null, source: 'pair', hopSeq: null, pair: true, who: devices.get(p.deviceId) })),
  ]
  for (const r of rows) {
    try {
      await PortOccupancy.create([{ layer, deviceId: oid(r.deviceId), portId: r.portId, portKey: r.portKey, connectionId: conn._id, hopSeq: r.hopSeq, source: r.source }], { session })
    } catch (err) {
      // A pair row taken meanwhile: another connection just took this port's other side.
      if (err.code === 11000 && r.pair) throw badRequest(`${nameOf(r.deviceId)} port ${r.portId}: its other side was just taken by another connection — a panel port's front and rear belong to one connection`, { code: 'panel_port_split' })
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
    const previous = (doc.hops ?? []).map((h) => (h.toObject ? h.toObject() : h))
    doc.hops = body.hops.map((h, i) => {
      const panel = devices.get(String(h.patchPanelId))
      if (!panel || !isPatchPanel(cat.item(panel.catalogueKey), panel)) throw badRequest(`Hop ${i + 1}: not a patch panel of this building`)
      const rack = data.racks.find((r) => String(r._id) === String(panel.rackId))
      // The cable after this panel keeps its lengths unless new ones are sent
      // (the same panel at the same place in the route is the same cable).
      const before = previous[i] && String(previous[i].patchPanelId) === String(panel._id) ? previous[i].lengths ?? {} : {}
      const pick = (field) => (h[field] !== undefined ? h[field] : h.lengths?.[field] !== undefined ? h.lengths[field] : before[field] ?? null)
      return { seq: i + 1, patchPanelId: panel._id, inPort: validPort(panel, h.inPort, cat), inSide: h.inSide ?? null, outPort: validPort(panel, h.outPort, cat), outSide: h.outSide ?? null, segmentCableId: h.segmentCableId ? h.segmentCableId.trim() : null, roomId: rack?.roomId ?? panel.roomId ?? null, rackId: panel.rackId ?? null, ru: panel.ru ?? null, lengths: { engineerSelectedM: pick('engineerSelectedM'), installedM: pick('installedM') } }
    })
  }
  // One cable's Engineer Selected length (cable schedule): segment 0 is the
  // connection's own cable, segment k the cable after hop k.
  for (const s of body.segmentLengths ?? []) {
    if (s.segment === 0) doc.set('lengths.engineerSelectedM', s.engineerSelectedM)
    else if (doc.hops[s.segment - 1]) doc.hops[s.segment - 1].set('lengths.engineerSelectedM', s.engineerSelectedM)
    else throw badRequest(`This connection has no cable ${s.segment + 1} — it has ${doc.hops.length + 1}`)
  }
  // Sides come from the cable types along the route; a side the client sent
  // that disagrees, or front/rear used inconsistently, is refused.
  const isPanel = panelTest(devices, cat)
  // Only sides sent with this write are checked; stored ones are re-derived
  // (an end that changed may change them).
  const route = {
    source: doc.source,
    dest: doc.dest,
    hops: doc.hops.map((h) => {
      const hop = h.toObject ? h.toObject() : { ...h }
      return body.hops !== undefined ? hop : { ...hop, inSide: null, outSide: null }
    }),
  }
  const problems = hopProblems(route, isPanel, (pid) => deviceDisplayName(devices.get(String(pid)), 'panel'))
  if (problems.length) throw badRequest(problems.map((p) => p.message).join('; '), { problems })
  const sides = routeSides(route, isPanel)
  doc.hops.forEach((h, i) => {
    h.inSide = sides.hops[i].inSide
    h.outSide = sides.hops[i].outSide
  })
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
async function copyIntoLayer({ devices, connections }, { layer, building, keepIds = false, hldRefOf = (x) => x.hldRef ?? null, carryCableIds = true, asNew = false, data, actor }, session) {
  const idMap = new Map()
  for (const d of devices) {
    const newId = keepIds ? oid(d._id ?? d.id) : new mongoose.Types.ObjectId()
    idMap.set(String(d._id ?? d.id), newId)
    // A copy into a branch remembers the main device it came from.
    const deviceOrigin = layer === MAIN || asNew ? null : keepIds ? d.originId ?? null : d.originId ?? d._id ?? d.id ?? null
    await Device.create(
      [
        {
          _id: newId,
          origin: 'planned',
          status: 'planned',
          layer,
          hldRef: hldRefOf(d),
          originId: deviceOrigin ? oid(deviceOrigin) : null,
          role: d.role ?? null,
          hostname: d.hostname ?? null,
          legacyHostname: d.legacyHostname ?? null,
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
    const originId = layer === MAIN || asNew ? null : keepIds ? c.originId ?? null : c.originId ?? c._id ?? c.id ?? null
    const doc = new Connection({ _id: keepIds ? oid(c._id ?? c.id) : new mongoose.Types.ObjectId(), buildingId: building.id, layer, hldRef: c.hldRef ?? null, originId: originId ? oid(originId) : null, source: { deviceId: map(c.source.deviceId), portId: c.source.portId ?? null }, dest: { deviceId: map(c.dest.deviceId), portId: c.dest.portId ?? null }, media: c.media, speed: c.speed, route: c.route?.viaRoomIds?.length ? { viaRoomIds: c.route.viaRoomIds.map(oid) } : null, lengths: { installedM: c.lengths?.installedM ?? null }, createdBy: actor.userId, updatedBy: actor.userId })
    await writeConnection(
      doc,
      {
        sourceSfpCode: c.sourceSfpCode ?? null,
        destSfpCode: c.destSfpCode ?? null,
        viaPatchPanel: Boolean(c.viaPatchPanel),
        cableId: carryCableIds ? c.cableId ?? null : null,
        engineerSelectedM: c.lengths?.engineerSelectedM ?? null,
        hops: (c.hops ?? []).map((h) => ({ patchPanelId: String(map(h.patchPanelId)), inPort: h.inPort, outPort: h.outPort, segmentCableId: carryCableIds ? h.segmentCableId ?? null : null, lengths: { engineerSelectedM: h.lengths?.engineerSelectedM ?? null, installedM: h.lengths?.installedM ?? null } })),
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

  async function hldSourceOf(req, building, branch, session = null) {
    if (branch?.includesHld) {
      const snap = await hldDesignSnapshot(building.id, req.project.id, { branchId: String(branch._id), session })
      return { snapshot: snap, number: null, label: `CR branch ${branch.name}` }
    }
    const version = await latestApprovedHld(building.id)
    if (!version) return null
    return { snapshot: await readSnapshot(version.snapshotFileId), number: version.number, version, label: `HLD v${version.number}` }
  }

  // HLD ↔ LLD as reconcileWithHld reads them.
  function lldSideOf(data) {
    return { devices: data.devices.map((d) => ({ id: String(d._id), hldRef: id(d.hldRef), hostname: d.hostname, label: d.label, role: d.role, catalogueKey: d.catalogueKey, roomId: id(d.roomId) })), connections: data.connections.map((c) => ({ id: String(c._id), hldRef: id(c.hldRef), source: { deviceId: String(c.source.deviceId) }, dest: { deviceId: String(c.dest.deviceId) }, media: c.media, speed: c.speed, sourceSfpCode: c.sourceSfpCode ?? null, destSfpCode: c.destSfpCode ?? null })) }
  }

  // What a change request makes inconsistent between its HLD and its LLD
  // (shared/lldDesign.js reconcileWithHld): items out of step on the branch
  // that are in step on the approved design. Each blocks the submission.
  async function consistencyOf(req, building, branch, session = null) {
    const keys = (r) => {
      const out = new Map()
      for (const [kind, part] of [['device', r.devices], ['connection', r.connections]]) {
        for (const [state, list] of [['inHldOnly', part.inHldOnly], ['inLldOnly', part.inLldOnly], ['changed', part.changed]]) for (const x of list) out.set(`${kind}:${state}:${x.id}`, { kind, state, id: x.id, label: x.label, fields: x.fields ?? null })
      }
      return out
    }
    const mainHld = await hldDesignSnapshot(building.id, req.project.id, { session })
    const before = keys(reconcileWithHld(mainHld, lldSideOf(await loadLayer(building.id, MAIN, req.project.id, session))))
    const branchHld = (await hldSourceOf(req, building, branch, session)).snapshot
    const after = keys(reconcileWithHld(branchHld, lldSideOf(await loadLayer(building.id, layerOf(String(branch._id)), req.project.id, session))))
    const problems = [...after.entries()].filter(([k]) => !before.has(k)).map(([, v]) => v)
    return { consistent: problems.length === 0, problems }
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
    await assertNotHandedOver(building.id)
    if (branch && branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
    return withTransaction(async (session) => {
      const claimed = await claim({ buildingId: building.id, branchId: branch ? String(branch._id) : null }, baseRevision, actor, session)
      const data = await loadLayer(building.id, layer, req.project.id, session)
      const out = await fn({ building, data, layer, session, revision: claimed.revision })
      return { ...out, revision: claimed.revision }
    })
  }

  async function audit(req, building, actor, action, extra) {
    // A client deciding through a share link (M5a) is recorded as the client.
    const who = actor.client ? { type: 'client_link', clientName: actor.client.name, clientRole: actor.client.role ?? null, shareLinkId: actor.client.shareLinkId } : userActor(actor.userId, actor.role)
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'lld', actor: who, action, changeType: 'design_intent', source: actor.client ? 'client_link' : 'ui', ...extra })
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

  // A new branch copied from a version or from the current main LLD (a
  // change request's branch carries its id).
  async function makeBranch(req, building, { name, fromVersionId = null, source = null, changeRequestId = null }, actor, session) {
    const [branch] = await DesignBranch.create([{ buildingId: building.id, name, parentVersionId: fromVersionId, changeRequestId, includesHld: Boolean(changeRequestId), createdBy: actor.userId, lastEditedAt: new Date(), lastEditedBy: actor.userId }], { session })
    const layer = layerOf(String(branch._id))
    if (changeRequestId) await copyHldIntoBranch({ building, branchId: String(branch._id), projectId: req.project.id, session })
    const raw = source ?? snapshotOf(await loadLayer(building.id, MAIN, req.project.id, session)).raw
    const data = await loadLayer(building.id, layer, req.project.id, session)
    await copyIntoLayer({ devices: raw.devices, connections: raw.connections }, { layer, building, data, actor }, session)
    await audit(req, building, actor, 'lld.branch.created', { objectType: 'DesignBranch', objectId: branch._id, comment: name, session })
    return { branch: { id: String(branch._id), name: branch.name, status: branch.status, revision: branch.revision } }
  }

  // Promotion replaces the main LLD with the branch; the branch closes.
  // Records copied from the main design come back under their original ids
  // (M5a), so a device or cable keeps its identity — procurement lines, the
  // BOM's comparison with its approved version and later the CMDB rely on it.
  async function promoteInto(req, building, branch, actor, session) {
    const from = layerOf(String(branch._id))
    const branchData = await loadLayer(building.id, from, req.project.id, session)
    const raw = remapToMain(snapshotOf(branchData).raw, branchData)
    const keys = (await CableIdRegistry.find({ layer: from }, { cableKey: 1 }).session(session).lean()).map((r) => r.cableKey)
    const branchConns = branchData.connections.map((c) => c._id)
    // The branch's own claims in the main registry pass to the ids its
    // connections will carry in the main design.
    for (const c of branchData.connections) {
      if (c.originId) await CableIdRegistry.updateMany({ layer: MAIN, connectionId: c._id }, { $set: { connectionId: c.originId } }, { session })
    }
    const mainConns = await clearLayer(building.id, MAIN, session)
    // The branch's IDs take over this building's main rows (and the
    // branch's own claims) for the same IDs; an ID held anywhere else in
    // the project blocks the promotion.
    const clash = await CableIdRegistry.findOne({ layer: MAIN, cableKey: { $in: keys }, connectionId: { $nin: [...mainConns, ...branchConns] } }).session(session).lean()
    if (clash) throw conflict('cable_id_in_use', `Cable ID ${clash.cableId} is already used elsewhere in this project — change it on the branch first`)
    await clearLayer(building.id, from, session)
    await CableIdRegistry.deleteMany({ layer: from }, { session })
    const data = await loadLayer(building.id, MAIN, req.project.id, session)
    await copyIntoLayer({ devices: raw.devices, connections: raw.connections }, { layer: MAIN, building, data, actor, keepIds: true }, session)
    await DesignBranch.updateOne({ _id: branch._id }, { $set: { status: 'promoted', resolvedBy: actor.userId, resolvedAt: new Date() } }, { session })
    await audit(req, building, actor, 'lld.branch.promoted', { objectType: 'DesignBranch', objectId: branch._id, comment: branch.name, session })
  }

  // A change request's rename became real (DATA-MODEL §5.19): each device of
  // the frozen LLD whose name it changed keeps its old name in legacyHostname
  // — set once, never overwritten. Returns every rename, old → new.
  async function keepLegacyNames(req, building, before, actor, session) {
    const after = new Map((await Device.find({ buildingId: building.id, layer: MAIN }).session(session).lean()).map((d) => [String(d._id), d]))
    const renamed = []
    const changes = []
    for (const old of before) {
      const now = after.get(String(old._id))
      if (!now) continue
      const from = deviceDisplayName(old, 'Device')
      const to = deviceDisplayName(now, 'Device')
      if (from === to) continue
      renamed.push({ deviceId: String(old._id), from, to })
      if (now.legacyHostname) continue
      await Device.updateOne({ _id: now._id, legacyHostname: null }, { $set: { legacyHostname: from } }, { session })
      changes.push({ objectType: 'Device', objectId: String(now._id), field: 'legacyHostname', before: null, after: from })
    }
    if (changes.length) await audit(req, building, actor, 'device.legacy_hostname.set', { objectType: 'Building', objectId: building.id, comment: `${changes.length} renamed device(s) keep their old name`, changes, session })
    return renamed
  }

  async function discardIn(req, building, branch, actor, session) {
    const layer = layerOf(String(branch._id))
    if (branch.includesHld) await discardHldBranch({ building, branchId: String(branch._id), session })
    await clearLayer(building.id, layer, session)
    await CableIdRegistry.deleteMany({ layer }, { session })
    await DesignBranch.updateOne({ _id: branch._id }, { $set: { status: 'discarded', resolvedBy: actor.userId, resolvedAt: new Date() } }, { session })
    await audit(req, building, actor, 'lld.branch.discarded', { objectType: 'DesignBranch', objectId: branch._id, comment: branch.name, session })
  }

  // The design as the BOM, Solution Package and change requests read it:
  // the main LLD (or a branch), or the HLD before the LLD starts.
  async function designData(req, buildingId, { branchId = null, session = null } = {}) {
    const lld = await LldDesign.findOne({ buildingId }).session(session).lean()
    const stage = lld ? 'lld' : 'hld'
    const layer = stage === 'hld' ? HLD_LAYER : layerOf(branchId)
    const data = await loadLayer(buildingId, layer, req.project.id, session)
    const computed = inputs(data)
    // A branch reads on the main design's ids (BOM impact compares line keys).
    const { devices: views, connections } = branchId ? remapToMain({ devices: computed.views, connections: computed.connections }, data) : { devices: computed.views, connections: computed.connections }
    const ownRaw = data.devices.filter((d) => d.origin === 'planned').map((d) => (branchId && d.originId ? String(d.originId) : String(d._id)))
    const own = new Set(ownRaw)
    const roomCode = new Map(data.rooms.map((r) => [String(r._id), r.code]))
    const devices = views.filter((d) => own.has(d.id)).map((d) => ({ ...d, roomCode: roomCode.get(d.roomId) ?? null }))
    const racks = data.racks.map((r) => ({
      id: String(r._id),
      code: r.code,
      roomId: String(r.roomId),
      roomCode: roomCode.get(String(r.roomId)) ?? null,
      cageNutType: r.mountingPower?.cageNutType ?? null,
      pduSocketType: r.mountingPower?.pduA?.socketType ?? r.mountingPower?.pduB?.socketType ?? null,
    }))
    const { summary } = runValidation(data)
    // HLD stage (Reroute, DATA-MODEL §5.20): links via a patch panel are two
    // cables, and each room's panels must take them — the BOM adds panels for
    // what its surveyed panels' free ports cannot.
    const routed = stage === 'hld' ? connections.filter((c) => c.viaPatchPanel && !(c.hops ?? []).length && ['cat6a', 'os2', 'om4'].includes(c.media)) : []
    const routedIds = new Set(routed.map((c) => c.id))
    const designConnections = connections.map((c) => (routedIds.has(c.id) ? { ...c, segments: viaPanelSegments(c, computed.deviceById, computed.rackPos, data.pathways, data.settings.stockLengths) } : c))
    const needs = new Map()
    for (const c of routed) {
      const roomId = computed.deviceById.get(String(c.dest.deviceId))?.roomId
      if (!roomId) continue
      const kind = c.media === 'cat6a' ? 'copper' : 'fibre'
      const key = `${roomId}|${kind}`
      if (!needs.has(key)) needs.set(key, { roomId, roomCode: roomCode.get(String(roomId)) ?? null, kind, links: 0, freePorts: computed.ctx.patchPanelFreePorts(roomId, kind) ?? 0 })
      needs.get(key).links += 1
    }
    return { stage, lld, devices, connections: designConnections, panelNeeds: [...needs.values()], racks, rooms: data.rooms, catalogue: data.catalogue, settings: data.settings, findings: summary }
  }

  // The main LLD as deployment and the CMDB read it (M6a): every device of
  // the layer and the surveyed gear it connects to, connections with their
  // cable segments, and the building's floors, rooms and racks.
  async function deploymentData(req, buildingId, { session = null } = {}) {
    const lld = await LldDesign.findOne({ buildingId }).session(session).lean()
    if (!lld) return { lld: null }
    const data = await loadLayer(buildingId, MAIN, req.project.id, session)
    const { views, connections, cat } = inputs(data)
    return { lld, views, connections, floors: data.floors, rooms: data.rooms, racks: data.racks, ruStates: data.ruStates, itemOf: (key) => cat.item(key) }
  }

  return {
    designData,
    deploymentData,

    // What a branch changes against the main LLD (a change request's design diff).
    // A change request's branch also diffs its HLD (main → branch, main ids).
    async diffBranch(req, buildingId, branchId, session = null) {
      const main = snapshotOf(await loadLayer(buildingId, MAIN, req.project.id, session))
      const branchData = await loadLayer(buildingId, layerOf(branchId), req.project.id, session)
      const lldDiff = diffDesigns(main, remapToMain(snapshotOf(branchData), branchData))
      const branch = await DesignBranch.findById(branchId).session(session).lean()
      if (!branch?.includesHld) return lldDiff
      const hldDiff = diffDesigns(await hldDesignSnapshot(buildingId, req.project.id, { session }), await hldDesignSnapshot(buildingId, req.project.id, { branchId, session }))
      return { ...lldDiff, hld: hldDiff, total: lldDiff.total + hldDiff.total }
    },

    // HLD ↔ LLD consistency of a change request's branch.
    async consistency(req, buildingId, branchId, session = null) {
      const { building, branch } = await context(req, buildingId, branchId)
      if (!branch.includesHld) return { consistent: true, problems: [] }
      return consistencyOf(req, building, branch, session)
    },

    // Change requests (M5a): the branch a change request edits.
    async createChangeRequestBranch(req, { building, name, changeRequestId }, actor, session) {
      return makeBranch(req, building, { name, changeRequestId }, actor, session)
    },

    // An approved change request: its branch replaces the frozen LLD, which
    // gets a new approved, frozen version. Runs in the approval's transaction.
    async applyChangeRequest(req, { building, branchId, label }, actor, session) {
      const branch = await DesignBranch.findById(branchId).session(session).lean()
      if (!branch || branch.status !== 'open') throw conflict('branch_closed', 'The change request branch was promoted or discarded')
      let hldVersion = null
      // The HLD gets a new frozen version only when the change touched it.
      const hldChanged = branch.includesHld && diffDesigns(await hldDesignSnapshot(building.id, req.project.id, { session }), await hldDesignSnapshot(building.id, req.project.id, { branchId: String(branch._id), session })).total > 0
      if (branch.includesHld && !hldChanged) await discardHldBranch({ building, branchId: String(branch._id), session })
      if (hldChanged) {
        await promoteHldBranch({ building, branchId: String(branch._id), projectId: req.project.id, session })
        const hldDoc = await HldDesign.findOne({ buildingId: building.id }).session(session).lean()
        hldVersion = await writeHldVersion({ storage, building, projectId: req.project.id, design: hldDoc, actor, label, session })
        await DesignVersion.updateOne({ _id: hldVersion.versionId }, { $set: { frozen: true, frozenAt: new Date() } }, { session })
        await HldDesign.updateOne({ _id: hldDoc._id }, { $set: { latestApprovedVersionId: hldVersion.versionId, state: 'approved' }, $inc: { revision: 1 } }, { session })
      }
      // Names of the frozen design's devices, for retiring the ones the change removes.
      const before = await Device.find({ buildingId: building.id, layer: MAIN }).session(session).lean()
      const labels = new Map(before.map((d) => [String(d._id), d.hostname ?? d.label ?? 'device']))
      await promoteInto(req, building, branch, actor, session)
      const renamed = await keepLegacyNames(req, building, before, actor, session)
      await retireRemovedRecords({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, reason: label, labels, session })
      const data = await loadLayer(building.id, MAIN, req.project.id, session)
      const lld = await LldDesign.findOne({ buildingId: building.id }).session(session).lean()
      const basedOn = hldVersion ? { basedOnHldVersionId: hldVersion.versionId, basedOnHldNumber: hldVersion.number } : {}
      const { versionId, number } = await writeVersion({ building, data, actor, label, branchId: null, basedOnVersionId: basedOn.basedOnHldVersionId ?? lld.basedOnHldVersionId, session })
      await DesignVersion.updateOne({ _id: versionId }, { $set: { frozen: true, frozenAt: new Date() } }, { session })
      await LldDesign.updateOne({ _id: lld._id }, { $set: { latestApprovedVersionId: versionId, state: 'approved', ...basedOn }, $inc: { revision: 1 } }, { session })
      return { versionId: String(versionId), number, hldVersionId: hldVersion ? String(hldVersion.versionId) : null, hldNumber: hldVersion?.number ?? null, renamed }
    },

    async discardChangeRequestBranch(req, { building, branchId }, actor, session) {
      const branch = await DesignBranch.findById(branchId).session(session).lean()
      if (branch && branch.status === 'open') await discardIn(req, building, branch, actor, session)
    },

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
        branch: branch ? { id: String(branch._id), name: branch.name, status: branch.status, changeRequestId: id(branch.changeRequestId), includesHld: Boolean(branch.includesHld) } : null,
        floors: data.floors.map((f) => ({ id: String(f._id), token: f.token, name: f.name, order: f.order })),
        rooms: data.rooms.map((r) => ({ id: String(r._id), floorId: String(r.floorId), code: r.code, isMainRoom: Boolean(r.isMainRoom) })),
        racks: rackViews,
        devices: views.map((d) => ({ ...d, inDesign: own.has(d.id), occupied: (occupancyByDevice.get(d.id) ?? []).map((o) => ({ portKey: o.portKey, connectionId: id(o.connectionId), source: o.source })) })),
        connections,
        cableIdSuggestion: suggestNextCableId(allIds.map((r) => r.cableKey)),
        versions: versions.map((v) => ({ id: String(v._id), number: v.number, label: v.label, frozen: v.frozen, branchId: id(v.branchId), counts: v.counts, createdAt: v.createdAt, createdBy: names.get(String(v.createdBy)) ?? null })),
        branches: branches.map((b) => ({ id: String(b._id), name: b.name, status: b.status, parentVersionId: id(b.parentVersionId), changeRequestId: id(b.changeRequestId), createdAt: b.createdAt })),
        approvals: approvals.map((a) => ({ id: String(a._id), status: a.status, submittedBy: names.get(String(a.submittedBy)) ?? null, submittedById: String(a.submittedBy), submittedAt: a.submittedAt, versionNumber: versions.find((v) => String(v._id) === String(a.designVersionId))?.number ?? null, decision: a.decision ? { value: a.decision.value, decidedBy: names.get(String(a.decision.decidedBy)) ?? null, decidedAt: a.decision.decidedAt, comments: a.decision.comments ?? null } : null })),
        renameLocked: Boolean(lld.latestApprovedVersionId) && !branch?.changeRequestId,
        frozen: Boolean(lld.frozen),
        changeRequestBranch: Boolean(branch?.changeRequestId),
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
    // On a change request's branch: the branch's HLD against its LLD.
    async reconciliation(req, buildingId, branchId = null) {
      const { building, lld, branch, layer } = await context(req, buildingId, branchId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      const source = await hldSourceOf(req, building, branch)
      const data = await loadLayer(building.id, layer, req.project.id)
      const result = reconcileWithHld({ devices: source.snapshot.devices, connections: source.snapshot.connections }, lldSideOf(data))
      if (branch?.includesHld) return { basedOnNumber: lld.basedOnHldNumber, hldNumber: lld.basedOnHldNumber, changed: result.total > 0, branch: true, ...result }
      return { basedOnNumber: lld.basedOnHldNumber, hldNumber: source.number, changed: source.number > lld.basedOnHldNumber, ...result }
    },

    // Copies chosen HLD items into the LLD (explicit, per item).
    async copyFromHld(req, { buildingId, branchId = null, hldDeviceIds, hldConnectionIds, baseRevision }, actor) {
      const { building: b, branch } = await context(req, buildingId, branchId)
      if (branch && !branch.includesHld) throw conflict('not_a_change_request', 'Copy from the HLD into the main LLD, or into a change request’s branch')
      const source = await hldSourceOf(req, b, branch)
      if (!source) throw conflict('hld_not_approved', 'No approved HLD to copy from')
      const { snapshot } = source
      const fromLabel = source.label
      const into = branch ? layerOf(String(branch._id)) : MAIN
      return write(req, { buildingId, branchId }, baseRevision, actor, async ({ building, data, session }) => {
        const devices = snapshot.devices.filter((d) => hldDeviceIds.includes(d.id))
        if (devices.length !== hldDeviceIds.length) throw notFound('A device is not in the approved HLD')
        const inLld = new Map(data.devices.filter((d) => d.hldRef).map((d) => [String(d.hldRef), String(d._id)]))
        for (const d of devices) if (inLld.has(d.id)) throw conflict('already_in_lld', `${d.hostname ?? d.label} is already in the LLD`)
        const idMap = await copyIntoLayer({ devices: devices.map((d) => ({ ...d, _id: d.id, hldRef: d.id, ru: null })), connections: [] }, { layer: into, building, data, actor, carryCableIds: false, asNew: Boolean(branch) }, session)
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
        const fresh = { ...data, devices: await Device.find({ buildingId: building.id, layer: into }).session(session).lean() }
        await copyIntoLayer({ devices: [], connections: mapped }, { layer: into, building, data: fresh, actor, carryCableIds: false, asNew: Boolean(branch) }, session)
        await audit(req, building, actor, 'lld.copied_from_hld', { objectType: 'Building', objectId: building.id, comment: `${devices.length} device(s), ${conns.length} uplink(s) from ${fromLabel}`, session })
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
        // Labels are unique in the building (rack codes repeat per room):
        // default PP-<room>-<rack>-NN / CM-…, the next number not yet used.
        const room = data.rooms.find((r) => String(r._id) === String(rack.roomId))
        const designNames = designNamesExcept(data, null)
        if (body.label && designNames.some((l) => l.toLowerCase() === body.label.toLowerCase())) throw conflict('label_in_use', `${body.label} is already used in this design — panel labels are unique per building`)
        const label = body.label ?? nextPanelLabel({ prefix: item.category === 'patch_panel' ? 'PP' : 'CM', room: room?.code, rack: rack.code }, [...designNames, ...existingNames(data)])
        const device = new Device({ origin: 'planned', status: 'planned', layer, salId: building.salId, buildingId: building.id, roomId: rack.roomId, rackId: rack._id, ru: body.ru, heightU: item.heightU ?? 1, face: body.face, fullDepth: Boolean(item.fullDepth), mounting: item.mounting === '0U' ? '0U' : 'rack', label, model: item.model, catalogueKey: item.key, category: item.category })
        if (body.ru != null) assertPlacement(device, rack, data)
        await device.save({ session })
        await audit(req, building, actor, 'lld.device.added', { objectType: 'Device', objectId: device._id, comment: `${label} in ${rack.code}${body.ru ? ` RU${body.ru}` : ''}`, session })
        return { device: deviceView(device.toObject(), cat, data.racks, data.rooms) }
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
          if (item && !item.rackMounted) throw badRequest(`${deviceDisplayName(device)} is not rack-mounted`)
          Object.assign(device, { rackId: rack._id, roomId: rack.roomId, ru: body.ru, face: body.face })
          if (body.ru != null) assertPlacement(device, rack, data, catalogueIndex(data.catalogue))
        } else {
          Object.assign(device, { rackId: null, ru: null })
        }
        await device.save({ session })
        await audit(req, building, actor, 'lld.device.placed', { objectType: 'Device', objectId: device._id, changes: [{ objectType: 'Device', objectId: String(device._id), field: 'placement', before: `${before.rackId ?? '—'} RU${before.ru ?? '—'} ${before.face ?? ''}`.trim(), after: `${id(device.rackId) ?? '—'} RU${device.ru ?? '—'} ${device.face}` }], session })
        return { device: deviceView(device.toObject(), catalogueIndex(data.catalogue), data.racks, data.rooms) }
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

    // Renames a planned patch panel or cable manager (fix/cmo-naming-gaps):
    // how the Architect resolves L-PANEL-LABEL and L-PANEL-LABEL-EXISTING.
    // Hostname-safe (contract) and unique among the design's devices; an
    // existing panel's recorded label is allowed (validation warns).
    async relabel(req, deviceId, body, actor) {
      const existing = await deviceInLayer(req, deviceId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, body.baseRevision, actor, async ({ building, data, session }) => {
        const cat = catalogueIndex(data.catalogue)
        const device = await Device.findById(deviceId).session(session)
        const item = cat.item(device.catalogueKey)
        if (!isPatchPanel(item, device) && (item?.category ?? device.category) !== 'cable_management') {
          throw badRequest('Only patch panels and cable managers are renamed here — devices are renamed by hostname')
        }
        if (designNamesExcept(data, deviceId).some((l) => l.toLowerCase() === body.label.toLowerCase())) {
          throw conflict('label_in_use', `${body.label} is already used in this design — panel labels are unique per building`)
        }
        const before = device.label ?? null
        if (before !== body.label) {
          device.label = body.label
          await device.save({ session })
          await audit(req, building, actor, 'lld.device.relabelled', { objectType: 'Device', objectId: device._id, comment: `${before ?? '—'} → ${body.label}`, changes: [{ objectType: 'Device', objectId: String(device._id), field: 'label', before, after: body.label }], session })
        }
        return { device: deviceView(device.toObject(), cat, data.racks, data.rooms) }
      })
    },

    async createConnection(req, body, actor) {
      return write(req, body, body.baseRevision, actor, async ({ building, data, layer, session, revision }) => {
        const doc = new Connection({ buildingId: building.id, layer, source: body.source, dest: body.dest, media: body.media, speed: body.speed, createdBy: actor.userId, updatedBy: actor.userId, edited: { layer, revision } })
        await writeConnection(doc, body, { layer, data, isNew: true }, session)
        await audit(req, building, actor, 'lld.connection.created', { objectType: 'Connection', objectId: doc._id, comment: `${doc.media.toUpperCase()}${doc.cableId ? ` · ${doc.cableId}` : ''}`, session })
        data.connections.push(doc.toObject())
        return { connection: inputs(data).connections.find((c) => c.id === String(doc._id)) }
      }).catch(async (err) => {
        throw await namePortConflict(err, { layer: layerOf(body.branchId ?? null), baseRevision: body.baseRevision, ends: endsOf(body) })
      })
    },

    // Rackium Editor: ports, hops, cable IDs, media, Engineer Selected length.
    async updateConnection(req, connectionId, body, actor) {
      const existing = await connectionInLayer(req, connectionId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, body.baseRevision, actor, async ({ building, data, layer, session, revision }) => {
        const doc = await Connection.findById(connectionId).session(session)
        const before = connectionView(doc.toObject(), {})
        doc.updatedBy = actor.userId
        doc.edited = { layer, revision }
        await writeConnection(doc, body, { layer, data, isNew: false }, session)
        const after = connectionView(doc.toObject(), {})
        // Hop lengths are logged as cable lengths, not as a route change.
        const audited = (v) => ({ ...v, hops: v.hops.map(({ lengths: _lengths, ...h }) => h) })
        const [b, a] = [audited(before), audited(after)]
        const fields = ['source', 'dest', 'media', 'speed', 'sourceSfpCode', 'destSfpCode', 'cableId', 'hops']
        const changes = fields.filter((f) => JSON.stringify(b[f]) !== JSON.stringify(a[f])).map((f) => ({ objectType: 'Connection', objectId: connectionId, field: f, before: b[f] ?? null, after: a[f] ?? null }))
        if (before.lengths.engineerSelectedM !== after.lengths.engineerSelectedM) changes.push({ objectType: 'Connection', objectId: connectionId, field: 'engineerSelectedM', before: before.lengths.engineerSelectedM, after: after.lengths.engineerSelectedM })
        after.hops.forEach((h, i) => {
          const was = before.hops[i]?.lengths.engineerSelectedM ?? null
          if (before.hops[i] && h.patchPanelId === before.hops[i].patchPanelId && was !== h.lengths.engineerSelectedM) changes.push({ objectType: 'Connection', objectId: connectionId, field: `cable ${i + 2} engineerSelectedM`, before: was, after: h.lengths.engineerSelectedM })
        })
        await audit(req, building, actor, 'lld.connection.updated', { objectType: 'Connection', objectId: doc._id, changes, session })
        data.connections = data.connections.map((c) => (String(c._id) === connectionId ? doc.toObject() : c))
        return { connection: inputs(data).connections.find((c) => c.id === connectionId) }
      }).catch(async (err) => {
        throw await namePortConflict(err, { layer: existing.layer, baseRevision: body.baseRevision, connectionId, ends: endsOf(body) })
      })
    },

    async deleteConnection(req, connectionId, { baseRevision }, actor) {
      const existing = await connectionInLayer(req, connectionId)
      return write(req, { buildingId: existing.buildingId, branchId: branchOfLayer(existing.layer) }, baseRevision, actor, async ({ building, layer, session }) => {
        await releaseConnection(existing._id, layer, session)
        await Connection.deleteOne({ _id: existing._id }, { session })
        await audit(req, building, actor, 'lld.connection.deleted', { objectType: 'Connection', objectId: existing._id, comment: existing.cableId ?? null, session })
        return { deleted: connectionId }
      }).catch(async (err) => {
        throw await namePortConflict(err, { layer: existing.layer, baseRevision, connectionId })
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
      if (lld?.latestApprovedVersionId || lld?.frozen) {
        const branch = body.branchId && mongoose.isValidObjectId(body.branchId) ? await DesignBranch.findById(body.branchId).lean() : null
        if (!branch?.changeRequestId) throw conflict('change_request_required', 'The LLD has been approved — rename hostnames through a change request')
      }
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
          const data = await loadLayer(building.id, layer, req.project.id)
          // A branch is compared on the main design's ids (M5a).
          return { label: branchId ? 'Branch (current)' : 'Current LLD', snap: branchId ? remapToMain(snapshotOf(data), data) : snapshotOf(data) }
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
      if (lld.frozen) throw conflict('change_request_required', FROZEN_MESSAGE)
      return withTransaction((session) => makeBranch(req, building, { name: body.name, fromVersionId: body.fromVersionId ?? null, source }, actor, session))
    },

    // Promotion replaces the main LLD with the branch; the branch closes.
    async promoteBranch(req, branchId, { baseRevision }, actor) {
      const branch = mongoose.isValidObjectId(branchId) ? await DesignBranch.findById(branchId).lean() : null
      if (!branch) throw notFound('Branch not found')
      if (branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
      if (branch.changeRequestId) throw conflict('change_request_branch', 'This branch belongs to a change request — it is applied when the client approves the change')
      return write(req, { buildingId: String(branch.buildingId) }, baseRevision, actor, async ({ building, session }) => {
        await promoteInto(req, building, branch, actor, session)
        return { promoted: String(branch._id) }
      })
    },

    async discardBranch(req, branchId, actor) {
      const branch = mongoose.isValidObjectId(branchId) ? await DesignBranch.findById(branchId).lean() : null
      if (!branch) throw notFound('Branch not found')
      const building = await requireBuilding(req, branch.buildingId)
      if (branch.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
      if (branch.changeRequestId) throw conflict('change_request_branch', 'This branch belongs to a change request — withdraw or reject the change instead')
      return withTransaction(async (session) => {
        await discardIn(req, building, branch, actor, session)
        return { discarded: String(branch._id) }
      })
    },

    // --- Workflow ----------------------------------------------------------------

    async submit(req, { buildingId, baseRevision }, actor) {
      const { building, lld } = await context(req, buildingId)
      if (!lld) throw conflict('lld_not_started', 'Start the LLD from the approved HLD first')
      if (lld.frozen) throw conflict('change_request_required', FROZEN_MESSAGE)
      if (lld.state === 'awaiting_approval') throw conflict('lld_submitted', 'The LLD is already submitted for approval')
      if (lld.revision !== baseRevision) throw await staleError(lld, baseRevision, 'LLD')
      const data = await loadLayer(building.id, MAIN, req.project.id)
      if (!data.devices.length) throw conflict('empty_lld', 'There is nothing to submit')
      const { findings, summary } = runValidation(data)
      if (summary.blocksSubmit) throw new AppError(409, 'validation_blocked', `${summary.critical} Critical finding(s) must be fixed before the LLD can be submitted`, { summary, findings: findings.filter((f) => f.severity === 'critical') })
      const submitted = await withTransaction(async (session) => {
        const claimed = await LldDesign.findOneAndUpdate({ buildingId: building.id, revision: baseRevision, state: { $ne: 'awaiting_approval' } }, { $inc: { revision: 1 }, $set: { state: 'awaiting_approval' } }, { session, returnDocument: 'after' })
        if (!claimed) throw await staleError(await LldDesign.findOne({ buildingId: building.id }).session(session), baseRevision, 'LLD')
        const { versionId, number } = await writeVersion({ building, data, actor, label: 'Submitted for approval', branchId: null, basedOnVersionId: lld.basedOnHldVersionId, session })
        const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'lld', gate: 'lld_internal', designVersionId: versionId, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
        await LldDesign.updateOne({ _id: claimed._id }, { $set: { pendingApprovalId: approval._id } }, { session })
        await audit(req, building, actor, 'lld.submitted', { objectType: 'DesignVersion', objectId: versionId, comment: `LLD v${number} submitted (${summary.warning} warning(s))`, session })
        return { revision: claimed.revision, versionNumber: number, approvalId: String(approval._id) }
      })
      await notifyQuietly({ type: 'lld_submitted', buildingId: building.id, title: `LLD v${submitted.versionNumber} of ${building.code} submitted for approval`, relatedObjectType: 'lld', relatedObjectId: submitted.approvalId, link: paths.building(req.org.id, req.project.id, building.id, 'lld'), actorId: actor.userId, to: { roles: rolesAllowed(ACTIONS.APPROVE_HLD_LLD_SP_INTERNAL).filter((r) => r !== 'org_admin') } })
      return submitted
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
      const result = await withTransaction(async (session) => {
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
      await notifyQuietly({ type: decision === 'approved' ? 'lld_approved' : 'lld_changes_requested', buildingId: building.id, title: decision === 'approved' ? `LLD of ${building.code} approved` : `Changes requested to the LLD of ${building.code}`, body: String(comment ?? '').trim() || null, relatedObjectType: 'lld', relatedObjectId: approval._id, link: paths.building(req.org.id, req.project.id, building.id, 'lld'), actorId: actor.userId, to: { userIds: [approval.submittedBy] } })
      return result
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
      .map((d) => ({ id: String(d._id), ru: d.ru, heightU: catalogueIndex(data.catalogue).item(d.catalogueKey)?.heightU ?? d.heightU, face: d.face ?? 'front', fullDepth: Boolean(d.fullDepth), kind: 'device', label: deviceDisplayName(d, 'device') })),
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
