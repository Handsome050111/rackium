// CMO Inventory Validation (brief v2.3 §5.1, Step 9). CMO is imported once
// per SAL, not per building — devices without a resolvable building sit in
// a SAL-level Unassigned list until the PM assigns them. This replaces
// mock/cmo.js's static per-room table as the single source every other
// phase's CMO check reads (Survey's device scanner, HLD's ghost overlay,
// Deployment's serial/MAC validation).
import { getCampusSiteStructure } from './siteStructure.js'
import { getDevices } from './networkStore.js'
import { updatePhaseStatus } from './buildings.js'
import { applyColumnMapping, validateCmoRows, computeCmoKpis, computeBuildingCmoStatus, CMO_FIELDS } from '../lib/cmoModel.js'
import { registerStore, replaceArrayContents } from '../lib/persistentStore.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const BUILDING_IDS = ['b001', 'b002', 'b003']

// Seeded with the same devices mock/cmo.js used to hold statically, now
// expressed as real imported-and-resolved CMO records, plus 3 devices with
// no building (matching mock/hierarchy.js's b002 "3 unassigned devices at
// SAL ERL" narrative and b003's "CMO Excel import started" history) so the
// Unassigned workflow has real data to demonstrate without requiring an
// upload first.
let idCounter = 1
function newId() {
  return `cmo-${idCounter++}`
}

const cmoDevices = [
  { id: newId(), hostname: 'E-DE-ERL-C01-B001-EG-001', model: 'Cisco C9300-48UX', serial: 'FCW2637A1B2', mac: '00:1A:2B:3C:4D:5E', buildingId: 'b001', roomId: 'room-tr-eg-01', roomCode: 'TR-EG-01', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'A-DE-ERL-C01-B001-EG-001', model: 'Cisco Catalyst 9130AXI', serial: 'FCW2637A1C3', mac: '00:1A:2B:3C:4D:5F', buildingId: 'b001', roomId: 'room-tr-eg-01', roomCode: 'TR-EG-01', rackCode: null, ru: null },
  { id: newId(), hostname: 'E-DE-ERL-C01-B001-EG-002', model: 'Cisco C9300-48UX', serial: 'FCW2637A1D4', mac: '00:1A:2B:3C:4D:60', buildingId: 'b001', roomId: 'room-tr-eg-02', roomCode: 'TR-EG-02', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'E-DE-ERL-C01-B001-1OG-001', model: 'Cisco C9300-48UX', serial: 'FCW2637A1E5', mac: '00:1A:2B:3C:4D:61', buildingId: 'b001', roomId: 'room-tr-1og-01', roomCode: 'TR-1OG-01', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'E-DE-ERL-C01-B001-1OG-002', model: 'Cisco C9300-48UX', serial: 'FCW2637A1F6', mac: '00:1A:2B:3C:4D:62', buildingId: 'b001', roomId: 'room-tr-1og-02', roomCode: 'TR-1OG-02', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'E-DE-ERL-C01-B001-2OG-001', model: 'Cisco C9300-48UX', serial: 'FCW2637A1G7', mac: '00:1A:2B:3C:4D:63', buildingId: 'b001', roomId: 'room-tr-2og-01', roomCode: 'TR-2OG-01', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'F-DE-ERL-C01-B001-FU1-001', model: 'Cisco C9500', serial: 'FXS2141Q0A1', mac: '00:1A:2B:3C:5A:01', buildingId: 'b001', roomId: 'room-ug1705', roomCode: 'UG1705', rackCode: 'R01', ru: 40 },
  { id: newId(), hostname: 'B-DE-ERL-C01-B001-FU1-001', model: 'Cisco C9500', serial: 'FXS2141Q0A2', mac: '00:1A:2B:3C:5A:02', buildingId: 'b001', roomId: 'room-ug1705', roomCode: 'UG1705', rackCode: 'R01', ru: 38 },
  { id: newId(), hostname: 'SW-UNK-01', model: 'Cisco C9200-24P', serial: 'UNK0001', mac: '00:AA:BB:CC:DD:01', buildingId: null, roomId: null, roomCode: null, rackCode: null, ru: null },
  { id: newId(), hostname: 'SW-UNK-02', model: 'Cisco C9200-24P', serial: 'UNK0002', mac: '00:AA:BB:CC:DD:02', buildingId: null, roomId: null, roomCode: null, rackCode: null, ru: null },
  { id: newId(), hostname: 'AP-UNK-03', model: 'Cisco Catalyst 9130AXI', serial: 'UNK0003', mac: '00:AA:BB:CC:DD:03', buildingId: null, roomId: null, roomCode: null, rackCode: null, ru: null },
]

let lastImportAt = '2026-09-26T11:45:00Z'

// registered here, but hydrateAll() (main.jsx, before first render) runs
// after this whole module finishes loading — so the pushPhaseStatus() call
// below still fires once against seed data, then gets superseded once
// phaseStatusStore itself restores its own last-saved snapshot.
registerStore('cmoDesign', {
  getSnapshot: () => ({ cmoDevices, lastImportAt, idCounter }),
  restoreSnapshot: (data) => {
    replaceArrayContents(cmoDevices, data?.cmoDevices)
    if (data?.lastImportAt) lastImportAt = data.lastImportAt
    if (typeof data?.idCounter === 'number') idCounter = data.idCounter
  },
})

async function pushPhaseStatus() {
  await Promise.all(
    BUILDING_IDS.map((id) => updatePhaseStatus(id, 'cmo', computeBuildingCmoStatus(cmoDevices.filter((d) => d.buildingId === id))))
  )
}
// Push the seed's computed status once at module load so the dashboard
// reflects real per-building data instead of the static mock/hierarchy.js
// defaults immediately on first render.
pushPhaseStatus()

// --- Site-structure resolution (building/floor/room/rack text -> ids) ----

let resolverCache = null
async function getResolver() {
  if (resolverCache) return resolverCache
  const { buildings } = await getCampusSiteStructure()
  const byBuildingCode = new Map()
  const roomIndex = new Map() // `${buildingId}|${ROOMCODE}` -> { roomId, floorId }
  const rackIndex = new Map() // `${roomId}|${RACKCODE}` -> rackId
  for (const b of buildings) {
    byBuildingCode.set(b.buildingCode.toUpperCase(), b.buildingId)
    byBuildingCode.set(b.buildingId.toUpperCase(), b.buildingId)
    for (const floor of b.floors) {
      for (const room of floor.rooms) {
        roomIndex.set(`${b.buildingId}|${room.code.toUpperCase()}`, { roomId: room.id, floorId: floor.id })
        for (const rack of room.racks) {
          rackIndex.set(`${room.id}|${rack.code.toUpperCase()}`, rack.id)
        }
      }
    }
  }
  resolverCache = { byBuildingCode, roomIndex, rackIndex }
  return resolverCache
}

function resolveBuildingSync(resolver, text) {
  if (!text) return null
  return resolver.byBuildingCode.get(text.trim().toUpperCase()) ?? null
}

function resolveRoomSync(resolver, buildingId, roomText) {
  if (!buildingId || !roomText) return null
  return resolver.roomIndex.get(`${buildingId}|${roomText.trim().toUpperCase()}`) ?? null
}

// --- Template + parsing ----------------------------------------------------

export async function downloadCmoTemplate() {
  const XLSX = await import('xlsx')
  const header = CMO_FIELDS.map((f) => f.label)
  const example = ['E-DE-ERL-C01-B001-EG-001', 'Cisco C9300-48UX', 'FCW2637A1B2', '00:1A:2B:3C:4D:5E', 'B001', 'EG', 'TR-EG-01', 'R01', '40']
  const sheet = XLSX.utils.aoa_to_sheet([header, example])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'CMO Import')
  XLSX.writeFile(book, 'rackium-cmo-import-template.xlsx')
}

// Reads an uploaded File (xlsx/xls/csv) into a raw grid: { headers, rows }.
// No field interpretation here — that's the user's column-mapping step.
export async function parseCmoFile(file) {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const [headers = [], ...rows] = grid
  return { headers, rows: rows.filter((r) => r.some((cell) => String(cell ?? '').trim() !== '')) }
}

// --- Preview / commit -------------------------------------------------------

function projectSerialSet() {
  const fromCmo = cmoDevices.map((d) => d.serial?.toLowerCase()).filter(Boolean)
  const fromNetwork = getDevices()
    .map((d) => d.installation?.serial?.toLowerCase())
    .filter(Boolean)
  return new Set([...fromCmo, ...fromNetwork])
}

export async function previewCmoImport(rawRows, mapping) {
  const resolver = await getResolver()
  const mapped = applyColumnMapping(rawRows, mapping)
  const rows = validateCmoRows(mapped, {
    projectSerials: projectSerialSet(),
    resolveBuilding: (text) => resolveBuildingSync(resolver, text),
  })
  return resolveAfter(rows)
}

export async function commitCmoImport(previewRows) {
  const resolver = await getResolver()
  let imported = 0
  for (const row of previewRows) {
    if (!row.valid) continue
    const roomMatch = resolveRoomSync(resolver, row.buildingId, row.room)
    const rackId = roomMatch ? resolver.rackIndex.get(`${roomMatch.roomId}|${(row.rack ?? '').toUpperCase()}`) ?? null : null
    cmoDevices.push({
      id: newId(),
      hostname: row.hostname,
      model: row.model,
      serial: row.serial,
      mac: row.mac,
      buildingId: row.buildingId,
      roomId: roomMatch?.roomId ?? null,
      roomCode: roomMatch ? row.room : null,
      rackId,
      rackCode: rackId ? row.rack : null,
      ru: row.ru ? Number(row.ru) : null,
    })
    imported++
  }
  lastImportAt = new Date().toISOString()
  await pushPhaseStatus()
  return resolveAfter({ ok: true, imported })
}

export async function assignDeviceToBuilding(deviceId, buildingId) {
  const device = cmoDevices.find((d) => d.id === deviceId)
  if (!device) return resolveAfter({ ok: false, error: 'Device not found' })
  device.buildingId = buildingId
  await pushPhaseStatus()
  return resolveAfter({ ok: true })
}

// --- Reads -------------------------------------------------------------

export async function getCmoContext() {
  const kpis = computeCmoKpis(cmoDevices)
  const byBuilding = BUILDING_IDS.map((buildingId) => ({
    buildingId,
    devices: cmoDevices.filter((d) => d.buildingId === buildingId),
  }))
  return resolveAfter({
    devices: cmoDevices.map((d) => ({ ...d })),
    unassigned: cmoDevices.filter((d) => !d.buildingId).map((d) => ({ ...d })),
    byBuilding,
    kpis,
    lastImportAt,
  })
}

// Used by Survey/HLD/Deployment's CMO checks — same shape as the old
// mock/cmo.js helper ({ serial, mac, expectedHostname }) so none of those
// callers need to change.
export function getCmoForRoom(roomId) {
  return cmoDevices.filter((d) => d.roomId === roomId).map((d) => ({ serial: d.serial, mac: d.mac, expectedHostname: d.hostname }))
}
