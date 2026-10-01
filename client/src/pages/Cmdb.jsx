import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Server, Wifi, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import CmdbLocationTree from '../components/cmdb/CmdbLocationTree.jsx'
import CmdbInventoryTable from '../components/cmdb/CmdbInventoryTable.jsx'
import CiDetailPanel from '../components/cmdb/CiDetailPanel.jsx'
import ReconciliationPanel from '../components/cmdb/ReconciliationPanel.jsx'
import PortConnectivityView from '../components/cmdb/PortConnectivityView.jsx'
import { getBuilding } from '../api/index.js'
import { getCmdbContext, getCiDetail, getPortConnectivity, recordOperationalChange } from '../api/cmdbDesign.js'
import { exportCmdbXlsx } from '../lib/cmdbExport.js'
import { useRole } from '../lib/RoleContext.jsx'

function Kpi({ icon: Icon, value, label, tone = 'text-brand' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5">
      <Icon size={18} strokeWidth={2} className={`shrink-0 ${tone}`} />
      <div>
        <div className="text-lg font-bold leading-tight text-text">{value}</div>
        <div className="text-[11px] text-text-secondary">{label}</div>
      </div>
    </div>
  )
}

export default function Cmdb() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [context, setContext] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [portView, setPortView] = useState(null)

  const reload = useCallback(() => {
    if (!buildingId) return
    getCmdbContext(buildingId).then(setContext)
  }, [buildingId])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    getCiDetail(buildingId, selectedId).then(setDetail)
  }, [buildingId, selectedId, context])

  async function handleOperationalEdit(deviceId, field, value) {
    await recordOperationalChange(buildingId, deviceId, field, value, role)
    reload()
    getCiDetail(buildingId, deviceId).then(setDetail)
  }

  async function handleOpenPortConnectivity() {
    const data = await getPortConnectivity(buildingId, selectedId)
    setPortView(data)
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-[1700px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'CMDB' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">CMDB — {building.name}</h1>
          <p className="text-sm text-text-secondary">Accepted as-built inventory, connectivity relationships and lifecycle records</p>
        </div>
        <button
          type="button"
          onClick={() => exportCmdbXlsx(context.rows, `${building.code}-cmdb.xlsx`)}
          className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
        >
          <Download size={14} strokeWidth={2} />
          Export CMDB
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Server} value={context.kpis.totalCis} label="Configuration items" />
        <Kpi icon={Server} value={context.kpis.networkSwitches} label="Network switches" />
        <Kpi icon={Wifi} value={context.kpis.accessPoints} label="Access points" />
        <Kpi icon={CheckCircle2} value={context.kpis.accepted} label="Accepted" tone="text-status-green" />
        <Kpi icon={Clock3} value={context.kpis.awaitingAcceptance} label="Awaiting acceptance" tone="text-status-amber" />
        <Kpi icon={AlertTriangle} value={context.kpis.complianceActions} label="Compliance action" tone={context.kpis.complianceActions > 0 ? 'text-status-red' : 'text-status-green'} />
      </div>

      {portView ? (
        <PortConnectivityView context={portView} onClose={() => setPortView(null)} />
      ) : (
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="w-full shrink-0 xl:w-64">
            <CmdbLocationTree rows={context.rows} buildingName={building.name} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <div className="min-w-0 flex-1">
            <CmdbInventoryTable rows={context.rows} selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          <div className="w-full shrink-0 space-y-4 xl:w-96">
            {detail ? (
              <CiDetailPanel detail={detail} onOpenPortConnectivity={handleOpenPortConnectivity} onOperationalEdit={handleOperationalEdit} />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-surface p-4 text-xs text-text-secondary">Select a configuration item to see its detail.</div>
            )}
            <ReconciliationPanel reconciliation={context.reconciliation} />
          </div>
        </div>
      )}
    </div>
  )
}
