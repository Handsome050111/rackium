import { useEffect, useMemo, useRef } from 'react'
import { ReactFlow, Background, Controls, MiniMap, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { HLD_NODE_TYPES } from './HldNodes.jsx'
import { HLD_EDGE_TYPES } from './UplinkEdge.jsx'
import { computeHldLayout } from '@rackium/shared/hldLayout.js'
import { applyModeView, modeOf, inFuture, DEFAULT_MODE_LABELS } from '@rackium/shared/modeState.js'

function uplinkStatus(finding) {
  if (!finding) return 'validated'
  return finding.blocked ? 'blocked' : 'validated'
}

// The badge a device carries for its mode (M7b-4a): CMO gear, kept CMO gear
// (CMO → FMO) and interim kit; the future design's own gear has none.
function modeBadge(device, labels) {
  if (device.origin === 'existing') return inFuture(device) === true ? `${labels.current} → ${labels.future}` : labels.current
  return modeOf(device) === 'interim' ? labels.interim : null
}

// Real mode also passes stored canvas positions (device.position, relative to
// the room), the selected uplink and whether devices can be dragged (Move).
// `modeView` (real mode, M7b-4a): which states are shown, overlaid or hidden;
// `devices` then carries the CMO gear too.
export function buildHldFlow({ floors, rooms, devices: allDevices, connections: allConnections, connectionFindings, selectedDeviceId, onSelectDevice, selectedConnectionId = null, draggableDevices = false, modeView = null, modeLabels = DEFAULT_MODE_LABELS }) {
  const { devices, connections } = modeView ? applyModeView({ devices: allDevices, connections: allConnections }, modeView) : { devices: allDevices, connections: allConnections }
  const devicesByRoom = {}
  for (const device of devices) {
    if (!device.roomId) continue
    ;(devicesByRoom[device.roomId] ??= []).push(device)
  }

  const { floorBands, roomNodes, deviceNodes } = computeHldLayout({ floors, rooms, devicesByRoom })

  const canvasWidth = Math.max(900, ...roomNodes.map((r) => r.x + r.width + 60))

  const nodes = [
    ...floorBands.map((band) => ({
      id: band.id,
      type: 'floorBand',
      position: { x: 0, y: band.y },
      data: { label: band.label },
      style: { width: canvasWidth, height: band.height },
      selectable: false,
      draggable: false,
      zIndex: -10,
    })),
    ...roomNodes.map((room) => ({
      id: room.id,
      type: 'room',
      position: { x: room.x, y: room.y },
      data: { label: room.label },
      style: { width: room.width, height: room.height },
      selectable: false,
      draggable: false,
      zIndex: -5,
    })),
    ...deviceNodes.map((device) => {
      const record = devices.find((d) => d.id === device.deviceId)
      return {
        id: device.id,
        type: 'device',
        parentId: device.parentId,
        extent: 'parent',
        position: record?.position ?? { x: device.x, y: device.y },
        data: { label: device.label, sublabel: device.sublabel, role: device.role, deviceId: device.deviceId, onSelect: onSelectDevice, ...(modeView ? { ghost: Boolean(record?.ghost), modeBadge: modeBadge(record ?? {}, modeLabels) } : {}) },
        selected: device.deviceId === selectedDeviceId,
        // CMO gear is not the design's to move.
        draggable: draggableDevices && record?.origin !== 'existing',
      }
    }),
  ]

  const edges = connections.map((conn) => {
    const finding = connectionFindings?.[conn.id]
    return {
      id: conn.id,
      source: `device-${conn.source.deviceId}`,
      target: `device-${conn.dest.deviceId}`,
      type: 'uplink',
      selected: conn.id === selectedConnectionId,
      data: { media: conn.media, speed: conn.speed, status: uplinkStatus(finding), ...(modeView ? { ghost: Boolean(conn.ghost), modeTag: modeOf(conn) === 'interim' ? modeLabels.interim : null } : {}) },
    }
  })

  return { nodes, edges, roomNodes }
}

// Fits the view again when `fitKey` changes (not on first render, which
// fitView does): the mode toggles add or remove whole states (M7b-4a).
function RefitOn({ fitKey }) {
  const { fitView } = useReactFlow()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return undefined
    }
    const t = setTimeout(() => fitView({ duration: 200 }), 50)
    return () => clearTimeout(t)
  }, [fitKey, fitView])
  return null
}

// `onEdgeClick` / `onNodeDragStop` / `nodesDraggable`: real mode's uplink
// selection and Move tool; mock mode passes none of them. `fitKey`: refit when it changes.
export default function HldCanvas({ flow, onInit, viewOnly, onEdgeClick, onNodeDragStop, nodesDraggable = false, fitKey = null }) {
  const proOptions = useMemo(() => ({ hideAttribution: true }), [])

  return (
    <div className="h-[600px] w-full overflow-hidden rounded-xl border border-border bg-surface">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={HLD_NODE_TYPES}
        edgeTypes={HLD_EDGE_TYPES}
        onInit={onInit}
        proOptions={proOptions}
        nodesDraggable={nodesDraggable}
        onEdgeClick={onEdgeClick ? (_e, edge) => onEdgeClick(edge.id) : undefined}
        onNodeDragStop={onNodeDragStop ? (_e, node) => node.data?.deviceId && onNodeDragStop(node.data.deviceId, node.position) : undefined}
        nodesConnectable={false}
        elementsSelectable={!viewOnly}
        panOnDrag
        zoomOnPinch
        zoomOnScroll={!viewOnly}
        minZoom={0.3}
        maxZoom={2}
        fitView
      >
        <Background gap={20} size={1} />
        {fitKey != null && <RefitOn fitKey={fitKey} />}
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'device' ? '#094F9A' : '#E2E5EA')}
          className="!hidden sm:!block"
        />
      </ReactFlow>
    </div>
  )
}
