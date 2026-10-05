// Exact, sequential port numbering per device category (brief v2.3 §6.5,
// §7.6: "no skipped, duplicated or extra ports"). Uplink/network-module
// ports are always a separate list from access ports, never merged in.

const EDGE_ACCESS_COUNT = 48
const EDGE_UPLINK_COUNT = 8
const CORE_PORT_COUNT = 24
const PATCH_PANEL_PORT_COUNT = 24

function zigzagRows(count, labelAt) {
  const top = []
  const bottom = []
  for (let n = 1; n <= count; n++) {
    const port = { id: labelAt(n), label: labelAt(n), n }
    if (n % 2 === 1) top.push(port)
    else bottom.push(port)
  }
  return [top, bottom]
}

function edgePortMap() {
  const [top, bottom] = zigzagRows(EDGE_ACCESS_COUNT, (n) => `Gi1/0/${n}`)
  const modulePorts = Array.from({ length: EDGE_UPLINK_COUNT }, (_, i) => ({
    id: `Te1/1/${i + 1}`,
    label: `Te1/1/${i + 1}`,
    n: i + 1,
  }))
  return { rows: [top, bottom], modulePorts }
}

function corePortMap() {
  const ports = Array.from({ length: CORE_PORT_COUNT }, (_, i) => ({
    id: `Te1/1/${i + 1}`,
    label: `Te1/1/${i + 1}`,
    n: i + 1,
  }))
  return { rows: [ports], modulePorts: [] }
}

export function getDevicePortMap(device) {
  if (device.role === 'edge') return edgePortMap()
  if (device.role === 'border' || device.role === 'fusion' || device.role === 'distribution') return corePortMap()
  return { rows: [], modulePorts: [] }
}

export function getPatchPanelPortMap(patchPanel) {
  const count = patchPanel.ports ?? PATCH_PANEL_PORT_COUNT
  const ports = Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const label = String(n).padStart(2, '0')
    return { id: label, label, n }
  })
  return { rows: [ports], modulePorts: [] }
}

// All ports (access + module) for a port map, in display order.
export function flattenPortMap(portMap) {
  return [...portMap.rows.flat(), ...portMap.modulePorts]
}
