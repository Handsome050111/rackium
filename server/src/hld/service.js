import mongoose from 'mongoose'
import crypto from 'node:crypto'
import { computeSuggestedLength } from '@rackium/shared/cableLength.js'
import { findSurveyedDistance } from '@rackium/shared/pathway.js'
import { expandPortMap } from '@rackium/shared/catalogue.js'
import { computeFreeRU } from '@rackium/shared/rackValidation.js'
import { HLD_ROLES, roleInfo, nextHostname, defaultModelFor, resolveRoleCodes, PROPOSED_ROLE_CODE_KEYS } from '@rackium/shared/hldRoles.js'
import { generateFromBlueprint, BLUEPRINT_PRESETS, BLUEPRINT_VARIANTS, blueprintProblem, defaultVariantOf } from '@rackium/shared/hldBlueprints.js'
import { validateHld, uplinkChecks, summariseFindings } from '@rackium/shared/hldRules.js'
import { canApproveSubmission } from '@rackium/shared/policy.js'
import { DesignBranch } from '../models/designBranch.js'
import { ChangeRequest } from '../models/changeRequest.js'
import { assertChangeRequestEditable, claimBranchRevision } from '../design/branchClaim.js'
import { Device } from '../models/device.js'
import { Connection } from '../models/connection.js'
import { PortOccupancy } from '../models/portOccupancy.js'
import { CableIdRegistry } from '../models/cableIdRegistry.js'
import { CanvasPosition } from '../models/canvasPosition.js'
import { HldDesign } from '../models/hldDesign.js'
import { DesignVersion } from '../models/designVersion.js'
import { Approval } from '../models/approval.js'
import { DesignFlag } from '../models/designFlag.js'
import { SurveyTabRecord } from '../models/surveyTabRecord.js'
import { AuditEntry } from '../models/auditEntry.js'
import { File } from '../models/file.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Pathway } from '../models/pathway.js'
import { Country } from '../models/country.js'
import { Organisation } from '../models/organisation.js'
import { User } from '../models/user.js'
import { projectCatalogue } from '../catalogue/service.js'
import { surveyStatusByBuilding } from '../survey/formService.js'
import { withTransaction } from '../db/transaction.js'
import { currentScope } from '../tenancy/scopeContext.js'
import { recordAudit, userActor } from '../audit/audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../http/errors.js'
import { callerAccess, requireBuilding } from '../access/scope.js'

const oid = (v) => new mongoose.Types.ObjectId(String(v))
// The HLD's design layer (M4b). Rows from before M4b carry no layer; existing
// (surveyed) devices carry none either and are shared by every design.
export const HLD_LAYER = { $in: [null, 'hld'] }
// A change request's branch (M5a review) carries its HLD changes in its own
// layer 'hld:<branchId>' (next to 'lld:<branchId>'); copies remember the main
// record in `originId`.
export const hldLayerOf = (branchId) => (branchId ? `hld:${branchId}` : 'hld')
const branchOfHldLayer = (layer) => (layer?.startsWith('hld:') ? layer.slice(4) : null)
const inHld = (doc) => doc && (doc.layer == null || doc.layer === 'hld' || Boolean(doc.layer?.startsWith('hld:')))
// The layer filter of a read: the main HLD (with pre-M4b rows) or a branch.
const layerFilter = (branchId) => (branchId ? hldLayerOf(branchId) : HLD_LAYER)
const id = (v) => (v ? String(v) : null)
const lower = (v) => String(v).trim().toLowerCase()

// --- Loading -----------------------------------------------------------------

async function designOf(buildingId) {
  const existing = await HldDesign.findOne({ buildingId })
  if (existing) return existing
  try {
    return await HldDesign.create({ buildingId })
  } catch (err) {
    if (err.code === 11000) return HldDesign.findOne({ buildingId })
    throw err
  }
}

// Rooms and racks of the verified survey, the building's devices (planned
// for the canvas; existing too, for the rack rules), its connections, the
// project's pathways and the resolved catalogue.
// `branchId`: a change request's branch layer instead of the main HLD; it
// shares the surveyed (existing) devices.
async function loadDesign(buildingId, projectId, session = null, branchId = null) {
  const floors = await Floor.find({ buildingId }).sort({ order: 1 }).session(session).lean()
  const rooms = await Room.find({ buildingId }).sort({ code: 1 }).session(session).lean()
  const racks = await Rack.find({ buildingId }).sort({ code: 1 }).session(session).lean()
  const deviceFilter = branchId ? { buildingId, $or: [{ layer: hldLayerOf(branchId) }, { layer: null, origin: 'existing' }] } : { buildingId, layer: HLD_LAYER }
  const devices = await Device.find(deviceFilter).session(session).lean()
  const connections = await Connection.find({ buildingId, layer: layerFilter(branchId) }).sort({ createdAt: 1 }).session(session).lean()
  const positions = await CanvasPosition.find({ buildingId, designType: 'hld' }).session(session).lean()
  const pathwayRows = await Pathway.find().session(session).lean()
  const occupancy = await PortOccupancy.find({ layer: layerFilter(branchId), deviceId: { $in: devices.map((d) => d._id) } }, { deviceId: 1 }).session(session).lean()
  const catalogue = await projectCatalogue(projectId)
  const pathways = pathwayRows.map((p) => ({ fromRoomId: String(p.roomLowId), toRoomId: String(p.roomHighId), routeStatus: p.routeStatus, distanceM: p.distanceM ?? null }))
  return { floors, rooms, racks, devices, connections, positions, pathways, catalogue, occupancy }
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

// Rack position within its room (1-based, by code) for the same-room length formula.
function rackPositions(racks) {
  const out = new Map()
  const byRoom = new Map()
  for (const r of racks) byRoom.set(String(r.roomId), [...(byRoom.get(String(r.roomId)) ?? []), r])
  for (const list of byRoom.values()) list.forEach((r, i) => out.set(String(r._id), i + 1))
  return out
}

// Brief §6.3 length for a link, from where its ends are and the surveyed pathways.
function lengthOf(conn, deviceById, rackPos, pathways) {
  const a = deviceById.get(id(conn.source.deviceId))
  const b = deviceById.get(id(conn.dest.deviceId))
  if (!a?.roomId || !b?.roomId) return { lengthM: null, lengthEstimated: true, customLengthRequired: false, suggestedM: null, situation: null }
  const end = (d, extra = {}) => ({ rackId: id(d.rackId), roomId: id(d.roomId), ru: d.ru ?? 1, rackPosition: d.rackId ? rackPos.get(id(d.rackId)) ?? 1 : 1, ...extra })
  const surveyed = findSurveyedDistance(id(a.roomId), id(b.roomId), pathways)
  const r = computeSuggestedLength({ source: end(a), dest: end(b, { surveyedPathwayLength: surveyed }), media: conn.media })
  return { lengthM: r.rawMeters, lengthEstimated: r.estimated, customLengthRequired: r.customLengthRequired, suggestedM: r.suggested, situation: r.situation }
}

// Patch-panel free ports per room and media kind (VAL-004): panels in the
// room's racks, their ports from the catalogue (or the label), minus occupancy.
function patchPanelCounter(data, cat) {
  const rackRoom = new Map(data.racks.map((r) => [String(r._id), String(r.roomId)]))
  const used = new Map()
  for (const o of data.occupancy) used.set(String(o.deviceId), (used.get(String(o.deviceId)) ?? 0) + 1)
  const panels = data.devices
    .filter((d) => d.rackId && (cat.item(d.catalogueKey)?.category === 'patch_panel' || /patch panel/i.test(`${d.category ?? ''} ${d.label ?? ''}`)))
    .map((d) => {
      const item = cat.item(d.catalogueKey)
      const ports = item?.portMap ? expandPortMap(item.portMap) : null
      const total = ports?.length ?? Number(String(d.label ?? '').match(/(\d+)-port/)?.[1] ?? 24)
      const fibre = ports ? !ports.some((p) => /RJ45/i.test(p.type)) : /fibre|fiber|lc/i.test(`${d.label ?? ''} ${d.model ?? ''}`)
      return { roomId: rackRoom.get(String(d.rackId)), kind: fibre ? 'fibre' : 'copper', free: total - (used.get(String(d._id)) ?? 0) }
    })
  return (roomId, kind) => {
    const inRoom = panels.filter((p) => p.roomId === String(roomId) && p.kind === kind)
    return inRoom.length ? inRoom.reduce((sum, p) => sum + Math.max(0, p.free), 0) : null
  }
}

const toDeviceView = (d, cat, positions) => {
  const info = roleInfo(d.role)
  const pos = positions?.find((p) => String(p.objectId) === String(d._id))
  return {
    id: String(d._id),
    origin: d.origin,
    role: d.role,
    roleLabel: info?.label ?? null,
    hostname: d.hostname ?? null,
    label: d.hostname ?? d.label ?? info?.label ?? 'Device',
    catalogueKey: d.catalogueKey ?? null,
    model: d.model ?? null,
    category: cat.item(d.catalogueKey)?.category ?? null,
    roomId: id(d.roomId),
    rackId: id(d.rackId),
    ru: d.ru ?? null,
    heightU: d.heightU ?? null,
    psuConfigured: d.psuConfigured ?? null,
    // The model's port IDs (Edit Uplink suggestions; ports are optional in HLD).
    ports: (() => {
      const item = cat.item(d.catalogueKey)
      return item?.portMap ? expandPortMap(item.portMap).map((p) => p.id) : []
    })(),
    position: pos ? { x: pos.x, y: pos.y } : null,
  }
}

const toConnectionView = (c, length) => ({
  id: String(c._id),
  source: { deviceId: String(c.source.deviceId), portId: c.source.portId ?? null },
  dest: { deviceId: String(c.dest.deviceId), portId: c.dest.portId ?? null },
  media: c.media,
  speed: c.speed,
  sourceSfpCode: c.sourceSfpCode ?? null,
  destSfpCode: c.destSfpCode ?? null,
  viaPatchPanel: Boolean(c.viaPatchPanel),
  cableId: c.cableId ?? null,
  hops: c.hops ?? [],
  lengths: { suggestedM: length.suggestedM, engineerSelectedM: c.lengths?.engineerSelectedM ?? null },
  length,
  status: c.status,
})

// Everything the rules need, from loaded data.
function ruleInputs(data) {
  const cat = catalogueIndex(data.catalogue)
  const rackPos = rackPositions(data.racks)
  const deviceViews = data.devices.map((d) => ({ ...toDeviceView(d, cat), face: d.face ?? 'front', fullDepth: Boolean(d.fullDepth), label: d.hostname ?? d.label ?? roleInfo(d.role)?.label ?? 'device' }))
  const deviceById = new Map(deviceViews.map((d) => [d.id, d]))
  const connections = data.connections.map((c) => toConnectionView(c, lengthOf(c, deviceById, rackPos, data.pathways)))
  const ctx = {
    deviceById,
    itemOf: (d) => cat.item(d.catalogueKey),
    opticOf: (code) => cat.optic(code),
    patchPanelFreePorts: patchPanelCounter(data, cat),
  }
  return { cat, rackPos, deviceViews, deviceById, connections, ctx }
}

function runValidation(data) {
  const { deviceViews, connections, ctx } = ruleInputs(data)
  const racks = data.racks.map((r) => ({ id: String(r._id), code: r.code, heightU: r.heightU, maxLoadKg: r.details?.maxLoadKg ?? null }))
  const cmoUnplaced = data.devices.filter((d) => d.origin === 'existing' && d.importBatchId && !d.rackId).map((d) => ({ id: String(d._id), label: d.hostname ?? d.installation?.serial ?? 'device' }))
  const findings = validateHld({ devices: deviceViews, connections: connections.map((c) => ({ ...c, ...c.length })), racks, cmoUnplaced }, ctx)
  return { findings, summary: summariseFindings(findings) }
}

// --- Revisions (brief §6.10: a stale save is refused, never merged) ----------

async function namesOf(ids) {
  const list = [...new Set(ids.filter(Boolean).map(String))]
  if (!list.length) return new Map()
  return new Map((await User.find({ _id: { $in: list } }, { name: 1, email: 1 }).lean()).map((u) => [String(u._id), u.name || u.email]))
}

async function staleError(design, baseRevision) {
  const who = (await namesOf([design?.lastEditedBy])).get(String(design?.lastEditedBy)) ?? 'someone'
  return new AppError(409, 'stale_revision', `This HLD was changed by ${who} since you loaded it (revision ${design?.revision ?? 0}, yours ${baseRevision}). Reload to see the latest, then make your change again.`, {
    revision: design?.revision ?? 0,
    lastEditedBy: who,
    lastEditedAt: design?.lastEditedAt ?? null,
  })
}

// Claims the next revision, or refuses: a submitted HLD is locked until it is
// decided; a write based on an older revision is stale. An edit after
// approval or a change request starts a new draft.
async function claimRevision(buildingId, baseRevision, actor, session) {
  const updated = await HldDesign.findOneAndUpdate(
    { buildingId, revision: baseRevision, state: { $ne: 'awaiting_approval' }, frozen: { $ne: true } },
    { $inc: { revision: 1 }, $set: { state: 'draft', lastEditedAt: new Date(), lastEditedBy: actor.userId } },
    { session, returnDocument: 'after' }
  )
  if (updated) return updated
  const current = await HldDesign.findOne({ buildingId }).session(session)
  // Frozen by the Solution Package approval (M5a).
  if (current?.frozen) throw conflict('change_request_required', 'The design is frozen by the Solution Package approval — changes go through a change request')
  if (current?.state === 'awaiting_approval') throw conflict('hld_submitted', 'The HLD is submitted for approval — it can be edited again once a PM or Reviewer decides')
  throw await staleError(current, baseRevision)
}

// --- Ports and cable IDs (registries, written in the caller's transaction) ---

function portOf(device, portId, cat) {
  if (!portId) return null
  const item = cat.item(device.catalogueKey)
  const ports = item?.portMap ? expandPortMap(item.portMap) : null
  if (!ports) return portId
  const port = ports.find((p) => lower(p.id) === lower(portId))
  if (!port) throw badRequest(`${portId} is not a port of ${item.vendor} ${item.model}`)
  return port.id
}

async function takePorts(conn, devices, session, layer = 'hld') {
  for (const side of ['source', 'dest']) {
    const end = conn[side]
    if (!end.portId) continue
    const device = devices.get(String(end.deviceId))
    try {
      await PortOccupancy.create([{ layer, deviceId: end.deviceId, portId: end.portId, portKey: lower(end.portId), connectionId: conn._id, source: 'connection' }], { session })
    } catch (err) {
      if (err.code === 11000) throw conflict('port_in_use', `${end.portId} on ${device?.hostname ?? device?.label ?? 'the device'} is already used by another connection`)
      throw err
    }
  }
}

async function registerCableId(conn, session, layer = 'hld') {
  if (!conn.cableId) return
  try {
    await CableIdRegistry.create([{ layer, cableId: conn.cableId, cableKey: lower(conn.cableId), ownerType: 'connection', connectionId: conn._id }], { session })
  } catch (err) {
    if (err.code === 11000) throw conflict('cable_id_in_use', `Cable ID ${conn.cableId} is already used in this project (IDs are never reused)`)
    throw err
  }
}

// Releases a connection's ports and retires its cable IDs (never reused, F4).
async function releaseConnection(connId, session) {
  await PortOccupancy.deleteMany({ connectionId: connId }, { session })
  await CableIdRegistry.updateMany({ connectionId: connId, status: 'reserved' }, { $set: { status: 'retired' } }, { session })
}

// Optic for a link: one the device models list (or any) for the media and
// speed, the shortest reach that still covers the length.
function chooseOptic({ media, speed, lengthM }, items, catalogue) {
  if (!['os2', 'om4'].includes(media)) return null
  const optics = catalogue.filter((i) => i.kind === 'optic' && i.mediaSpeed?.media === media && String(i.mediaSpeed.speed) === String(speed))
  const allowed = optics.filter((o) => items.every((it) => !it?.compatibleSfps?.length || it.compatibleSfps.some((k) => lower(k) === lower(o.key))))
  const pool = (allowed.length ? allowed : optics).sort((a, b) => a.mediaSpeed.reachM - b.mediaSpeed.reachM)
  return (pool.find((o) => lengthM == null || o.mediaSpeed.reachM >= lengthM) ?? pool[pool.length - 1])?.key ?? null
}

// The HLD's left panel (prototype SurveyInputsPanel): verified racks with
// their free RU, rooms whose patch panels are full, and how much of the CMO
// inventory the survey found in racks. All calculated.
function surveyInputs(data, cat) {
  const roomCode = new Map(data.rooms.map((r) => [String(r._id), r.code]))
  const racks = data.racks.map((k) => {
    const placements = data.devices
      .filter((d) => String(d.rackId) === String(k._id) && d.ru != null && d.heightU > 0)
      .map((d) => ({ id: String(d._id), ru: d.ru, heightU: d.heightU, face: d.face ?? 'front', fullDepth: Boolean(d.fullDepth), kind: 'device' }))
    return { rackId: String(k._id), roomId: String(k.roomId), roomCode: roomCode.get(String(k.roomId)) ?? null, rackCode: k.code, freeU: computeFreeRU(placements, k.heightU, 'front').availableRU }
  })
  const free = patchPanelCounter(data, cat)
  const roomIssues = []
  for (const room of data.rooms) {
    for (const kind of ['copper', 'fibre']) {
      if (free(room._id, kind) === 0) roomIssues.push({ roomId: String(room._id), roomCode: room.code, panelCode: kind, message: `${kind === 'copper' ? 'Copper' : 'Fibre'} patch panels · 0 free ports` })
    }
  }
  const cmo = data.devices.filter((d) => d.origin === 'existing' && d.importBatchId)
  const validated = cmo.filter((d) => d.rackId).length
  return { racks, roomIssues, cmo: { validated, total: cmo.length, pending: cmo.length - validated } }
}

// What the blueprint would add to the current design (shared/hldBlueprints.js).
function blueprintPlan(data, preset, variant) {
  return generateFromBlueprint({
    preset,
    variant,
    rooms: data.rooms.map((r) => ({ id: String(r._id), floorId: String(r.floorId), isMainRoom: Boolean(r.isMainRoom), rackIds: data.racks.filter((k) => String(k.roomId) === String(r._id)).map((k) => String(k._id)) })),
    floors: data.floors.map((f) => ({ id: String(f._id), token: f.token, order: f.order })),
    devices: data.devices.filter((d) => d.origin === 'planned').map((d) => ({ id: String(d._id), role: d.role, roomId: String(d.roomId) })),
    links: data.connections.map((c) => ({ sourceId: String(c.source.deviceId), destId: String(c.dest.deviceId) })),
  })
}

// --- Change-request branches (M5a review) --------------------------------------

// The HLD as views ({ devices, connections } — the approved-version snapshot
// shape), the main design or a branch. A branch is read on the main design's
// ids: a copy takes its origin's id; a record new on the branch keeps its own.
export async function hldDesignSnapshot(buildingId, projectId, { branchId = null, session = null } = {}) {
  const data = await loadDesign(buildingId, projectId, session, branchId)
  const { cat, deviceById, rackPos } = ruleInputs(data)
  const planned = data.devices.filter((d) => d.origin === 'planned')
  const devices = planned.map((d) => toDeviceView(d, cat, data.positions))
  const connections = data.connections.map((c) => toConnectionView(c, lengthOf(c, deviceById, rackPos, data.pathways)))
  if (!branchId) return { devices, connections }
  const main = new Map(planned.map((d) => [String(d._id), d.originId ? String(d.originId) : String(d._id)]))
  const conn = new Map(data.connections.map((c) => [String(c._id), c.originId ? String(c.originId) : String(c._id)]))
  const m = (x) => main.get(String(x)) ?? String(x)
  return {
    devices: devices.map((d) => ({ ...d, id: m(d.id) })),
    connections: connections.map((c) => ({ ...c, id: conn.get(c.id) ?? c.id, source: { ...c.source, deviceId: m(c.source.deviceId) }, dest: { ...c.dest, deviceId: m(c.dest.deviceId) } })),
  }
}

// Copies the main HLD of a building into a change request's branch layer
// (devices, uplinks with their ports and cable IDs, canvas positions).
export async function copyHldIntoBranch({ building, branchId, projectId, session }) {
  const main = await loadDesign(building.id, projectId, session)
  const layer = hldLayerOf(branchId)
  const idMap = new Map()
  for (const d of main.devices.filter((x) => x.origin === 'planned')) {
    const newId = new mongoose.Types.ObjectId()
    idMap.set(String(d._id), newId)
    const { _id, __v, layer: _layer, originId: _origin, ...fields } = d
    await Device.create([{ ...fields, _id: newId, layer, originId: d._id }], { session })
    const pos = main.positions.find((p) => String(p.objectId) === String(d._id))
    if (pos) await CanvasPosition.create([{ buildingId: building.id, designType: 'hld', objectType: 'device', objectId: newId, x: pos.x, y: pos.y, updatedBy: pos.updatedBy ?? null }], { session })
  }
  const devices = new Map()
  for (const d of main.devices) devices.set(String(idMap.get(String(d._id)) ?? d._id), d)
  const map = (deviceId) => idMap.get(String(deviceId)) ?? deviceId
  for (const c of main.connections) {
    const { _id, __v, layer: _layer, originId: _origin, ...fields } = c
    const [doc] = await Connection.create([{ ...fields, _id: new mongoose.Types.ObjectId(), layer, originId: c._id, source: { ...c.source, deviceId: map(c.source.deviceId) }, dest: { ...c.dest, deviceId: map(c.dest.deviceId) } }], { session })
    await takePorts(doc, devices, session, layer)
    await registerCableId(doc, session, layer)
  }
}

// Removes a branch's HLD layer (a rejected or withdrawn change request).
export async function discardHldBranch({ building, branchId, session }) {
  const layer = hldLayerOf(branchId)
  const devices = (await Device.find({ buildingId: building.id, layer }, { _id: 1 }).session(session).lean()).map((d) => d._id)
  await PortOccupancy.deleteMany({ layer }, { session })
  await CableIdRegistry.deleteMany({ layer }, { session })
  await CanvasPosition.deleteMany({ objectType: 'device', objectId: { $in: devices } }, { session })
  await Connection.deleteMany({ buildingId: building.id, layer }, { session })
  await Device.deleteMany({ buildingId: building.id, layer }, { session })
}

// An approved change request: the branch's HLD replaces the building's main
// HLD. Copies come back under their original ids (an LLD device's `hldRef`
// and the canvas positions keep pointing at them); new records keep theirs.
export async function promoteHldBranch({ building, branchId, projectId, session }) {
  const layer = hldLayerOf(branchId)
  const branch = await loadDesign(building.id, projectId, session, branchId)
  const main = await loadDesign(building.id, projectId, session)
  const mainId = new Map(branch.devices.filter((d) => d.origin === 'planned').map((d) => [String(d._id), d.originId ?? d._id]))
  const back = new Set(branch.connections.filter((c) => c.originId).map((c) => String(c.originId)))
  const mainConns = main.connections.map((c) => c._id)
  const mainDevices = main.devices.filter((d) => d.origin === 'planned').map((d) => d._id)
  // The main records go; a cable ID coming back with its connection is
  // re-registered, any other is retired (never reused).
  await PortOccupancy.deleteMany({ connectionId: { $in: mainConns } }, { session })
  await CableIdRegistry.deleteMany({ layer: 'hld', connectionId: { $in: mainConns.filter((c) => back.has(String(c))) } }, { session })
  await CableIdRegistry.updateMany({ layer: 'hld', connectionId: { $in: mainConns }, status: 'reserved' }, { $set: { status: 'retired' } }, { session })
  await PortOccupancy.deleteMany({ layer: HLD_LAYER, deviceId: { $in: mainDevices } }, { session })
  await Connection.deleteMany({ _id: { $in: mainConns } }, { session })
  await Device.deleteMany({ _id: { $in: mainDevices } }, { session })
  // The branch records go before the main ones are re-created: a record new
  // on the branch comes back under its own id.
  await PortOccupancy.deleteMany({ layer }, { session })
  await CableIdRegistry.deleteMany({ layer }, { session })
  await Connection.deleteMany({ buildingId: building.id, layer }, { session })
  await Device.deleteMany({ buildingId: building.id, layer }, { session })
  // Positions follow the device to its main id.
  const kept = new Set([...mainId.values()].map(String))
  await CanvasPosition.deleteMany({ objectType: 'device', objectId: { $in: mainDevices.filter((d) => !kept.has(String(d))) } }, { session })
  for (const d of branch.devices.filter((x) => x.origin === 'planned')) {
    const { _id, __v, layer: _layer, originId: _origin, ...fields } = d
    const target = mainId.get(String(d._id))
    await Device.create([{ ...fields, _id: target, layer: 'hld', originId: null }], { session })
    const pos = branch.positions.find((p) => String(p.objectId) === String(d._id))
    if (pos) await CanvasPosition.updateOne({ buildingId: building.id, designType: 'hld', objectType: 'device', objectId: target }, { $set: { x: pos.x, y: pos.y, updatedBy: pos.updatedBy ?? null, updatedAt: new Date() } }, { session, upsert: true })
  }
  const branchDevices = branch.devices.filter((d) => d.origin === 'planned').map((d) => d._id)
  await CanvasPosition.deleteMany({ objectType: 'device', objectId: { $in: branchDevices.filter((d) => !kept.has(String(d))) } }, { session })
  const devices = new Map((await Device.find({ buildingId: building.id, layer: HLD_LAYER }).session(session).lean()).map((d) => [String(d._id), d]))
  const map = (deviceId) => mainId.get(String(deviceId)) ?? deviceId
  for (const c of branch.connections) {
    const { _id, __v, layer: _layer, originId: _origin, ...fields } = c
    const [doc] = await Connection.create([{ ...fields, _id: c.originId ?? c._id, layer: 'hld', originId: null, source: { ...c.source, deviceId: map(c.source.deviceId) }, dest: { ...c.dest, deviceId: map(c.dest.deviceId) } }], { session })
    await takePorts(doc, devices, session, 'hld')
    await registerCableId(doc, session, 'hld')
  }
}

// A frozen HLD version of the building's main design (submit, or an approved
// change request): the snapshot file and its `designVersions` row.
export async function writeHldVersion({ storage, building, projectId, design, actor, label = null, validation = null, session }) {
  const data = await loadDesign(building.id, projectId, session)
  const { devices, connections } = await hldDesignSnapshot(building.id, projectId, { session })
  const versionId = new mongoose.Types.ObjectId()
  const fileId = new mongoose.Types.ObjectId()
  const last = await DesignVersion.findOne({ buildingId: building.id, designType: 'hld' }).sort({ number: -1 }).session(session).lean()
  const number = (last?.number ?? 0) + 1
  const snapshot = { designType: 'hld', building: { id: building.id, code: building.code, name: building.name }, revision: design.revision, preset: design.preset, devices, connections, validation: validation ?? runValidation(data).summary, createdAt: new Date().toISOString() }
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2))
  const storageKey = `files/${projectId}/${fileId}`
  await storage.put(storageKey, bytes)
  try {
    await File.create([{ _id: fileId, buildingId: building.id, attachedTo: { type: 'designVersion', id: versionId }, category: 'data_snapshot', fileName: `HLD-${building.code}-v${number}.json`, storageKey, mimeType: 'application/json', sizeBytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), uploadedBy: actor.userId }], { session })
    await DesignVersion.create([{ _id: versionId, buildingId: building.id, designType: 'hld', number, label: label ?? `v${number}`, snapshotFileId: fileId, counts: { devices: devices.length, connections: connections.length }, createdBy: actor.userId }], { session })
  } catch (err) {
    await storage.remove(storageKey).catch(() => {})
    throw err
  }
  return { versionId, number }
}

// --- The service ---------------------------------------------------------------

export function createHldService({ storage }) {
  async function audit(req, building, actor, action, extra = {}) {
    await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action, changeType: 'design_intent', source: 'ui', ...extra })
  }

  // The hierarchy codes a hostname is built from.
  async function hostnameParts(building, session) {
    const country = building.countryId ? await Country.findById(building.countryId).session(session).lean() : null
    const org = await Organisation.findById(currentScope().organisationId, { 'settings.namingRoleCodes': 1 }).lean()
    const raw = org?.settings?.namingRoleCodes
    return { codes: raw instanceof Map ? Object.fromEntries(raw) : raw ?? {}, country: country?.code ?? 'XX', sal: building.salCode ?? 'SAL', campus: building.campusCode ?? 'C', building: building.code }
  }

  // Creates one planned device in the caller's transaction.
  async function createDevice({ building, role, roomId, rackId = null, catalogueKey, floors, rooms, catalogue, takenHostnames, session, layer = 'hld' }) {
    const info = roleInfo(role)
    if (!info) throw badRequest(`Unknown role ${role}`)
    const room = rooms.find((r) => String(r._id) === String(roomId))
    if (!room) throw notFound('Room not found in this building')
    const cat = catalogueIndex(catalogue)
    const item = catalogueKey ? cat.item(catalogueKey) : defaultModelFor(role, catalogue)
    if (catalogueKey && (!item || item.kind !== 'device_model')) throw badRequest(`${catalogueKey} is not a device model in the catalogue`)
    if (item && item.category !== info.category) throw badRequest(`${item.key} is a ${item.category}, not a ${info.category}`)
    const floor = floors.find((f) => String(f._id) === String(room.floorId))
    const parts = await hostnameParts(building, session)
    const hostname = nextHostname(role, { ...parts, floor: floor?.token ?? 'X' }, [...takenHostnames])
    if (hostname) takenHostnames.add(hostname)
    const [device] = await Device.create(
      [
        {
          origin: 'planned',
          status: 'planned',
          layer,
          role,
          salId: building.salId,
          buildingId: building.id,
          roomId: room._id,
          // A suggested rack (blueprint), only for a rack-mounted model; no RU (brief §5.4).
          rackId: rackId && item?.rackMounted ? rackId : null,
          hostname,
          label: info.label,
          model: item?.model ?? null,
          catalogueKey: item?.key ?? null,
          category: item?.category ?? info.category,
          heightU: item?.heightU ?? null,
          psuConfigured: item?.psuCount ?? null,
        },
      ],
      { session }
    )
    return device
  }

  async function projectHostnames(session) {
    return new Set((await Device.find({ hostname: { $type: 'string' } }, { hostname: 1 }).session(session).lean()).map((d) => d.hostname))
  }

  async function createConnection({ building, body, data, actor, session, layer = 'hld' }) {
    const cat = catalogueIndex(data.catalogue)
    const devices = new Map(data.devices.map((d) => [String(d._id), d]))
    for (const side of ['source', 'dest']) {
      const d = devices.get(String(body[side].deviceId))
      if (!d) throw notFound(`The ${side === 'source' ? 'source' : 'destination'} device is not in this building`)
    }
    if (String(body.source.deviceId) === String(body.dest.deviceId)) throw badRequest('An uplink joins two different devices')
    const doc = new Connection({
      buildingId: building.id,
      layer,
      source: { deviceId: body.source.deviceId, portId: portOf(devices.get(String(body.source.deviceId)), body.source.portId, cat) },
      dest: { deviceId: body.dest.deviceId, portId: portOf(devices.get(String(body.dest.deviceId)), body.dest.portId, cat) },
      media: body.media,
      speed: body.speed,
      sourceSfpCode: body.sourceSfpCode ?? null,
      destSfpCode: body.destSfpCode ?? null,
      viaPatchPanel: Boolean(body.viaPatchPanel),
      cableId: body.cableId ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    await doc.save({ session })
    await takePorts(doc, devices, session, layer)
    await registerCableId(doc, session, layer)
    return doc
  }

  function withLengths(data, connDoc) {
    const { deviceById, rackPos } = ruleInputs(data)
    return toConnectionView(connDoc.toObject ? connDoc.toObject() : connDoc, lengthOf(connDoc, deviceById, rackPos, data.pathways))
  }

  // The HLD screen: survey rooms/racks, design devices and uplinks, positions,
  // the design's revision and state, approvals and open survey-change flags.
  async function view(req, buildingId, branchId = null) {
    const building = await requireBuilding(req, buildingId)
    const design = await designOf(building.id)
    const branch = branchId ? await changeRequestBranch(building, branchId) : null
    const data = await loadDesign(building.id, req.project.id, null, branch ? branchId : null)
    const { cat, deviceById, rackPos } = ruleInputs(data)
    const planned = data.devices.filter((d) => d.origin === 'planned')
    const plannedIds = new Set(planned.map((d) => String(d._id)))
    const approvals = await Approval.find({ buildingId: building.id, phaseKey: 'hld' }).sort({ submittedAt: -1 }).limit(20).lean()
    const versions = await DesignVersion.find({ buildingId: building.id, designType: 'hld' }).sort({ number: -1 }).lean()
    const names = await namesOf([...approvals.flatMap((a) => [a.submittedBy, a.decision?.decidedBy]), design.lastEditedBy, branch?.doc.lastEditedBy])
    const status = (await hldStatusByBuilding()).get(building.id) ?? 'not_started'
    const surveyStatus = (await surveyStatusByBuilding()).get(building.id) ?? 'not_started'
    return {
      building,
      design: branch
        ? { revision: branch.doc.revision, mainRevision: design.revision, state: branch.editable ? 'draft' : 'awaiting_approval', preset: design.preset, variant: design.variant ?? null, lastEditedAt: branch.doc.lastEditedAt, lastEditedBy: names.get(String(branch.doc.lastEditedBy)) ?? null }
        : { revision: design.revision, state: design.state, preset: design.preset, variant: design.variant ?? null, lastEditedAt: design.lastEditedAt, lastEditedBy: names.get(String(design.lastEditedBy)) ?? null },
      // Frozen by the Solution Package approval: changes go through a change request.
      frozen: Boolean(design.frozen),
      branch: branch ? { id: String(branch.doc._id), name: branch.doc.name, changeRequestId: String(branch.doc.changeRequestId), editable: branch.editable } : null,
      status,
      surveyVerified: surveyStatus === 'approved',
      floors: data.floors.map((f) => ({ id: String(f._id), token: f.token, name: f.name, order: f.order })),
      rooms: data.rooms.map((r) => ({ id: String(r._id), floorId: String(r.floorId), code: r.code, isMainRoom: Boolean(r.isMainRoom), hasRack: data.racks.some((k) => String(k.roomId) === String(r._id)) })),
      racks: data.racks.map((k) => ({ id: String(k._id), roomId: String(k.roomId), code: k.code, heightU: k.heightU })),
      devices: planned.map((d) => toDeviceView(d, cat, data.positions)),
      connections: data.connections.filter((c) => plannedIds.has(String(c.source.deviceId)) || plannedIds.has(String(c.dest.deviceId))).map((c) => toConnectionView(c, lengthOf(c, deviceById, rackPos, data.pathways))),
      approvals: approvals.map((a) => ({
        id: String(a._id),
        status: a.status,
        submittedBy: names.get(String(a.submittedBy)) ?? null,
        submittedById: String(a.submittedBy),
        submittedAt: a.submittedAt,
        versionNumber: versions.find((v) => String(v._id) === String(a.designVersionId))?.number ?? null,
        decision: a.decision ? { value: a.decision.value, decidedBy: names.get(String(a.decision.decidedBy)) ?? null, decidedAt: a.decision.decidedAt, comments: a.decision.comments ?? null } : null,
      })),
      versions: versions.map((v) => ({ id: String(v._id), number: v.number, frozen: v.frozen, createdAt: v.createdAt, counts: v.counts, snapshotFileId: String(v.snapshotFileId) })),
      surveyChanges: await surveyChanges(building),
      surveyInputs: surveyInputs(data, cat),
    }
  }

  // Open "survey changed after import" flags, with what changed and who
  // changed it (from the survey audit trail since the flag was raised).
  async function surveyChanges(building) {
    const flags = await DesignFlag.find({ buildingId: building.id, kind: 'survey_changed_after_import', resolvedAt: null }).lean()
    if (!flags.length) return []
    const records = await SurveyTabRecord.find({ _id: { $in: flags.map((f) => f.surveyTabRecordId) } }, { tab: 1, roomId: 1 }).lean()
    const rooms = await Room.find({ _id: { $in: records.map((r) => r.roomId).filter(Boolean) } }, { code: 1 }).lean()
    const out = []
    for (const flag of flags) {
      const record = records.find((r) => String(r._id) === String(flag.surveyTabRecordId))
      const edits = await AuditEntry.find({ objectType: 'SurveyTabRecord', objectId: String(flag.surveyTabRecordId), action: 'survey.tab.edited', occurredAt: { $gte: new Date(flag.raisedAt.getTime() - 5000) } })
        .sort({ occurredAt: 1 })
        .limit(50)
        .lean()
      const names = await namesOf(edits.map((e) => e.actor?.userId))
      out.push({
        id: String(flag._id),
        raisedAt: flag.raisedAt,
        tab: record?.tab ?? null,
        roomCode: record?.roomId ? rooms.find((r) => String(r._id) === String(record.roomId))?.code ?? null : null,
        changes: edits.flatMap((e) => (e.changes ?? []).map((c) => ({ field: c.field, before: c.before ?? null, after: c.after ?? null, changedBy: names.get(String(e.actor?.userId)) ?? null, changedAt: e.occurredAt }))),
      })
    }
    return out
  }

  // A write: scope, revision claim, the change, audit — one transaction.
  async function write(req, buildingId, baseRevision, actor, fn, { branchId = null } = {}) {
    const building = await requireBuilding(req, buildingId)
    await designOf(building.id)
    if (branchId) await changeRequestBranch(building, branchId)
    const layer = hldLayerOf(branchId)
    const result = await withTransaction(async (session) => {
      let design
      if (branchId) {
        await assertChangeRequestEditable(await DesignBranch.findById(branchId).session(session).lean(), session)
        design = await claimBranchRevision({ branchId, buildingId: building.id }, baseRevision, actor, session)
      } else {
        design = await claimRevision(building.id, baseRevision, actor, session)
      }
      const data = await loadDesign(building.id, req.project.id, session, branchId)
      const out = await fn({ building, data, session, design, layer })
      return { ...out, revision: design.revision }
    })
    return result
  }

  // A change request's open branch of this building (its HLD layer).
  async function changeRequestBranch(building, branchId) {
    const doc = mongoose.isValidObjectId(branchId) ? await DesignBranch.findOne({ _id: branchId, buildingId: building.id }).lean() : null
    if (!doc) throw notFound('Branch not found')
    if (!doc.changeRequestId || !doc.includesHld) throw conflict('not_a_change_request', 'HLD changes on a branch belong to a change request')
    if (doc.status !== 'open') throw conflict('branch_closed', 'This branch was promoted or discarded')
    const cr = await ChangeRequest.findById(doc.changeRequestId, { status: 1 }).lean()
    return { doc, editable: ['draft', 'changes_requested'].includes(cr?.status) }
  }

  async function deviceInScope(req, deviceId) {
    const device = mongoose.isValidObjectId(deviceId) ? await Device.findById(deviceId).lean() : null
    if (!device || device.origin !== 'planned' || !inHld(device)) throw notFound('Device not found')
    await requireBuilding(req, device.buildingId)
    return device
  }

  async function connectionInScope(req, connectionId) {
    const conn = mongoose.isValidObjectId(connectionId) ? await Connection.findById(connectionId).lean() : null
    if (!conn || !inHld(conn)) throw notFound('Uplink not found')
    await requireBuilding(req, conn.buildingId)
    return conn
  }

  return {
    view,
    surveyChanges,

    // Library: every role with its hostname code, catalogue models and the presets.
    async library(req) {
      const catalogue = await projectCatalogue(req.project.id)
      const org = await Organisation.findById(req.org.id, { 'settings.namingRoleCodes': 1 }).lean()
      const raw = org?.settings?.namingRoleCodes
      const codes = resolveRoleCodes(raw instanceof Map ? Object.fromEntries(raw) : raw ?? {})
      return {
        roles: HLD_ROLES.map((r) => ({
          role: r.role,
          label: r.label,
          group: r.group,
          icon: r.icon,
          category: r.category,
          code: r.named ? codes[r.role] : null,
          codeProposed: PROPOSED_ROLE_CODE_KEYS.includes(r.role),
          models: catalogue.filter((i) => i.kind === 'device_model' && i.category === r.category).map((i) => ({ key: i.key, placeholder: i.placeholder })),
          defaultModel: defaultModelFor(r.role, catalogue)?.key ?? null,
        })),
        optics: catalogue.filter((i) => i.kind === 'optic' && i.mediaSpeed).map((i) => ({ key: i.key, media: i.mediaSpeed.media, speed: i.mediaSpeed.speed, reachM: i.mediaSpeed.reachM })),
        presets: BLUEPRINT_PRESETS,
        variants: BLUEPRINT_VARIANTS,
      }
    },

    // Generate HLD (brief §5.3): the blueprint filled with the verified survey.
    async generate(req, { buildingId, preset, variant: requested, baseRevision }, actor) {
      const variant = requested ?? defaultVariantOf(preset)
      const problem = blueprintProblem(preset, variant)
      if (problem) throw badRequest(problem)
      const building = await requireBuilding(req, buildingId)
      if ((await surveyStatusByBuilding()).get(building.id) !== 'approved') {
        throw conflict('survey_not_verified', `Verify every survey tab of ${building.code} first — the HLD is generated from the verified survey`)
      }
      // Nothing missing: no write, so nobody else's next save turns stale.
      const design = await designOf(building.id)
      const preview = blueprintPlan(await loadDesign(building.id, req.project.id), preset, variant)
      if (!preview.devices.length && !preview.links.length) {
        if (design.revision !== baseRevision) throw await staleError(design, baseRevision)
        return { added: { devices: 0, uplinks: 0 }, revision: design.revision }
      }
      const result = await write(req, building.id, baseRevision, actor, async ({ data, session }) => {
        const plan = blueprintPlan(data, preset, variant)
        const taken = await projectHostnames(session)
        const refs = new Map()
        for (const spec of plan.devices) {
          const device = await createDevice({ building, role: spec.role, roomId: spec.roomId, rackId: spec.rackId, floors: data.floors, rooms: data.rooms, catalogue: data.catalogue, takenHostnames: taken, session })
          refs.set(spec.key, device)
          data.devices.push(device.toObject())
        }
        const cat = catalogueIndex(data.catalogue)
        const created = []
        for (const link of plan.links) {
          const from = refs.get(link.from)?._id ?? link.from
          const to = refs.get(link.to)?._id ?? link.to
          const { deviceById, rackPos } = ruleInputs(data)
          const draft = { source: { deviceId: from }, dest: { deviceId: to }, media: link.media }
          const { lengthM } = lengthOf(draft, deviceById, rackPos, data.pathways)
          const items = [from, to].map((d) => cat.item(data.devices.find((x) => String(x._id) === String(d))?.catalogueKey))
          const optic = chooseOptic({ media: link.media, speed: link.speed, lengthM }, items, data.catalogue)
          const conn = await createConnection({ building, body: { source: { deviceId: from }, dest: { deviceId: to }, media: link.media, speed: link.speed, sourceSfpCode: optic, destSfpCode: optic }, data, actor, session })
          created.push(conn)
          data.connections.push(conn.toObject())
        }
        await HldDesign.updateOne({ buildingId: building.id }, { $set: { preset, variant } }, { session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.generated', objectType: 'Building', objectId: building.id, changeType: 'design_intent', source: 'ui', comment: `Blueprint ${preset} · ${BLUEPRINT_VARIANTS.find((v) => v.key === variant)?.label}: ${plan.devices.length} device(s), ${plan.links.length} uplink(s) added`, session })
        return { added: { devices: plan.devices.length, uplinks: created.length } }
      })
      return result
    },

    async addDevice(req, body, actor) {
      return write(req, body.buildingId, body.baseRevision, actor, async ({ building, data, session, layer }) => {
        const device = await createDevice({ building, role: body.role, roomId: body.roomId, catalogueKey: body.catalogueKey, floors: data.floors, rooms: data.rooms, catalogue: data.catalogue, takenHostnames: await projectHostnames(session), session, layer })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.device.added', objectType: 'Device', objectId: device._id, changeType: 'design_intent', source: 'ui', comment: device.hostname ?? device.label, session })
        return { device: toDeviceView(device.toObject(), catalogueIndex(data.catalogue)) }
      }, { branchId: body.branchId ?? null })
    },

    async updateDevice(req, deviceId, body, actor) {
      const existing = await deviceInScope(req, deviceId)
      return write(req, existing.buildingId, body.baseRevision, actor, async ({ data, session }) => {
        const device = await Device.findById(deviceId).session(session)
        const cat = catalogueIndex(data.catalogue)
        const changes = []
        if (body.catalogueKey !== undefined) {
          const item = cat.item(body.catalogueKey)
          if (!item || item.kind !== 'device_model' || item.category !== roleInfo(device.role)?.category) throw badRequest(`${body.catalogueKey} is not a ${roleInfo(device.role)?.label} model in the catalogue`)
          changes.push({ field: 'catalogueKey', before: device.catalogueKey, after: item.key })
          Object.assign(device, { catalogueKey: item.key, model: item.model, heightU: item.heightU ?? null, category: item.category })
        }
        if (body.psuConfigured !== undefined) {
          changes.push({ field: 'psuConfigured', before: device.psuConfigured, after: body.psuConfigured })
          device.psuConfigured = body.psuConfigured
        }
        await device.save({ session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: String(device.buildingId), phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.device.updated', objectType: 'Device', objectId: device._id, changeType: 'design_intent', source: 'ui', changes: changes.map((c) => ({ objectType: 'Device', objectId: String(device._id), ...c })), session })
        return { device: toDeviceView(device.toObject(), cat) }
      }, { branchId: branchOfHldLayer(existing.layer) })
    },

    async deleteDevice(req, deviceId, { baseRevision }, actor) {
      const existing = await deviceInScope(req, deviceId)
      return write(req, existing.buildingId, baseRevision, actor, async ({ session }) => {
        const conns = await Connection.find({ $or: [{ 'source.deviceId': existing._id }, { 'dest.deviceId': existing._id }] }).session(session).lean()
        for (const c of conns) {
          await releaseConnection(c._id, session)
          await Connection.deleteOne({ _id: c._id }, { session })
        }
        await PortOccupancy.deleteMany({ deviceId: existing._id, layer: existing.layer ?? HLD_LAYER }, { session })
        await CanvasPosition.deleteMany({ objectType: 'device', objectId: existing._id }, { session })
        await Device.deleteOne({ _id: existing._id }, { session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: String(existing.buildingId), phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.device.deleted', objectType: 'Device', objectId: existing._id, changeType: 'design_intent', source: 'ui', comment: `${existing.hostname ?? existing.label} and ${conns.length} uplink(s)`, session })
        return { deleted: { device: String(existing._id), uplinks: conns.map((c) => String(c._id)) } }
      }, { branchId: branchOfHldLayer(existing.layer) })
    },

    async createUplink(req, body, actor) {
      return write(req, body.buildingId, body.baseRevision, actor, async ({ building, data, session, layer }) => {
        const conn = await createConnection({ building, body, data, actor, session, layer })
        data.connections.push(conn.toObject())
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.uplink.created', objectType: 'Connection', objectId: conn._id, changeType: 'design_intent', source: 'ui', comment: `${conn.media.toUpperCase()} ${conn.speed}`, session })
        return { uplink: withLengths(data, conn) }
      }, { branchId: body.branchId ?? null })
    },

    // Edit Uplink / Change Medium: endpoints, ports, media, speed, SFPs, cable ID.
    async updateUplink(req, connectionId, body, actor) {
      const existing = await connectionInScope(req, connectionId)
      return write(req, existing.buildingId, body.baseRevision, actor, async ({ data, session, layer }) => {
        const conn = await Connection.findById(connectionId).session(session)
        const cat = catalogueIndex(data.catalogue)
        const devices = new Map(data.devices.map((d) => [String(d._id), d]))
        const before = conn.toObject()
        for (const side of ['source', 'dest']) {
          if (body[side] === undefined) continue
          const device = devices.get(String(body[side].deviceId))
          if (!device) throw notFound(`The ${side === 'source' ? 'source' : 'destination'} device is not in this building`)
          conn[side] = { deviceId: device._id, portId: portOf(device, body[side].portId ?? null, cat) }
        }
        if (String(conn.source.deviceId) === String(conn.dest.deviceId)) throw badRequest('An uplink joins two different devices')
        for (const f of ['media', 'speed', 'sourceSfpCode', 'destSfpCode', 'viaPatchPanel']) if (body[f] !== undefined) conn[f] = body[f]
        const portsChanged = ['source', 'dest'].some((s) => String(before[s].deviceId) !== String(conn[s].deviceId) || (before[s].portId ?? null) !== (conn[s].portId ?? null))
        if (portsChanged) {
          await PortOccupancy.deleteMany({ connectionId: conn._id }, { session })
          await takePorts(conn, devices, session, layer)
        }
        if (body.cableId !== undefined && (body.cableId ?? null) !== (conn.cableId ?? null)) {
          await CableIdRegistry.updateMany({ connectionId: conn._id, ownerType: 'connection', status: 'reserved' }, { $set: { status: 'retired' } }, { session })
          conn.cableId = body.cableId
          await registerCableId(conn, session, layer)
        }
        conn.updatedBy = actor.userId
        conn.updatedAt = new Date()
        await conn.save({ session })
        const fields = ['media', 'speed', 'sourceSfpCode', 'destSfpCode', 'viaPatchPanel', 'cableId']
        const changes = fields.filter((f) => (before[f] ?? null) !== (conn[f] ?? null)).map((f) => ({ objectType: 'Connection', objectId: String(conn._id), field: f, before: before[f] ?? null, after: conn[f] ?? null }))
        if (portsChanged) changes.push({ objectType: 'Connection', objectId: String(conn._id), field: 'endpoints', before: `${before.source.portId ?? '—'} / ${before.dest.portId ?? '—'}`, after: `${conn.source.portId ?? '—'} / ${conn.dest.portId ?? '—'}` })
        data.connections = data.connections.map((c) => (String(c._id) === String(conn._id) ? conn.toObject() : c))
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: String(conn.buildingId), phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.uplink.updated', objectType: 'Connection', objectId: conn._id, changeType: 'design_intent', source: 'ui', changes, session })
        return { uplink: withLengths(data, conn) }
      }, { branchId: branchOfHldLayer(existing.layer) })
    },

    async deleteUplink(req, connectionId, { baseRevision }, actor) {
      const existing = await connectionInScope(req, connectionId)
      return write(req, existing.buildingId, baseRevision, actor, async ({ session }) => {
        await releaseConnection(existing._id, session)
        await Connection.deleteOne({ _id: existing._id }, { session })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: String(existing.buildingId), phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.uplink.deleted', objectType: 'Connection', objectId: existing._id, changeType: 'design_intent', source: 'ui', session })
        return { deleted: String(existing._id) }
      }, { branchId: branchOfHldLayer(existing.layer) })
    },

    // Canvas position only — not a design change, so no revision is claimed.
    async moveDevice(req, deviceId, { x, y }, actor) {
      const device = await deviceInScope(req, deviceId)
      const filter = { buildingId: device.buildingId, designType: 'hld', objectType: 'device', objectId: device._id }
      const existing = await CanvasPosition.findOne(filter)
      if (existing) Object.assign(existing, { x, y, updatedBy: actor.userId, updatedAt: new Date() })
      const saved = existing ? await existing.save() : await CanvasPosition.create({ ...filter, x, y, updatedBy: actor.userId })
      return { position: { deviceId: String(device._id), x: saved.x, y: saved.y } }
    },

    // Edit Uplink step 4: the draft checked with the same rules, before saving.
    async checkUplinkDraft(req, body) {
      const building = await requireBuilding(req, body.buildingId)
      if (body.branchId) await changeRequestBranch(building, body.branchId)
      const data = await loadDesign(building.id, req.project.id, null, body.branchId ?? null)
      const { deviceById, rackPos, ctx } = ruleInputs(data)
      const draft = { id: body.connectionId ?? 'draft', source: { deviceId: body.source.deviceId, portId: body.source.portId ?? null }, dest: { deviceId: body.dest.deviceId, portId: body.dest.portId ?? null }, media: body.media, speed: body.speed, sourceSfpCode: body.sourceSfpCode ?? null, destSfpCode: body.destSfpCode ?? null, viaPatchPanel: Boolean(body.viaPatchPanel) }
      for (const side of ['source', 'dest']) if (!deviceById.has(String(draft[side].deviceId))) throw notFound('Device not found in this building')
      const length = lengthOf(draft, deviceById, rackPos, data.pathways)
      const occupied = async (end) => {
        if (!end.portId) return false
        const row = await PortOccupancy.findOne({ layer: layerFilter(body.branchId ?? null), deviceId: oid(end.deviceId), portKey: lower(end.portId) }).lean()
        return Boolean(row && String(row.connectionId) !== String(body.connectionId ?? ''))
      }
      const portsFree = { source: !(await occupied(draft.source)), dest: !(await occupied(draft.dest)) }
      const result = uplinkChecks({ ...draft, ...length }, ctx, { portsFree })
      return { ...result, length }
    },

    async validate(req, buildingId, branchId = null) {
      const building = await requireBuilding(req, buildingId)
      if (branchId) await changeRequestBranch(building, branchId)
      return runValidation(await loadDesign(building.id, req.project.id, null, branchId))
    },

    // Architect submits: blocked by any Critical finding. Freezes nothing yet —
    // creates the version (snapshot) and the pending approval; locks edits.
    async submit(req, { buildingId, baseRevision }, actor) {
      const building = await requireBuilding(req, buildingId)
      const design = await designOf(building.id)
      if (design.frozen) throw conflict('change_request_required', 'The design is frozen by the Solution Package approval — changes go through a change request')
      if (design.state === 'awaiting_approval') throw conflict('hld_submitted', 'The HLD is already submitted for approval')
      if (design.revision !== baseRevision) throw await staleError(design, baseRevision)
      const data = await loadDesign(building.id, req.project.id)
      const planned = data.devices.filter((d) => d.origin === 'planned')
      if (planned.length === 0) throw conflict('empty_hld', 'There is nothing to submit — generate or draw the HLD first')
      const { findings, summary } = runValidation(data)
      if (summary.blocksSubmit) throw new AppError(409, 'validation_blocked', `${summary.critical} Critical finding(s) must be fixed before the HLD can be submitted`, { summary, findings: findings.filter((f) => f.severity === 'critical') })

      const { projectId } = currentScope()
      return withTransaction(async (session) => {
          const claimed = await HldDesign.findOneAndUpdate(
            { buildingId: building.id, revision: baseRevision, state: { $ne: 'awaiting_approval' } },
            { $inc: { revision: 1 }, $set: { state: 'awaiting_approval' } },
            { session, returnDocument: 'after' }
          )
          if (!claimed) throw await staleError(await HldDesign.findOne({ buildingId: building.id }).session(session), baseRevision)
          const { versionId, number } = await writeHldVersion({ storage, building, projectId, design, actor, validation: summary, session })
          const [approval] = await Approval.create([{ buildingId: building.id, phaseKey: 'hld', gate: 'hld_internal', designVersionId: versionId, submittedBy: actor.userId, submittedAt: new Date(), status: 'pending' }], { session })
          await HldDesign.updateOne({ _id: claimed._id }, { $set: { pendingApprovalId: approval._id } }, { session })
          await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: 'hld.submitted', objectType: 'DesignVersion', objectId: versionId, changeType: 'design_intent', source: 'ui', comment: `HLD v${number} submitted (${summary.warning} warning(s), ${summary.info} info)`, session })
          return { revision: claimed.revision, versionNumber: number, approvalId: String(approval._id) }
      })
    },

    // PM or Reviewer decides; never the submitter (brief §4.3, D06).
    async decide(req, { buildingId, decision, comment }, actor) {
      const building = await requireBuilding(req, buildingId)
      const approval = await Approval.findOne({ buildingId: building.id, gate: 'hld_internal', status: 'pending' }).lean()
      if (!approval) throw conflict('no_pending_approval', 'The HLD is not awaiting approval')
      const { roles } = await callerAccess(req)
      if (!canApproveSubmission({ roles, actorId: actor.userId, submitterId: approval.submittedBy })) {
        throw forbidden(String(actor.userId) === String(approval.submittedBy) ? 'You submitted this HLD — someone else must decide on it' : 'Only a PM or Reviewer decides on the HLD')
      }
      if (decision === 'changes_requested' && !String(comment ?? '').trim()) throw badRequest('Say what needs to change')
      return withTransaction(async (session) => {
        const decided = await Approval.findOneAndUpdate(
          { _id: approval._id, status: 'pending' },
          { $set: { status: decision, reviewerId: actor.userId, decision: { value: decision, decidedAt: new Date(), decidedBy: actor.userId, decidedByRole: actor.role, comments: String(comment ?? '').trim() || null } } },
          { session, returnDocument: 'after' }
        )
        if (!decided) throw conflict('already_decided', 'This submission was decided meanwhile — reload')
        const set = { state: decision === 'approved' ? 'approved' : 'changes_requested', pendingApprovalId: null }
        if (decision === 'approved') {
          await DesignVersion.updateOne({ _id: approval.designVersionId }, { $set: { frozen: true, frozenAt: new Date() } }, { session })
          set.latestApprovedVersionId = approval.designVersionId
        }
        const design = await HldDesign.findOneAndUpdate({ buildingId: building.id }, { $set: set, $inc: { revision: 1 } }, { session, returnDocument: 'after' })
        await recordAudit({ organisationId: req.org.id, projectId: req.project.id, buildingId: building.id, phaseKey: 'hld', actor: userActor(actor.userId, actor.role), action: decision === 'approved' ? 'hld.approved' : 'hld.changes_requested', objectType: 'Approval', objectId: approval._id, changeType: 'design_intent', source: 'ui', comment: String(comment ?? '').trim() || null, session })
        return { revision: design.revision, state: design.state }
      })
    },
  }
}

// HLD phase status per building (DATA-MODEL §5.1, calculated): from the
// design's workflow state, or in progress once it has planned devices.
export async function hldStatusByBuilding(session = null) {
  const designs = await HldDesign.find({}, { buildingId: 1, state: 1 }).session(session).lean()
  // (find, not distinct: the tenant plugin scopes find, not distinct.)
  const withDevices = new Set((await Device.find({ origin: 'planned', layer: HLD_LAYER }, { buildingId: 1 }).session(session).lean()).map((d) => String(d.buildingId)))
  const out = new Map()
  for (const d of designs) {
    const key = String(d.buildingId)
    out.set(key, d.state === 'approved' ? 'approved' : d.state === 'awaiting_approval' ? 'awaiting_approval' : d.state === 'changes_requested' ? 'changes_requested' : withDevices.has(key) ? 'in_progress' : 'not_started')
  }
  for (const b of withDevices) if (!out.has(b)) out.set(b, 'in_progress')
  return out
}
