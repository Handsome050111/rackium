// Deployment & Installation (brief v2.3 §5.7, §4.4, v2.2 §3.9). Pure
// calculation only — no React, no store access — so it's directly
// unit-testable the same way every other phase's lib/ module is.

// Device status: Planned -> Ordered -> Delivered -> Installed -> Configured
// -> Tested -> Accepted -> In Service; plus Maintenance and Retired off to
// the side. Connection status mirrors it minus Ordered/Delivered/Configured,
// plus Faulty/Decommissioned (brief §4.4).
export const DEVICE_STATUS_ORDER = ['planned', 'ordered', 'delivered', 'installed', 'configured', 'tested', 'accepted', 'in_service']
export const CONNECTION_STATUS_ORDER = ['designed', 'approved', 'installed', 'tested', 'accepted', 'in_service']

const INSTALLED_STATUSES = new Set(['installed', 'configured'])
const READY_STATUSES = new Set(['tested', 'accepted', 'in_service'])

// Brief §4.4: "Deployment view labels map onto device status."
export function deploymentLabel(deviceStatus) {
  if (READY_STATUSES.has(deviceStatus)) return 'Ready'
  if (INSTALLED_STATUSES.has(deviceStatus)) return 'Installed'
  return 'Pending' // planned/ordered/delivered, and the fallback for an unset status
}

export function isLiveConnection(connectionStatus) {
  return connectionStatus === 'installed' || connectionStatus === 'tested' || connectionStatus === 'accepted' || connectionStatus === 'in_service'
}

// Brief D22: "Installation can start per device as soon as that device's
// materials are marked Delivered" — the BOM tracks one line per role (you
// order "5x Edge switches", not five separate purchase orders), so every
// device of that role shares the same delivery gate.
export function isDeliveryReady(device, bomLinesByRole) {
  return bomLinesByRole[device.role]?.procurementStatus === 'Delivered'
}

// --- Serial/MAC validation (brief §5.1, reused at deployment) -------------

// 'validated' = found in CMO for this room; 'not_in_cmo' = entered but no
// match; 'duplicate' = already recorded against a different device anywhere
// in the project (live check against every device's own installation
// record, not just the original CMO import).
export function validateSerial(serial, roomId, deviceId, cmoEntries, allDevices) {
  if (!serial) return null
  const duplicate = allDevices.some((d) => d.id !== deviceId && d.installation?.serial === serial)
  if (duplicate) return 'duplicate'
  const inCmo = cmoEntries.some((e) => e.serial === serial)
  return inCmo ? 'validated' : 'not_in_cmo'
}

// --- Deviation detection (brief §5.7, §3.9.4) ------------------------------

const FIELD_LABELS = { media: 'Media', sourceSfp: 'Source SFP', destSfp: 'Destination SFP', sourcePort: 'Source port', destPort: 'Destination port', cableId: 'Cable ID' }

// Compares the as-installed record a field engineer enters against the
// read-only designed connection. Only fields the engineer actually entered
// are compared — an unset installed field isn't "no deviation", it's "not
// recorded yet", so it's skipped rather than treated as a silent pass.
export function detectConnectionDeviations(connection, installed) {
  const deviations = []
  const checks = [
    ['media', connection.media, installed.media],
    ['sourceSfp', connection.sourceSfp, installed.sourceSfp],
    ['destSfp', connection.destSfp, installed.destSfp],
    ['sourcePort', connection.source.port, installed.sourcePort],
    ['destPort', connection.dest.port, installed.destPort],
    ['cableId', connection.cableId, installed.cableId],
  ]
  for (const [field, designedValue, installedValue] of checks) {
    if (installedValue == null || installedValue === '') continue
    if (installedValue !== designedValue) {
      deviations.push({ field, label: FIELD_LABELS[field], designedValue: designedValue ?? '—', installedValue })
    }
  }
  return deviations
}

export function detectRuDeviation(device, confirmedRu) {
  if (confirmedRu == null || device.ru == null) return null
  return confirmedRu !== device.ru ? { field: 'ru', label: 'Rack / RU', designedValue: device.ru, installedValue: confirmedRu } : null
}

// --- KPIs (brief Step 8: "KPIs CALCULATED") --------------------------------

export function computeDeploymentKpis({ devices, connections, openExceptionCount }) {
  const installable = devices.filter((d) => d.role !== 'wan-circuit')
  const aps = installable.filter((d) => d.role === 'ap')

  const devicesInstalled = installable.filter((d) => INSTALLED_STATUSES.has(d.status) || READY_STATUSES.has(d.status)).length
  const apsMounted = aps.filter((d) => INSTALLED_STATUSES.has(d.status) || READY_STATUSES.has(d.status)).length
  const uplinksLive = connections.filter((c) => isLiveConnection(c.status)).length
  const overallProgress = installable.length === 0 ? 0 : Math.round((devicesInstalled / installable.length) * 100)

  return {
    devicesInstalled,
    totalDevices: installable.length,
    apsMounted,
    totalAps: aps.length,
    uplinksLive,
    totalUplinks: connections.length,
    overallProgress,
    openIssues: openExceptionCount,
  }
}

// --- Installation checklist (brief §3.9.3) ---------------------------------

export const CHECKLIST_ITEMS = [
  { id: 'rack-ru', label: 'Device installed at correct RU' },
  { id: 'labelled', label: 'Device labelled (hostname label attached)' },
  { id: 'power', label: 'Power connected (to specified PDU outlet)' },
  { id: 'patched', label: 'Ports patched (per LLD cable schedule)' },
  { id: 'tested', label: 'Link tested (connectivity verified)' },
  { id: 'dguv', label: 'DGUV inspection recorded' },
]

export function checklistProgress(checklistState) {
  const done = CHECKLIST_ITEMS.filter((i) => checklistState?.[i.id]).length
  return { done, total: CHECKLIST_ITEMS.length, complete: done === CHECKLIST_ITEMS.length }
}
