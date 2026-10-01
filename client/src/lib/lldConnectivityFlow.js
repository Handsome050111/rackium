// Connectivity tab highlighting: dims every canvas node/edge that isn't
// part of the selected device's upstream/downstream path. Pure
// post-processing over buildHldFlow's output, so it never touches HLD's
// own node/edge rendering (components/hld/HldNodes.jsx, UplinkEdge.jsx).
export function relevantIdsForSelection(selectedDeviceId, upstreamSteps, downstreamRows) {
  const deviceIds = new Set(selectedDeviceId ? [selectedDeviceId] : [])
  const connectionIds = new Set()

  for (const step of upstreamSteps) {
    deviceIds.add(step.from.id)
    deviceIds.add(step.to.id)
    connectionIds.add(step.row.id)
  }
  for (const row of downstreamRows) {
    deviceIds.add(row.source.entityId)
    deviceIds.add(row.dest.entityId)
    connectionIds.add(row.id)
  }

  return { deviceIds, connectionIds }
}

export function applyConnectivityHighlight(flow, selectedDeviceId, relevantDeviceIds, relevantConnectionIds) {
  if (!selectedDeviceId) return flow

  const nodes = flow.nodes.map((n) => {
    if (n.type !== 'device') return n
    const dim = !relevantDeviceIds.has(n.data.deviceId)
    return {
      ...n,
      style: { ...n.style, opacity: dim ? 0.3 : 1, transition: 'opacity 150ms' },
      data: { ...n.data, highlighted: n.data.deviceId === selectedDeviceId },
    }
  })

  const edges = flow.edges.map((e) => {
    const dim = !relevantConnectionIds.has(e.id)
    return { ...e, style: { ...e.style, opacity: dim ? 0.2 : 1, transition: 'opacity 150ms' } }
  })

  return { ...flow, nodes, edges }
}
