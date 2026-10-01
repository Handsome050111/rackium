// CMDB (brief v2.3 §5.8, v2.2 §3.10). Pure calculation only. CMDB is the
// as-built record — "built from deployment records, not design data" — so
// everything here reads a device/connection's installation state, not its
// design intent.
import { portKindFor } from './validation.js'

const PAST_PLANNED = new Set(['delivered', 'installed', 'configured', 'tested', 'accepted', 'in_service'])

// A device only appears in the CMDB once it has moved past pure design —
// the brief's "not from design data" rule, applied literally.
export function isCmdbDevice(device) {
  return device.role !== 'wan-circuit' && PAST_PLANNED.has(device.status)
}

export function acceptanceLabel(deviceStatus) {
  return deviceStatus === 'accepted' || deviceStatus === 'in_service' ? 'Accepted' : 'Awaiting'
}

export function buildCiRows(devices, placeOf) {
  return devices.filter(isCmdbDevice).map((d) => ({
    id: d.id,
    hostname: d.hostname,
    role: d.role,
    model: d.model,
    ...placeOf(d),
    serial: d.installation?.serial ?? null,
    mac: d.installation?.mac ?? null,
    assetId: d.installation?.assetId ?? null,
    lifecycle: d.status,
    acceptance: acceptanceLabel(d.status),
  }))
}

// --- Reconciliation (brief Step 8: "design baseline vs installed counts,
// missing serials, cable ID conflicts — calculated") -----------------------

export function computeReconciliation({ hldDeviceCount, cmdbDevices, cableIds }) {
  const missingSerials = cmdbDevices.filter((d) => !d.serial).map((d) => d.hostname)

  const seen = new Map()
  const cableIdConflicts = []
  for (const id of cableIds) {
    if (!id) continue
    const key = id.toLowerCase()
    if (seen.has(key)) cableIdConflicts.push(id)
    seen.set(key, true)
  }

  return {
    hldDeviceCount,
    cmdbDeviceCount: cmdbDevices.length,
    inventoryVariance: hldDeviceCount - cmdbDevices.length,
    missingSerials,
    cableIdConflicts: [...new Set(cableIdConflicts)],
  }
}

// --- Port connectivity (brief §5.8, §3.10b) --------------------------------

// Builds the filterable port list for one device, reusing the same
// access/module split as lib/lldModel.js's buildPortGroups — "Patched"
// reflects the as-built state (the touching connection has actually been
// installed), not merely that a connection record exists.
export function buildCmdbPortRows(entity, portMap, connections, entityById) {
  const byPort = new Map()
  for (const conn of connections) {
    if (conn.source.deviceId === entity.id) byPort.set(conn.source.port, conn)
    if (conn.dest.deviceId === entity.id) byPort.set(conn.dest.port, conn)
  }

  const toRow = (port, group) => {
    const conn = byPort.get(port.id)
    const isPatched = conn && (conn.status === 'installed' || conn.status === 'tested' || conn.status === 'accepted' || conn.status === 'in_service')
    if (!isPatched) {
      return { port: port.id, group, kind: portKindFor(port.id), state: 'Free', destination: '—', ru: '—', cableId: null, medium: '—', validation: '—' }
    }
    const far = conn.source.deviceId === entity.id ? conn.dest : conn.source
    const farEntity = entityById[far.deviceId]
    return {
      port: port.id,
      group,
      kind: portKindFor(port.id),
      state: group === 'module' ? 'Uplink' : 'Patched',
      destination: farEntity ? `${farEntity.label} ${far.port ?? ''}`.trim() : '—',
      ru: farEntity?.ru ?? '—',
      cableId: conn.cableId ?? null,
      medium: conn.media,
      validation: conn.testResult === 'pass' ? 'Validated' : conn.testResult === 'fail' ? 'Failed' : 'Pending',
    }
  }

  const access = [...portMap.rows.flat()].sort((a, b) => a.n - b.n).map((p) => toRow(p, 'access'))
  const modules = [...portMap.modulePorts].sort((a, b) => a.n - b.n).map((p) => toRow(p, 'module'))
  return { access, modules }
}

// --- Hop-by-hop trace (brief §5.8 example: "Edge 04 Te1/1/1 -> Cable
// 26184735 -> PP-02 Port 08 -> Cable 26184736 -> PP-01 Port 24 -> Cable
// 26184737 -> Border Te1/1/4") ----------------------------------------------

export function buildPortTrace(connection, entityById) {
  const source = entityById[connection.source.deviceId]
  const dest = entityById[connection.dest.deviceId]
  const steps = [{ label: source ? `${source.label} ${connection.source.port}` : connection.source.deviceId }]

  if (connection.hops?.length > 0) {
    for (const hop of connection.hops) {
      steps.push({ label: `Cable ${hop.cableId ?? connection.cableId ?? '—'}`, isCable: true })
      const panel = entityById[hop.patchPanelId] ?? { label: hop.patchPanel ?? 'Patch panel' }
      steps.push({ label: `${panel.label} Port ${hop.port ?? '—'}` })
    }
    steps.push({ label: `Cable ${connection.cableId ?? '—'}`, isCable: true })
  } else {
    steps.push({ label: `Cable ${connection.cableId ?? '—'}`, isCable: true })
  }

  steps.push({ label: dest ? `${dest.label} ${connection.dest.port}` : connection.dest.deviceId })
  return steps
}
