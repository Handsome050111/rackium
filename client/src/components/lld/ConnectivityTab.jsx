import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import HldCanvas, { buildHldFlow } from '../hld/HldCanvas.jsx'
import DeviceSelector from './DeviceSelector.jsx'
import SelectedDevicePanel from './SelectedDevicePanel.jsx'
import UpstreamPathPanel from './UpstreamPathPanel.jsx'
import DownstreamPanel from './DownstreamPanel.jsx'
import NexAiAnalyserPanel from './NexAiAnalyserPanel.jsx'
import { upstreamPath, downstreamLinks } from '@rackium/shared/lldModel.js'
import { relevantIdsForSelection, applyConnectivityHighlight } from '@rackium/shared/lldConnectivityFlow.js'
import { useMediaQuery } from '../../lib/useMediaQuery.js'

export default function ConnectivityTab({ context }) {
  const { buildingId } = useParams()
  const navigate = useNavigate()
  const isPhone = useMediaQuery('(max-width: 767px)')
  const { entityById, rows, topology, portSchedule, distributionRequired, siteSize } = context

  const selectable = topology.devices.filter((d) => d.role === 'border' || d.role === 'edge')
  const [requestedId, setRequestedId] = useState(null)
  // Derived at render time, not via an effect: falls back to the Border
  // (or first selectable device) whenever the requested one no longer
  // exists in this context — e.g. right after the context reloads.
  const selectedId =
    requestedId && selectable.some((d) => d.id === requestedId) ? requestedId : (selectable.find((d) => d.role === 'border')?.id ?? selectable[0]?.id ?? null)

  const selectedDevice = selectedId ? entityById[selectedId] : null
  const upstream = useMemo(() => (selectedId ? upstreamPath(selectedId, entityById, rows) : []), [selectedId, entityById, rows])
  const downstream = useMemo(
    () => (selectedId && selectedDevice?.role === 'border' ? downstreamLinks(selectedId, entityById, rows) : []),
    [selectedId, selectedDevice, entityById, rows]
  )

  const flow = useMemo(() => {
    const base = buildHldFlow({
      floors: topology.floors,
      rooms: topology.rooms,
      devices: topology.devices,
      connections: topology.connections,
      connectionFindings: topology.connectionFindings,
      selectedDeviceId: selectedId,
      onSelectDevice: setRequestedId,
    })
    const { deviceIds, connectionIds } = relevantIdsForSelection(selectedId, upstream, downstream)
    return applyConnectivityHighlight(base, selectedId, deviceIds, connectionIds)
  }, [topology, selectedId, upstream, downstream, setRequestedId])

  const portGroups = useMemo(() => portSchedule.find((e) => e.device.id === selectedId)?.groups ?? [], [portSchedule, selectedId])

  function handleOpenEditor() {
    if (selectedDevice?.rackId) navigate(`/b/${buildingId}/lld/editor?rack=${selectedDevice.rackId}`)
  }

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="w-full min-w-0 shrink-0 xl:w-64">
        <DeviceSelector
          devices={topology.devices.filter((d) => d.role === 'border' || d.role === 'edge')}
          selectedId={selectedId}
          onSelect={setRequestedId}
          distributionRequired={distributionRequired}
          siteSize={siteSize}
        />
      </div>

      <div className="h-[560px] min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        <ReactFlowProvider>
          <HldCanvas flow={flow} onInit={() => {}} viewOnly={isPhone} />
        </ReactFlowProvider>
      </div>

      <div className="w-full min-w-0 shrink-0 space-y-4 xl:w-80">
        {selectedDevice ? (
          <>
            <SelectedDevicePanel device={selectedDevice} />
            <UpstreamPathPanel steps={upstream} />
            <DownstreamPanel device={selectedDevice} downstream={downstream} portGroups={portGroups} onOpenEditor={handleOpenEditor} />
            <NexAiAnalyserPanel
              topology={topology}
              lldDeviceCount={context.entities.filter((e) => e.type === 'device').length}
              hldChanged={context.hld.stale}
            />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-text-secondary">
            Select a Border or Edge device to see its end-to-end connectivity.
          </div>
        )}
      </div>
    </div>
  )
}
