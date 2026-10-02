import { devices as b001Devices, patchPanels as b001PatchPanels } from '../mock/b001-site.js'
import { getRackSurveyMeta } from '../mock/rackSurveyMeta.js'
import { projectSerials } from '../mock/cmo.js'
import { getCmoForRoom } from './cmoDesign.js'
import { resolveAfter } from './site.js'
import { getRackLocation } from './siteStructure.js'
import { registerStore } from '../lib/persistentStore.js'

// Only B001 has a device/patch-panel roster today (brief v2.3 build order:
// dashboard -> Rackium Editor -> rack elevation, all B001-scoped so far);
// B002/B003 racks still resolve their room/floor context correctly via
// getRackLocation, they just start with an empty rack to survey.
const devices = b001Devices
const patchPanels = b001PatchPanels

function baseDevicePlacements(rackId) {
  return devices
    .filter((d) => d.rackId === rackId)
    .map((d) => ({
      id: d.id,
      ru: d.ru,
      heightU: d.heightU,
      face: d.face,
      fullDepth: false,
      mounting: 'rack',
      kind: 'device',
      category: 'Switches',
      label: d.hostname,
      sublabel: d.model,
    }))
}

function basePatchPanelPlacements(rackId) {
  return patchPanels
    .filter((p) => p.rackId === rackId)
    .map((p) => ({
      id: p.id,
      ru: p.ru,
      heightU: p.heightU,
      face: p.face,
      fullDepth: false,
      mounting: 'rack',
      kind: 'device',
      category: 'Patch panels',
      label: p.code,
      sublabel: p.type === 'copper' ? 'Cat6A · 24 port' : 'Fibre · 24 port',
    }))
}

// A few already-captured survey-only items (not part of the device model:
// no hostname/naming-convention identity) so the demo rack looks like a
// real completed survey, matching render page 6.
const DEMO_EXTRAS = {
  'rack-tr-eg-01-r01': [
    { id: 'extra-cm-1', ru: 39, heightU: 1, face: 'front', fullDepth: false, mounting: 'rack', kind: 'device', category: 'Cable management', label: 'Horizontal cable manager', sublabel: null },
    { id: 'extra-reserved-1', ru: 33, heightU: 1, face: 'front', fullDepth: false, mounting: 'rack', kind: 'reserved', category: null, label: 'Reserved for FMO', sublabel: null },
    { id: 'extra-reserved-2', ru: 32, heightU: 1, face: 'front', fullDepth: false, mounting: 'rack', kind: 'reserved', category: null, label: 'Reserved for FMO', sublabel: null },
    { id: 'extra-pdu-a', ru: 0, heightU: 0, face: 'rear', fullDepth: false, mounting: '0U', railSide: 'left', kind: 'device', category: 'Power', label: 'PDU-A', sublabel: '24 sockets' },
    { id: 'extra-pdu-b', ru: 0, heightU: 0, face: 'rear', fullDepth: false, mounting: '0U', railSide: 'right', kind: 'device', category: 'Power', label: 'PDU-B', sublabel: '24 sockets' },
  ],
}

const store = {
  placementsByRack: {},
  revisionByRack: {}, // rackId -> { revision, lastSavedAt }
  deviceSerials: Object.fromEntries(projectSerials.map((e) => [e.deviceId, e.serial])),
}

registerStore('rackSurvey', {
  getSnapshot: () => store,
  restoreSnapshot: (data) => {
    if (data?.placementsByRack) store.placementsByRack = data.placementsByRack
    if (data?.revisionByRack) store.revisionByRack = data.revisionByRack
    if (data?.deviceSerials) store.deviceSerials = data.deviceSerials
  },
})

function seedPlacements(rackId) {
  return [...baseDevicePlacements(rackId), ...basePatchPanelPlacements(rackId), ...(DEMO_EXTRAS[rackId] ?? [])]
}

function revisionFor(rackId) {
  if (!store.revisionByRack[rackId]) {
    store.revisionByRack[rackId] = { revision: 3, lastSavedAt: '2026-09-27T21:58:00Z' }
  }
  return store.revisionByRack[rackId]
}

export async function getRackSurveyContext(rackId) {
  const location = getRackLocation(rackId)
  if (!location) return Promise.reject(new Error(`Unknown rack: ${rackId}`))
  const { rack, room, floor } = location

  if (!store.placementsByRack[rackId]) {
    store.placementsByRack[rackId] = seedPlacements(rackId)
  }

  return resolveAfter({
    rack: { id: rack.id, code: rack.code, heightU: rack.heightU },
    room: { id: room.id, code: room.code },
    floor: { id: floor.id, name: floor.name },
    placements: store.placementsByRack[rackId],
    meta: getRackSurveyMeta(rackId),
    roomCmoList: getCmoForRoom(room.id),
    revisionMeta: { ...revisionFor(rackId) },
  })
}

// Autosave replaces the stored placements for this rack. It never touches
// revisionByRack — undo/redo and the version counter only reset on an
// explicit Save Version (brief v2.3 §6.10).
export async function autosaveRackSurvey(rackId, placements) {
  store.placementsByRack[rackId] = placements
  return resolveAfter({ lastAutosavedAt: new Date().toISOString() }, 400)
}

export async function saveRackSurveyVersion(rackId) {
  const meta = revisionFor(rackId)
  meta.revision += 1
  meta.lastSavedAt = new Date().toISOString()
  return resolveAfter({ ...meta })
}

export async function getDeviceSerial(deviceId) {
  return resolveAfter(store.deviceSerials[deviceId] ?? '')
}

export async function setDeviceSerial(deviceId, serial) {
  store.deviceSerials[deviceId] = serial
  return resolveAfter(true, 0)
}

export async function getAllProjectSerials() {
  return resolveAfter(Object.entries(store.deviceSerials).map(([deviceId, serial]) => ({ deviceId, serial })))
}
