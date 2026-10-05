import { useMemo } from 'react'
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { HLD_NODE_TYPES } from './HldNodes.jsx'
import { HLD_EDGE_TYPES } from './UplinkEdge.jsx'
import { computeHldLayout } from '@rackium/shared/hldLayout.js'

function uplinkStatus(finding) {
  if (!finding) return 'validated'
  return finding.blocked ? 'blocked' : 'validated'
}

export function buildHldFlow({ floors, rooms, devices, connections, connectionFindings, selectedDeviceId, onSelectDevice }) {
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
    ...deviceNodes.map((device) => ({
      id: device.id,
      type: 'device',
      parentId: device.parentId,
      extent: 'parent',
      position: { x: device.x, y: device.y },
      data: { label: device.label, sublabel: device.sublabel, role: device.role, deviceId: device.deviceId, onSelect: onSelectDevice },
      selected: device.deviceId === selectedDeviceId,
      draggable: false,
    })),
  ]

  const edges = connections.map((conn) => {
    const finding = connectionFindings?.[conn.id]
    return {
      id: conn.id,
      source: `device-${conn.source.deviceId}`,
      target: `device-${conn.dest.deviceId}`,
      type: 'uplink',
      data: { media: conn.media, speed: conn.speed, status: uplinkStatus(finding) },
    }
  })

  return { nodes, edges, roomNodes }
}

export default function HldCanvas({ flow, onInit, viewOnly }) {
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
        nodesDraggable={false}
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
