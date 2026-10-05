import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { ChevronLeft, Lock } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import DeploymentKpiBar from '../components/deployment/DeploymentKpiBar.jsx'
import DeviceDeploymentPanel from '../components/deployment/DeviceDeploymentPanel.jsx'
import RoomChecklistPanel from '../components/deployment/RoomChecklistPanel.jsx'
import LocationTree from '../components/deployment/LocationTree.jsx'
import { buildLocationTree } from '@rackium/shared/locationTree.js'
import { getBuilding } from '../api/index.js'
import {
  getDeploymentContext,
  getDeviceDetail,
  getRoomChecklists,
  recordSerialMac,
  confirmInstallation,
  confirmUplinking,
  recordLinkTest,
  recordDguvInspection,
  addEvidence,
  setDeviceStatus,
} from '../api/deploymentDesign.js'
import { applyDeploymentStyling } from '@rackium/shared/deploymentFlow.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { isHandoverAccepted } from '../api/designFreeze.js'

export default function Deployment() {
  const { buildingId } = useParams()
  const isPhone = useMediaQuery('(max-width: 767px)')
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [roomChecklists, setRoomChecklists] = useState(null)
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [locked, setLocked] = useState(false)
  // Phone only: the device list is the main view and the topology map is a secondary view.
  const [phoneView, setPhoneView] = useState('tree')

  const reload = useCallback(() => {
    if (!buildingId) return
    Promise.all([getDeploymentContext(buildingId), getRoomChecklists(buildingId), isHandoverAccepted(buildingId)]).then(([ctx, rooms, accepted]) => {
      setContext(ctx)
      setRoomChecklists(rooms)
      setLocked(accepted)
    })
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (!selectedDeviceId) {
      setDetail(null)
      return
    }
    getDeviceDetail(buildingId, selectedDeviceId).then(setDetail)
  }, [buildingId, selectedDeviceId, context])

  async function withReload(action) {
    const result = await action()
    reload()
    return result
  }

  const handleRecordSerialMac = (deviceId, patch) => withReload(() => recordSerialMac(buildingId, deviceId, patch))
  const handleConfirmInstallation = (deviceId, patch) => withReload(() => confirmInstallation(buildingId, deviceId, patch))
  const handleConfirmUplinking = (connectionId, installed, deviceId) => withReload(() => confirmUplinking(buildingId, connectionId, installed, deviceId))
  const handleRecordLinkTest = (connectionId, result) => withReload(() => recordLinkTest(buildingId, connectionId, result))
  const handleRecordDguv = (deviceId, date) => withReload(() => recordDguvInspection(buildingId, deviceId, date))
  const handleAddEvidence = (deviceId) => withReload(() => addEvidence(buildingId, deviceId))
  const handleAccept = (deviceId) => withReload(() => setDeviceStatus(buildingId, deviceId, 'accepted'))

  if (!building || !context || !roomChecklists) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const flow = applyDeploymentStyling(
    buildHldFlow({
      floors: context.floors,
      rooms: context.rooms,
      devices: context.devices,
      connections: context.connections,
      connectionFindings: context.connectionFindings,
      selectedDeviceId,
      onSelectDevice: setSelectedDeviceId,
    }),
    context.devices,
    context.connections
  )

  const tree = buildLocationTree({
    building,
    floors: context.floors,
    rooms: context.rooms,
    racks: context.racks,
    devices: context.devices,
  })

  const devicePanel = detail ? (
    <DeviceDeploymentPanel
      detail={detail}
      locked={locked}
      onRecordSerialMac={handleRecordSerialMac}
      onConfirmInstallation={handleConfirmInstallation}
      onConfirmUplinking={handleConfirmUplinking}
      onRecordLinkTest={handleRecordLinkTest}
      onRecordDguv={handleRecordDguv}
      onAddEvidence={handleAddEvidence}
      onAccept={handleAccept}
    />
  ) : (
    <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-text-secondary">Select a device in the list to record its installation.</div>
  )

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'Deployment & Installation' }]} />

      <div>
        <h1 className="text-2xl font-bold text-text">Deployment &amp; Installation — {building.name}</h1>
        <p className="text-sm text-text-secondary">Planned infrastructure compared with onsite installation and live connectivity</p>
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-xl border border-status-green/40 bg-status-green/5 px-4 py-2.5 text-xs text-status-green">
          <Lock size={14} strokeWidth={2} />
          <strong>Handover accepted</strong> — this building's deployment record is permanently read-only.
        </div>
      )}

      <DeploymentKpiBar kpis={context.kpis} />

      {isPhone && selectedDeviceId && (
        // Phone: a device opens its full checklist on its own screen, with a clear way back.
        // Starts below the 64px top bar, so the menu and role switch stay usable.
        <div className="fixed inset-x-0 bottom-0 top-16 z-30 space-y-4 overflow-y-auto bg-surface-muted p-4">
          <button
            type="button"
            onClick={() => setSelectedDeviceId(null)}
            className="flex h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand"
          >
            <ChevronLeft size={18} strokeWidth={2} />
            Back to devices
          </button>
          {devicePanel}
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {isPhone && (
            <div role="tablist" aria-label="Deployment view" className="flex gap-1 rounded-xl border border-border bg-surface p-1">
              {[
                { id: 'tree', label: 'Devices' },
                { id: 'map', label: 'Map' },
              ].map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-selected={phoneView === view.id}
                  onClick={() => setPhoneView(view.id)}
                  className={`h-touch flex-1 rounded-lg text-sm font-medium ${
                    phoneView === view.id ? 'bg-brand/10 text-brand' : 'text-text-secondary'
                  }`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            {(!isPhone || phoneView === 'tree') && (
              <div className="rounded-xl border border-border bg-surface p-3 md:h-[560px] md:w-72 md:shrink-0 md:overflow-y-auto">
                <LocationTree tree={tree} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId} />
              </div>
            )}
            {(!isPhone || phoneView === 'map') && (
              <div className="h-[560px] min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
                <ReactFlowProvider>
                  <HldCanvas flow={flow} onInit={() => {}} viewOnly={isPhone} />
                </ReactFlowProvider>
              </div>
            )}
          </div>
        </div>

        {!isPhone && <div className="w-full min-w-0 shrink-0 space-y-4 xl:w-96">{devicePanel}</div>}
      </div>

      <RoomChecklistPanel roomChecklists={roomChecklists} />
    </div>
  )
}
