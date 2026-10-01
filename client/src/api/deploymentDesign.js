// Deployment & Installation (brief v2.3 §5.7, Step 8). Reads the shared
// HLD/LLD topology and BOM procurement data; writes an `installation` /
// `installed` sub-object onto the same device/connection records everyone
// else reads, keeping the original design fields (LLD's read-only
// reference) completely untouched.
import { getDevices, getConnections, findDevice, findConnection, updateDevice, upsertConnection } from './networkStore.js'
import { getHldContext } from './hld.js'
import { getBomContext } from './bomDesign.js'
import { getLldContext } from './lldDesign.js'
import { getResourceMinutes } from './projectSettings.js'
import { getCmoForRoom } from '../mock/cmo.js'
import { DEVICE_CATALOGUE } from '../mock/deviceCatalogue.js'
import {
  deploymentLabel,
  isDeliveryReady,
  isLiveConnection,
  validateSerial,
  detectConnectionDeviations,
  detectRuDeviation,
  computeDeploymentKpis,
  checklistProgress,
} from '../lib/deploymentModel.js'
import { computeDguvStatus } from '../lib/dguv.js'
import { buildResourceEstimate, RESOURCE_TASKS } from '../lib/billOfResources.js'

function resolveAfter(value, ms = 25) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

const exceptionsByBuilding = {} // buildingId -> [{id, deviceId, connectionId, field, label, designedValue, installedValue, reason, hasPhoto, resolved, loggedAt}]
let exceptionIdCounter = 1

function exceptionsFor(buildingId) {
  return (exceptionsByBuilding[buildingId] ??= [])
}

function bomLinesByRole(bomContext) {
  const map = {}
  for (const line of bomContext.lines) {
    if (line.category === 'Network devices' && line.key.startsWith('device:')) {
      map[line.key.replace('device:', '')] = line
    }
  }
  return map
}

function isMainsPowered(model) {
  return (DEVICE_CATALOGUE[model]?.psuCount ?? 0) > 0
}

function decorateDevice(device, linesByRole) {
  return {
    ...device,
    deploymentLabel: deploymentLabel(device.status),
    deliveryReady: isDeliveryReady(device, linesByRole),
    checklistProgress: checklistProgress(device.installation?.checklist),
    dguv: computeDguvStatus({ lastInspectionDate: device.installation?.dguvDate, mainsPowered: isMainsPowered(device.model) }),
  }
}

export async function getDeploymentContext(buildingId) {
  const [hldContext, bomContext] = await Promise.all([getHldContext(buildingId), getBomContext(buildingId)])
  const linesByRole = bomLinesByRole(bomContext)
  const devices = hldContext.devices.map((d) => decorateDevice(d, linesByRole))
  const exceptions = exceptionsFor(buildingId)
  const openExceptionCount = exceptions.filter((e) => !e.resolved).length

  return resolveAfter({
    floors: hldContext.floors,
    rooms: hldContext.rooms,
    devices,
    connections: hldContext.connections,
    connectionFindings: hldContext.connectionFindings,
    kpis: computeDeploymentKpis({ devices: hldContext.devices, connections: hldContext.connections, openExceptionCount }),
    exceptions,
  })
}

export async function getDeviceDetail(buildingId, deviceId) {
  const ctx = await getDeploymentContext(buildingId)
  const device = ctx.devices.find((d) => d.id === deviceId)
  if (!device) return null
  const connections = getConnections().filter((c) => c.source.deviceId === deviceId || c.dest.deviceId === deviceId)
  const cmoEntries = getCmoForRoom(device.roomId)
  return resolveAfter({ device, connections, cmoEntries, exceptions: ctx.exceptions.filter((e) => e.deviceId === deviceId) })
}

// --- Device actions ---------------------------------------------------

function mergeChecklist(device, patch) {
  return { ...(device.installation?.checklist ?? {}), ...patch }
}

export async function recordSerialMac(buildingId, deviceId, { serial, mac }) {
  const device = findDevice(deviceId)
  if (!device) return resolveAfter({ ok: false, error: 'Device not found' })
  const validation = validateSerial(serial, device.roomId, deviceId, getCmoForRoom(device.roomId), getDevices())
  if (validation === 'duplicate') {
    return resolveAfter({ ok: false, error: `Serial ${serial} is already recorded against another device in this project.` })
  }
  updateDevice(deviceId, { installation: { ...device.installation, serial, mac, serialValidation: validation } })
  return resolveAfter({ ok: true, validation })
}

export async function confirmInstallation(buildingId, deviceId, { confirmedRu, pduOutlet, latitude, longitude, altitude, technician }) {
  const device = findDevice(deviceId)
  if (!device) return resolveAfter({ ok: false, error: 'Device not found' })

  const ruDeviation = detectRuDeviation(device, confirmedRu)
  if (ruDeviation) {
    exceptionsFor(buildingId).push({
      id: `exc-${exceptionIdCounter++}`,
      deviceId,
      connectionId: null,
      field: ruDeviation.field,
      label: ruDeviation.label,
      designedValue: ruDeviation.designedValue,
      installedValue: ruDeviation.installedValue,
      reason: 'Logged automatically — confirmed RU does not match the designed placement',
      hasPhoto: false,
      resolved: false,
      loggedAt: new Date().toISOString(),
    })
  }

  const checklist = mergeChecklist(device, { 'rack-ru': true, labelled: true, power: Boolean(pduOutlet) })
  const nextStatus = device.status === 'planned' || device.status === 'ordered' || device.status === 'delivered' ? 'installed' : device.status
  updateDevice(deviceId, {
    status: nextStatus,
    installation: {
      ...device.installation,
      confirmedRu: confirmedRu ?? device.installation?.confirmedRu,
      pduOutlet: pduOutlet ?? device.installation?.pduOutlet,
      latitude: latitude ?? device.installation?.latitude,
      longitude: longitude ?? device.installation?.longitude,
      altitude: altitude ?? device.installation?.altitude,
      technician: technician ?? device.installation?.technician,
      installedAt: device.installation?.installedAt ?? new Date().toISOString(),
      checklist,
    },
  })
  return resolveAfter({ ok: true, ruDeviation })
}

// `deviceId` is whichever device's panel the engineer confirmed this uplink
// from — it may be either end of the connection. Exceptions and checklist
// progress are attributed to that device (falling back to the connection's
// source for any caller that doesn't pass one), not hardcoded to the
// source, so they actually surface on the panel the engineer is looking at.
export async function confirmUplinking(buildingId, connectionId, installed, deviceId) {
  const connection = findConnection(connectionId)
  if (!connection) return resolveAfter({ ok: false, error: 'Connection not found' })
  const attributedDeviceId = deviceId ?? connection.source.deviceId

  const deviations = detectConnectionDeviations(connection, installed)
  for (const dev of deviations) {
    exceptionsFor(buildingId).push({
      id: `exc-${exceptionIdCounter++}`,
      deviceId: attributedDeviceId,
      connectionId,
      field: dev.field,
      label: dev.label,
      designedValue: dev.designedValue,
      installedValue: dev.installedValue,
      reason: 'Logged automatically — field differs from the approved LLD',
      hasPhoto: false,
      resolved: false,
      loggedAt: new Date().toISOString(),
    })
  }

  upsertConnection({
    ...connection,
    status: connection.status === 'designed' || connection.status === 'approved' ? 'installed' : connection.status,
    installed: { ...connection.installed, ...installed, recordedAt: new Date().toISOString() },
  })

  const workedDevice = findDevice(attributedDeviceId)
  if (workedDevice) updateDevice(workedDevice.id, { installation: { ...workedDevice.installation, checklist: mergeChecklist(workedDevice, { patched: true }) } })

  return resolveAfter({ ok: true, deviations })
}

export async function recordLinkTest(buildingId, connectionId, result) {
  const connection = findConnection(connectionId)
  if (!connection) return resolveAfter({ ok: false, error: 'Connection not found' })
  upsertConnection({ ...connection, testResult: result, status: result === 'pass' ? 'tested' : connection.status })

  const sourceDevice = findDevice(connection.source.deviceId)
  if (sourceDevice && result === 'pass') {
    updateDevice(sourceDevice.id, { installation: { ...sourceDevice.installation, checklist: mergeChecklist(sourceDevice, { tested: true }) } })
  }
  return resolveAfter({ ok: true })
}

export async function recordDguvInspection(buildingId, deviceId, date) {
  const device = findDevice(deviceId)
  if (!device) return resolveAfter({ ok: false, error: 'Device not found' })
  updateDevice(deviceId, {
    installation: { ...device.installation, dguvDate: date, checklist: mergeChecklist(device, { dguv: true }) },
  })
  return resolveAfter({ ok: true })
}

export async function addEvidence(buildingId, deviceId) {
  const device = findDevice(deviceId)
  if (!device) return resolveAfter({ ok: false })
  updateDevice(deviceId, { installation: { ...device.installation, evidenceCount: (device.installation?.evidenceCount ?? 0) + 1 } })
  return resolveAfter({ ok: true })
}

export async function setDeviceStatus(buildingId, deviceId, status) {
  updateDevice(deviceId, { status })
  return resolveAfter({ ok: true })
}

export async function logException(buildingId, { deviceId, connectionId, field, label, designedValue, installedValue, reason, hasPhoto }) {
  const record = {
    id: `exc-${exceptionIdCounter++}`,
    deviceId,
    connectionId,
    field,
    label,
    designedValue,
    installedValue,
    reason,
    hasPhoto: Boolean(hasPhoto),
    resolved: false,
    loggedAt: new Date().toISOString(),
  }
  exceptionsFor(buildingId).push(record)
  return resolveAfter(record)
}

export async function resolveException(buildingId, exceptionId) {
  const exception = exceptionsFor(buildingId).find((e) => e.id === exceptionId)
  if (exception) exception.resolved = true
  return resolveAfter({ ok: true })
}

// Step 8: "Bill of Resources tasks from Step 7 appear as the installation
// checklist per room." Reuses buildResourceEstimate twice — once over
// every device/connection (the total), once over only the ones that have
// actually progressed past design (the done count) — rather than
// duplicating its room/task attribution logic.
export async function getRoomChecklists(buildingId) {
  const [lldContext, minutesById] = await Promise.all([getLldContext(buildingId), getResourceMinutes()])
  const devices = lldContext.entities.filter((e) => e.type === 'device')
  const racks = lldContext.rackElevations.map((r) => ({ room: r.room }))

  const total = buildResourceEstimate({ devices, rows: lldContext.rows, racks }, minutesById)

  const doneDevices = devices.filter((d) => findDevice(d.id) && deploymentLabel(findDevice(d.id).status) !== 'Pending')
  const doneRows = lldContext.rows.filter((r) => {
    const conn = findConnection(r.id)
    return conn && isLiveConnection(conn.status)
  })
  // A rack's "installed" task isn't gated by its own status (none is tracked)
  // — it's done once at least one device in that room has progressed, since
  // someone had to rack-mount it to install anything into it.
  const doneRoomCodes = new Set(doneDevices.map((d) => d.roomCode))
  const doneRacks = racks.filter((r) => doneRoomCodes.has(r.room?.code ?? r.roomCode))
  const done = buildResourceEstimate({ devices: doneDevices, rows: doneRows, racks: doneRacks }, minutesById)

  return Object.keys(total.byRoom).map((room) => ({
    room,
    tasks: RESOURCE_TASKS.map((t) => ({ id: t.id, label: t.label, total: total.byRoom[room]?.[t.id] ?? 0, done: done.byRoom[room]?.[t.id] ?? 0 })).filter(
      (t) => t.total > 0
    ),
  }))
}
