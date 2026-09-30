// THE single mutable store for devices/connections/patch panels, seeded
// once from the mock dataset. Both the Rackium Editor (api/lld.js) and HLD
// (api/hld.js) read and write through here — a connection or device
// created in one is immediately visible in the other, per the brief's
// "one shared data model" principle (every drawn object is a data record,
// nothing re-typed between phases).
import { devices as seedDevices, patchPanels as seedPatchPanels, connections as seedConnections } from '../mock/b001-site.js'

const store = {
  devices: [...seedDevices],
  patchPanels: [...seedPatchPanels],
  connections: [...seedConnections],
}

export function getDevices() {
  return store.devices
}
export function getPatchPanels() {
  return store.patchPanels
}
export function getConnections() {
  return store.connections
}

export function findDevice(deviceId) {
  return store.devices.find((d) => d.id === deviceId)
}
export function findPatchPanel(panelId) {
  return store.patchPanels.find((p) => p.id === panelId)
}
export function findConnection(connectionId) {
  return store.connections.find((c) => c.id === connectionId)
}

export function addDevice(device) {
  store.devices.push(device)
  return device
}

export function upsertConnection(connection) {
  const i = store.connections.findIndex((c) => c.id === connection.id)
  if (i >= 0) store.connections[i] = connection
  else store.connections.push(connection)
  return connection
}

export function removeConnection(connectionId) {
  store.connections = store.connections.filter((c) => c.id !== connectionId)
}
