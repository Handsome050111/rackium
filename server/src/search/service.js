import mongoose from 'mongoose'
import { parseQuery, bestMatch, orderResults, escapeRegex, samePort, MATCH_LABEL, SEARCH_LIMIT, SEARCH_TYPE_KEYS } from '@rackium/shared/search.js'
import { withLegacyName } from '@rackium/shared/deviceName.js'
import { Project } from '../models/project.js'
import { Country } from '../models/country.js'
import { Sal } from '../models/sal.js'
import { Campus } from '../models/campus.js'
import { Building } from '../models/building.js'
import { Floor } from '../models/floor.js'
import { Room } from '../models/room.js'
import { Rack } from '../models/rack.js'
import { Device } from '../models/device.js'
import { DeploymentRecord } from '../models/deploymentRecord.js'
import { Connection } from '../models/connection.js'
import { ConnectionRecord } from '../models/connectionRecord.js'
import { CableIdRegistry } from '../models/cableIdRegistry.js'
import { ViewAsSession, VIEW_AS_SESSION_TTL_MS } from '../models/viewAsSession.js'
import { membershipsForUser } from '../auth/service.js'
import { rolesIn } from '../organisations/service.js'
import { projectScope, requireBuilding, requireFloor, requireRoom, requireRack } from '../access/scope.js'
import { runWithScope } from '../tenancy/scopeContext.js'
import { forbidden } from '../http/errors.js'

// Global search (DATA-MODEL §5.16; M7a-2). Per project the caller can open:
// every lookup runs at once (exact and prefix on the indexes, a bounded
// contains scan only when those found too few); the candidates are ranked,
// and only then — in rank order, until the limit — each is checked with the
// access function of the screen its link opens, so a result can never lead
// to a 404. Prices, change-request branches and frozen snapshots are never read.

const CI = { locale: 'en', strength: 2 }
const PER_QUERY = 60
const CHECK_BATCH = 25
// Main designs only: existing gear (null), the HLD and the LLD — never a branch.
const MAIN_LAYERS = [null, 'hld', 'lld']
const oid = (id) => new mongoose.Types.ObjectId(String(id))

// A case-insensitive prefix as a range: uses the collation indexes.
const prefixRange = (q) => ({ $gte: q, $lt: `${q}￿` })

// Exact + prefix on each field (indexed, at once), then contains when still short.
// `lowerKey`: the fields hold lower case already (a plain index, no collation).
async function lookup(Model, fields, q, extra = {}, { lowerKey = false } = {}) {
  const found = new Map()
  const prefix = await Promise.all(fields.map((f) => Model.find({ ...extra, [f]: prefixRange(q) }).collation(lowerKey ? { locale: 'simple' } : CI).limit(PER_QUERY).lean()))
  for (const rows of prefix) for (const r of rows) found.set(String(r._id), r)
  if (found.size < PER_QUERY) {
    const re = lowerKey ? new RegExp(escapeRegex(q)) : new RegExp(escapeRegex(q), 'i')
    const rows = await Model.find({ ...extra, $or: fields.map((f) => ({ [f]: re })) }).limit(PER_QUERY).lean()
    for (const r of rows) found.set(String(r._id), r)
  }
  return [...found.values()]
}

// The project's links (client paths).
const linkOf = (o, p) => ({
  project: () => `/orgs/${o}/projects/${p}`,
  building: (b, page = '') => `/orgs/${o}/projects/${p}/buildings/${b}${page ? `/${page}` : ''}`,
  connection: (c) => `/l/${o}/${p}/c/${c}`,
})

// The caller's view of one project, as its own routes would see it.
function projectRequest(req, project, viewAs) {
  const r = { user: req.user, org: req.org, project: { id: String(project._id), doc: project } }
  if (viewAs) {
    r.viewAsActive = true
    r.roles = [viewAs.viewedRole]
  }
  return r
}

// A memo of the screens' own access checks (per id): the building, floor,
// room or rack — or null when the screen would answer 404.
function accessChecks(preq) {
  const memo = new Map()
  const check = (kind, fn) => (value) => {
    if (!value) return Promise.resolve(null)
    const key = `${kind}:${value}`
    if (!memo.has(key)) memo.set(key, fn(preq, String(value)).catch(() => null))
    return memo.get(key)
  }
  return { building: check('b', requireBuilding), floor: check('f', requireFloor), room: check('r', requireRoom), rack: check('k', requireRack) }
}
const layerRank = (layer) => (layer === 'lld' ? 0 : layer === 'hld' ? 1 : 2)

// The candidates of one project: each with what it is ranked on now, and
// `resolve` — its screen's access check, then the result (or null).
async function candidatesOf(req, project, query, scope, can) {
  const o = req.org.id
  const p = String(project._id)
  const L = linkOf(o, p)
  const q = query.lower
  const out = []
  const add = (type, rank, title, resolve) => out.push({ type, rank, title, resolve })
  const result = (r) => ({ projectId: p, projectName: project.name, buildingCode: null, subtitle: null, ...r })
  // Cheap first: a building outside the scope view is never checked further.
  const inScope = (buildingId) => scope.coversBuilding(String(buildingId))
  const layerFilter = { layer: { $in: MAIN_LAYERS } }
  const notRetired = { status: { $ne: 'retired' } }
  const macFilter = query.mac ? (query.mac.full ?? prefixRange(query.mac.prefix)) : null

  const [countries, sals, campuses, buildings, floors, rooms, racks, devicesByName, devicesByMac, recsByText, recsByMac, registry, conRecs, panels] = await Promise.all([
    lookup(Country, ['code', 'name'], q),
    lookup(Sal, ['code'], q),
    lookup(Campus, ['code'], q),
    lookup(Building, ['code', 'name'], q),
    lookup(Floor, ['token', 'name'], q),
    lookup(Room, ['code', 'name'], q),
    lookup(Rack, ['code'], q),
    lookup(Device, ['hostname', 'label', 'existingLabel', 'legacyHostname', 'installation.serial'], q, layerFilter),
    macFilter ? Device.find({ ...layerFilter, 'installation.mac': macFilter }).limit(PER_QUERY).lean() : [],
    lookup(DeploymentRecord, ['installation.serial', 'assetTag'], q, notRetired),
    macFilter ? DeploymentRecord.find({ ...notRetired, 'installation.mac': macFilter }).limit(PER_QUERY).lean() : [],
    lookup(CableIdRegistry, ['cableKey'], q, { layer: { $in: ['hld', 'lld'] }, status: 'reserved' }, { lowerKey: true }),
    lookup(ConnectionRecord, ['installed.segments.cableId'], q, notRetired),
    query.port ? Device.find({ layer: 'lld', $or: [{ hostname: query.port.panel }, { label: query.port.panel }, { existingLabel: query.port.panel }] }).collation(CI).limit(20).lean() : [],
  ])

  // The project itself: its home opens for any member.
  const pm = bestMatch({ name: project.name, code: project.code }, q)
  if (pm) add('project', pm.rank, project.name, async () => result({ type: 'project', id: p, title: project.name, subtitle: project.code ?? null, match: { field: pm.field, value: project[pm.field] }, link: L.project() }))

  // Above buildings: shown only with an open building under it (its home opens).
  const visible = scope.buildings
  for (const c of countries) {
    const m = bestMatch({ code: c.code, name: c.name }, q)
    if (m && visible.some((b) => b.countryId === String(c._id))) add('country', m.rank, c.name, async () => result({ type: 'country', id: String(c._id), title: `${c.name} (${c.code})`, match: { field: m.field, value: c[m.field] }, link: L.project() }))
  }
  for (const s of sals) {
    const m = bestMatch({ code: s.code }, q)
    if (m && visible.some((b) => b.salId === String(s._id))) add('sal', m.rank, s.code, async () => result({ type: 'sal', id: String(s._id), title: s.code, subtitle: 'SAL code', match: { field: 'code', value: s.code }, link: L.project() }))
  }
  if (campuses.length) {
    const campusOf = new Map((await Building.find({ campusId: { $in: campuses.map((c) => c._id) } }, { campusId: 1 }).lean()).map((b) => [String(b._id), String(b.campusId)]))
    for (const c of campuses) {
      const m = bestMatch({ code: c.code }, q)
      if (m && visible.some((b) => campusOf.get(b.id) === String(c._id))) add('campus', m.rank, c.code, async () => result({ type: 'campus', id: String(c._id), title: c.code, subtitle: 'Campus', match: { field: 'code', value: c.code }, link: L.project() }))
    }
  }

  // Buildings and what is in them: the screen's own check.
  for (const b of buildings) {
    const m = bestMatch({ code: b.code, name: b.name }, q)
    if (m && inScope(b._id))
      add('building', m.rank, b.code, async () => ((await can.building(b._id)) ? result({ type: 'building', id: String(b._id), title: `${b.code} — ${b.name}`, match: { field: m.field, value: b[m.field] }, link: L.building(b._id), buildingCode: b.code }) : null))
  }
  for (const f of floors) {
    const m = bestMatch({ code: f.token, name: f.name }, q)
    if (m && inScope(f.buildingId))
      add('floor', m.rank, f.token, async () => {
        const [floor, building] = await Promise.all([can.floor(f._id), can.building(f.buildingId)])
        return floor && building ? result({ type: 'floor', id: String(f._id), title: `${f.token} — ${f.name}`, subtitle: building.code, match: { field: m.field, value: m.field === 'code' ? f.token : f.name }, link: L.building(f.buildingId, 'survey'), buildingCode: building.code }) : null
      })
  }
  for (const r of rooms) {
    const m = bestMatch({ code: r.code, name: r.name }, q)
    if (m && inScope(r.buildingId))
      add('room', m.rank, r.code, async () => {
        const [room, building] = await Promise.all([can.room(r._id), can.building(r.buildingId)])
        return room && building ? result({ type: 'room', id: String(r._id), title: r.name ? `${r.code} — ${r.name}` : r.code, subtitle: building.code, match: { field: m.field, value: r[m.field] }, link: `${L.building(r.buildingId, 'survey/room')}?room=${r._id}`, buildingCode: building.code }) : null
      })
  }
  for (const k of racks) {
    const m = bestMatch({ code: k.code }, q)
    if (m && inScope(k.buildingId))
      add('rack', m.rank, k.code, async () => {
        const [rack, building] = await Promise.all([can.rack(k._id), can.building(k.buildingId)])
        return rack && building ? result({ type: 'rack', id: String(k._id), title: k.code, subtitle: building.code, match: { field: 'code', value: k.code }, link: `${L.building(k.buildingId, 'survey/rack')}?rack=${k._id}`, buildingCode: building.code }) : null
      })
  }

  // Devices: by name fields and the CMO's serial and MAC; as built: serial, MAC, asset ID.
  const devices = new Map()
  const addDevice = (d, match) => {
    const prev = devices.get(String(d._id))
    if (!prev || match.rank < prev.match.rank) devices.set(String(d._id), { d, match })
  }
  for (const d of devicesByName) {
    // A renamed device is found by its old name too (DATA-MODEL §5.19), reported
    // as such before the stored label, which may still hold the same name.
    const m = bestMatch({ hostname: d.hostname, existingLabel: d.existingLabel, legacyHostname: d.legacyHostname, label: d.label, serial: d.installation?.serial }, q)
    if (m) addDevice(d, { ...m, value: m.field === 'serial' ? d.installation.serial : d[m.field], source: 'device' })
  }
  for (const d of devicesByMac) addDevice(d, { rank: query.mac.full ? 0 : 1, field: 'mac', value: d.installation.mac, source: 'device' })
  const recs = new Map([...recsByText, ...recsByMac].map((r) => [String(r._id), r]))
  if (recs.size) {
    const byDevice = new Map((await Device.find({ _id: { $in: [...recs.values()].map((r) => r.deviceId) }, layer: 'lld' }).lean()).map((d) => [String(d._id), d]))
    for (const r of recs.values()) {
      const d = byDevice.get(String(r.deviceId))
      if (!d) continue
      const m = bestMatch({ serial: r.installation?.serial, assetTag: r.assetTag }, q)
      const macRank = query.mac && r.installation?.mac && (query.mac.full ? r.installation.mac === query.mac.full : r.installation.mac.startsWith(query.mac.prefix)) ? (query.mac.full ? 0 : 1) : null
      const match = macRank != null && (!m || m.rank > macRank) ? { rank: macRank, field: 'mac', value: r.installation.mac } : m ? { ...m, value: m.field === 'serial' ? r.installation.serial : r.assetTag } : null
      if (match) addDevice(d, { ...match, source: 'record' })
    }
  }
  // One result per device; an HLD device and its LLD copy with the same name: the LLD one.
  const seen = new Set()
  for (const { d, match } of [...devices.values()].sort((a, b) => a.match.rank - b.match.rank || layerRank(a.d.layer) - layerRank(b.d.layer))) {
    const title = withLegacyName(d.hostname ?? d.existingLabel ?? d.label ?? 'Device', d.legacyHostname)
    const dupKey = `${d.buildingId}|${title.toLowerCase()}|${match.field}`
    if (seen.has(dupKey)) continue
    seen.add(dupKey)
    const where = d.layer === 'hld' ? 'HLD' : d.layer === 'lld' ? 'LLD' : d.buildingId ? 'Surveyed' : 'CMO, unassigned'
    const shape = (building, link) => result({ type: 'device', id: String(d._id), title, subtitle: [building?.code, where, `${MATCH_LABEL[match.field]}: ${match.value}`].filter(Boolean).join(' · '), match: { field: match.field, value: match.value }, link, buildingCode: building?.code ?? null })
    if (d.buildingId) {
      if (!inScope(d.buildingId)) continue
      add('device', match.rank, title, async () => {
        const building = await can.building(d.buildingId)
        if (!building) return null
        if (!d.layer) return shape(building, d.rackId && (await can.rack(d.rackId)) ? `${L.building(d.buildingId, 'survey/rack')}?rack=${d.rackId}` : L.building(d.buildingId, 'cmo'))
        return shape(building, L.building(d.buildingId, d.layer === 'hld' ? 'hld' : match.source === 'record' ? 'cmdb' : 'lld'))
      })
    } else {
      // Unassigned CMO gear: the SAL's list, on the CMO screen of a building of that SAL in scope.
      const host = scope.coversSal(d.salId) ? scope.buildings.find((b) => b.salId === String(d.salId)) : null
      if (host) add('device', match.rank, title, async () => ((await can.building(host.id)) ? shape(null, L.building(host.id, 'cmo')) : null))
    }
  }

  // Cables: designed cable and segment IDs (the registry), and the as-built segment IDs.
  const cables = new Map()
  for (const row of registry) {
    const rank = bestMatch({ cableId: row.cableId }, q)?.rank
    if (rank != null) cables.set(`${row.connectionId}|${row.cableId.toLowerCase()}`, { connectionId: String(row.connectionId), cableId: row.cableId, rank })
  }
  for (const rec of conRecs) {
    for (const s of rec.installed?.segments ?? []) {
      const rank = bestMatch({ cableId: s.cableId }, q)?.rank
      if (rank != null) cables.set(`${rec.connectionId}|${s.cableId.toLowerCase()}`, { connectionId: String(rec.connectionId), cableId: s.cableId, rank })
    }
  }
  if (cables.size) {
    const conns = new Map((await Connection.find({ _id: { $in: [...new Set([...cables.values()].map((c) => c.connectionId))].map(oid) }, layer: { $in: ['hld', 'lld'] } }, { buildingId: 1, layer: 1 }).lean()).map((c) => [String(c._id), c]))
    for (const c of cables.values()) {
      const conn = conns.get(c.connectionId)
      if (!conn || !inScope(conn.buildingId)) continue
      add('cable', c.rank, c.cableId, async () => {
        const building = await can.building(conn.buildingId)
        return building ? result({ type: 'cable', id: `${c.connectionId}:${c.cableId}`, title: c.cableId, subtitle: `${building.code} · ${conn.layer === 'hld' ? 'HLD uplink' : 'Connection'}`, match: { field: 'cableId', value: c.cableId }, link: conn.layer === 'lld' ? L.connection(c.connectionId) : L.building(conn.buildingId, 'hld'), buildingCode: building.code }) : null
      })
    }
  }

  // Panel ports: the connections on that port of that panel (main LLD).
  const scopedPanels = panels.filter((panel) => inScope(panel.buildingId))
  if (scopedPanels.length) {
    const conns = await Connection.find({ layer: 'lld', $or: [{ 'hops.patchPanelId': { $in: scopedPanels.map((x) => x._id) } }, { 'source.deviceId': { $in: scopedPanels.map((x) => x._id) } }, { 'dest.deviceId': { $in: scopedPanels.map((x) => x._id) } }] }, { hops: 1, source: 1, dest: 1, cableId: 1 }).limit(2000).lean()
    for (const panel of scopedPanels) {
      const panelName = panel.hostname ?? panel.existingLabel ?? panel.label
      const id = String(panel._id)
      for (const conn of conns) {
        const onHop = conn.hops.some((h) => String(h.patchPanelId) === id && (samePort(h.inPort, query.port.port) || samePort(h.outPort, query.port.port)))
        const onEnd = [conn.source, conn.dest].some((e) => String(e.deviceId) === id && samePort(e.portId, query.port.port))
        if (!onHop && !onEnd) continue
        const title = `${panelName} port ${String(query.port.port).padStart(2, '0')}`
        add('port', 0, title, async () => {
          const building = await can.building(panel.buildingId)
          return building ? result({ type: 'port', id: `${conn._id}:${id}:${query.port.port}`, title, subtitle: [building.code, conn.cableId ? `Cable ${conn.cableId}` : null].filter(Boolean).join(' · '), match: { field: 'label', value: panelName }, link: L.connection(conn._id), buildingCode: building.code }) : null
        })
      }
    }
  }
  return out
}

// Ranks a project's candidates, then checks them in that order (in parallel
// batches) until the limit is reached.
async function searchProject(req, project, query, viewAs) {
  const preq = projectRequest(req, project, viewAs)
  const scope = await projectScope(preq)
  const can = accessChecks(preq)
  const candidates = await candidatesOf(req, project, query, scope, can)
  const typeIndex = (t) => SEARCH_TYPE_KEYS.indexOf(t)
  candidates.sort((a, b) => a.rank - b.rank || typeIndex(a.type) - typeIndex(b.type) || String(a.title).localeCompare(String(b.title)))
  const accepted = []
  for (let i = 0; i < candidates.length && accepted.length < SEARCH_LIMIT; i += CHECK_BATCH) {
    const batch = candidates.slice(i, i + CHECK_BATCH)
    const resolved = await Promise.all(batch.map((c) => c.resolve()))
    resolved.forEach((r, j) => r && accepted.push({ ...r, rank: batch[j].rank }))
  }
  return accepted.slice(0, SEARCH_LIMIT)
}

// A View-As session for this user (bound to one project), or null; refused
// outright when the header names an invalid or expired one.
async function viewAsOf(req, sessionId) {
  if (!sessionId) return null
  if (!mongoose.isValidObjectId(sessionId)) throw forbidden('View As session is invalid or has expired')
  const s = await ViewAsSession.findOne({ _id: sessionId, actorUserId: req.user._id, endedAt: null }).lean()
  if (!s || Date.now() - s.startedAt.getTime() >= VIEW_AS_SESSION_TTL_MS) throw forbidden('View As session is invalid or has expired')
  return s
}

export function createSearchService() {
  return {
    async search(req, { q, projectId = null }, { viewAsSessionId = null } = {}) {
      const query = parseQuery(q)
      if (!query) return { query: q, results: [] }
      const viewAs = await viewAsOf(req, viewAsSessionId)
      const orgId = req.org.id
      // The projects the caller can open: the Org Admin all of them, a member theirs.
      const { roles } = await rolesIn(req.user._id, orgId)
      const memberOf = (await membershipsForUser(req.user._id)).filter((m) => m.level === 'project' && String(m.organisationId) === orgId).map((m) => String(m.projectId))
      const projects = await runWithScope({ organisationId: orgId }, () => Project.find(viewAs ? { _id: viewAs.projectId } : roles.includes('org_admin') ? {} : { _id: { $in: memberOf.map(oid) } }).lean())
      const perProject = await Promise.all(projects.map((project) => runWithScope({ organisationId: orgId, projectId: project._id }, () => searchProject(req, project, query, viewAs))))
      const current = viewAs ? String(viewAs.projectId) : projectId
      return { query: query.text, results: orderResults(perProject.flat(), { currentProjectId: current, limit: SEARCH_LIMIT }).map(({ rank, ...r }) => r) }
    },
  }
}
