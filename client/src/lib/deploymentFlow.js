// Deployment topology styling (brief Step 8: "planned/not-installed links
// grey dashed, installed links in media colours, device status icons").
// Pure post-processing over buildHldFlow's output, the same pattern
// lib/lldConnectivityFlow.js already established for LLD's Connectivity
// tab — neither touches HLD's own node/edge rendering.
import { deploymentLabel, isLiveConnection } from './deploymentModel.js'

const PLANNED_EDGE_STYLE = { stroke: '#C7CCD6', strokeDasharray: '6 4' }

export function applyDeploymentStyling(flow, devices, connections) {
  const labelByDeviceId = Object.fromEntries(devices.map((d) => [d.id, deploymentLabel(d.status)]))
  const liveByConnectionId = Object.fromEntries(connections.map((c) => [c.id, isLiveConnection(c.status)]))

  const nodes = flow.nodes.map((n) => {
    if (n.type !== 'device') return n
    return { ...n, data: { ...n.data, deploymentLabel: labelByDeviceId[n.data.deviceId] ?? 'Pending' } }
  })

  const edges = flow.edges.map((e) => {
    if (liveByConnectionId[e.id]) return e // keep the real media colour
    return { ...e, style: { ...e.style, ...PLANNED_EDGE_STYLE } }
  })

  return { ...flow, nodes, edges }
}
