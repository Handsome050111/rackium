import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Upload, Server, CheckCircle2, AlertTriangle } from 'lucide-react'
import Breadcrumb from '../components/Breadcrumb.jsx'
import CmoImportWizard from '../components/cmo/CmoImportWizard.jsx'
import UnassignedList from '../components/cmo/UnassignedList.jsx'
import CmoDeviceTable from '../components/cmo/CmoDeviceTable.jsx'
import { getBuilding, getProjectTree } from '../api/index.js'
import { getCmoContext, assignDeviceToBuilding, downloadCmoTemplate } from '../api/cmoDesign.js'
import { useRole } from '../lib/RoleContext.jsx'
import { canImportCmo, canAssignCmoDevice } from '../lib/permissions.js'

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

export default function Cmo() {
  const { buildingId } = useParams()
  const { role } = useRole()
  const [building, setBuilding] = useState(null)
  const [allBuildings, setAllBuildings] = useState([])
  const [context, setContext] = useState(null)
  const [importing, setImporting] = useState(false)

  const reload = useCallback(() => {
    getCmoContext().then(setContext)
  }, [])

  useEffect(() => {
    getBuilding(buildingId).then(setBuilding)
  }, [buildingId])

  useEffect(() => {
    getProjectTree().then((tree) => {
      setAllBuildings(tree.projects[0].countries[0].sals[0].campuses[0].buildings)
    })
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function handleAssign(deviceId, targetBuildingId) {
    await assignDeviceToBuilding(deviceId, targetBuildingId)
    reload()
  }

  if (!building || !context) {
    return <div className="p-6 text-sm text-text-secondary">Loading…</div>
  }

  const buildingDevices = context.devices.filter((d) => d.buildingId === buildingId)
  const importable = canImportCmo(role)
  const assignable = canAssignCmoDevice(role)

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-6">
      <Breadcrumb items={[...building.breadcrumb, { label: 'CMO Inventory Validation' }]} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">CMO Inventory Validation</h1>
          <p className="text-sm text-text-secondary">Existing-inventory baseline for {building.name}, imported once per SAL ({building.project.sal})</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={downloadCmoTemplate}
            className="flex h-touch items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-text hover:border-brand sm:h-9"
          >
            <Download size={14} strokeWidth={2} />
            Download template
          </button>
          {importable && !importing && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="flex h-touch items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 sm:h-9"
            >
              <Upload size={14} strokeWidth={2} />
              Import CMO Inventory
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi icon={Server} value={context.kpis.total} label="Devices imported (SAL)" />
        <Kpi icon={Server} value={buildingDevices.length} label={`In ${building.code}`} />
        <Kpi icon={CheckCircle2} value={context.kpis.assigned} label="Assigned" tone="text-status-green" />
        <Kpi icon={AlertTriangle} value={context.kpis.unassigned} label="Unassigned" tone={context.kpis.unassigned > 0 ? 'text-status-red' : 'text-status-green'} />
      </div>

      {importing ? (
        <CmoImportWizard
          onCancel={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            reload()
          }}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm font-semibold text-text">{building.name} — CMO devices</div>
            <CmoDeviceTable devices={buildingDevices} />
          </div>
          <UnassignedList devices={context.unassigned} buildings={allBuildings} editable={assignable} onAssign={handleAssign} />
        </div>
      )}
    </div>
  )
}
