import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ReactFlowProvider } from '@xyflow/react'
import { Lock } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import HldCanvas, { buildHldFlow } from '../components/hld/HldCanvas.jsx'
import DeploymentKpiBar from '../components/deployment/DeploymentKpiBar.jsx'
import DeviceDeploymentPanel from '../components/deployment/DeviceDeploymentPanel.jsx'
import RoomChecklistPanel from '../components/deployment/RoomChecklistPanel.jsx'
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

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="h-[560px] min-w-0 flex-1 overflow-hidden rounded-xl border border-border bg-surface">
          <ReactFlowProvider>
            <HldCanvas flow={flow} onInit={() => {}} viewOnly={isPhone} />
          </ReactFlowProvider>
        </div>

        <div className="w-full min-w-0 shrink-0 space-y-4 xl:w-96">
          {detail ? (
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
            <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-text-secondary">Select a device on the topology to record its installation.</div>
          )}
        </div>
      </div>

      <RoomChecklistPanel roomChecklists={roomChecklists} />
    </div>
  )
}
